/**
 * Cómo se guardan en la base local las filas que manda el servidor (snapshot o cambios).
 * Todas las funciones reciben la base Dexie y se llaman dentro de una transacción que
 * incluya raffles, people, numbers, sales, receipts, outbox y uploads.
 *
 * Regla de oro: lo que todavía tiene operaciones pendientes en el outbox no se pisa
 * (el servidor todavía no lo vio). Cada fila del outbox dice qué entidades toca en `keys`:
 * `person:<id>`, `sale:<id>`, `number:<n>`, `receipt:<saleId>`, `raffle:config`,
 * `raffle:share` y `raffle:seq` (el último número de comprobante).
 */

/** Entidades que toca cada tipo de operación, deducidas del payload. */
export function opKeys(type, payload = {}) {
  switch (type) {
    case 'numbers.assign':
      return [
        `sale:${payload.saleId}`,
        `person:${payload.person?.id}`,
        ...(payload.numbers ?? []).map((n) => `number:${n}`),
        'raffle:seq',
      ]
    case 'number.release':
      return [`number:${payload.number}`]
    case 'number.transfer':
      return [`number:${payload.number}`, `person:${payload.person?.id}`]
    case 'sale.void':
      return [`sale:${payload.saleId}`, `receipt:${payload.saleId}`]
    case 'sale.setAmount':
      return [`sale:${payload.saleId}`]
    case 'person.update':
      return [`person:${payload.personId}`]
    case 'raffle.updateConfig':
      return ['raffle:config']
    case 'raffle.updateShare':
      return ['raffle:share']
    case 'receipt.set':
    case 'receipt.remove':
      return [`receipt:${payload.saleId}`]
    default:
      return []
  }
}

/** Las entidades de una rifa con operaciones todavía sin enviar. */
export async function pendingKeys(db, raffleId) {
  const rows = await db.outbox.where('raffleId').equals(raffleId).toArray()
  const keys = new Set()
  for (const row of rows) for (const key of row.keys ?? opKeys(row.type, row.payload)) keys.add(key)
  return keys
}

const numberKey = (raffleId, number) => `${raffleId}:${number}`

function personRow(raffleId, p) {
  return {
    id: p.id,
    raffleId,
    name: p.name,
    key: p.key,
    phone: p.phone ?? '',
    email: p.email ?? '',
    referrer: p.referrer ?? '',
    createdAt: p.createdAt,
  }
}

function saleRow(raffleId, s) {
  return {
    id: s.id,
    raffleId,
    seq: s.seq,
    participantId: s.participantId,
    amount: s.amount ?? null,
    createdAt: s.createdAt,
    createdBy: s.createdBy ?? null,
  }
}

function numberRow(raffleId, n) {
  return {
    id: numberKey(raffleId, n.number),
    raffleId,
    number: n.number,
    participantId: n.participantId,
    purchaseId: n.saleId,
    createdAt: n.createdAt,
    createdBy: n.createdBy ?? null,
  }
}

const hasFile = (receipt) => Boolean(receipt?.blob || receipt?.buffer)

/** ¿La fila del servidor describe el mismo archivo que ya está guardado acá? */
const sameFile = (local, row) => hasFile(local) && local.addedAt === row.addedAt && local.size === row.size

/**
 * Comprobante del servidor: sólo metadata y miniatura (`remote: true`, el archivo se baja aparte).
 * Si este dispositivo ya tiene ese mismo archivo, se conserva.
 */
function receiptRow(raffleId, row, local) {
  const meta = {
    purchaseId: row.saleId,
    raffleId,
    name: row.name ?? '',
    type: row.type || 'application/octet-stream',
    size: row.size ?? 0,
    thumb: row.thumb ?? null,
    addedAt: row.addedAt,
  }
  if (sameFile(local, row)) {
    const { remote: _remote, hasFile: _hasFile, ...kept } = local
    return { ...kept, ...meta }
  }
  return { ...meta, remote: true, hasFile: row.hasFile !== false }
}

/** Pasa todas las referencias de una persona a otra y borra la primera (unificación del servidor). */
async function mergePerson(db, from, to) {
  if (from === to) return
  for (const table of [db.numbers, db.sales]) {
    const rows = await table.where('participantId').equals(from).toArray()
    if (rows.length) await table.bulkPut(rows.map((row) => ({ ...row, participantId: to })))
  }
  await db.people.delete(from)
}

async function applyPerson(db, raffleId, row, pending) {
  if (pending.has(`person:${row.id}`)) return
  if (row.deleted) {
    await db.people.delete(row.id)
    return
  }
  // La clave (nombre normalizado) es única por rifa. Si acá hay otra persona con el mismo nombre
  // y otro id (p. ej. creada sin conexión), el servidor ya las unificó o las va a unificar al
  // recibir la operación pendiente: se queda la del servidor.
  const clash = await db.people.where('[raffleId+key]').equals([raffleId, row.key]).first()
  if (clash && clash.id !== row.id) await mergePerson(db, clash.id, row.id)
  await db.people.put(personRow(raffleId, row))
}

async function applySale(db, raffleId, row, pending) {
  if (pending.has(`sale:${row.id}`)) return
  if (row.deleted) await db.sales.delete(row.id)
  else await db.sales.put(saleRow(raffleId, row))
}

async function applyNumber(db, raffleId, row, pending) {
  if (pending.has(`number:${row.number}`)) return
  if (row.deleted) await db.numbers.delete(numberKey(raffleId, row.number))
  else await db.numbers.put(numberRow(raffleId, row))
}

async function applyReceipt(db, raffleId, row, pending) {
  if (pending.has(`receipt:${row.saleId}`)) return
  if (row.deleted) {
    await db.receipts.delete(row.saleId)
    await db.uploads.delete(row.saleId)
    return
  }
  const local = await db.receipts.get(row.saleId)
  const next = receiptRow(raffleId, row, local)
  await db.receipts.put(next)
  // Si el archivo que esperaba para subirse ya no es el de la venta (lo cambiaron desde otro
  // teléfono), no se sube.
  if (next.remote) await db.uploads.delete(row.saleId)
}

async function applyAlias(db, alias) {
  if (alias.entity === 'person') await mergePerson(db, alias.from, alias.to)
}

/** Datos de la rifa: config y estilo salvo cambios pendientes; el último comprobante, el mayor mientras haya ventas pendientes. */
function raffleFields(row, local, pending) {
  const fields = { createdAt: row.createdAt }
  if (!local || !pending.has('raffle:config')) fields.config = row.config
  if (!local || !pending.has('raffle:share')) fields.share = row.share
  fields.lastSeq = local && pending.has('raffle:seq') ? Math.max(local.lastSeq ?? 0, row.lastSeq ?? 0) : (row.lastSeq ?? 0)
  return fields
}

function remoteFields(local, response, { userId, deleted = false } = {}) {
  return {
    ...local?.remote,
    syncedVersion: response.version,
    role: response.role ?? local?.remote?.role ?? null,
    ranges: response.ranges ?? null,
    userId: userId ?? local?.remote?.userId ?? null,
    lastSyncAt: Date.now(),
    status: deleted ? 'deleted' : 'active',
  }
}

/**
 * Inserta o reemplaza una rifa en la nube con el estado completo del servidor. Lo que no vino
 * en el snapshot se borra, salvo lo que tiene operaciones pendientes (así se deshacen los cambios
 * optimistas que el servidor rechazó y se conservan los que todavía no vio).
 */
export async function applySnapshotRows(db, snapshot, { userId } = {}) {
  const raffleId = snapshot.raffle.id
  const pending = await pendingKeys(db, raffleId)
  const local = await db.raffles.get(raffleId)
  const fields = raffleFields(snapshot.raffle, local, pending)
  // Se confirma dentro de la misma transacción que reemplaza las filas. Si falla, la marca sigue.
  const remote = { ...remoteFields(local, snapshot, { userId }), needsReconcile: false }
  if (local) await db.raffles.update(raffleId, { ...fields, remote })
  else await db.raffles.add({ id: raffleId, archivedAt: null, ...fields, remote })

  const ofRaffle = (table) => table.where('raffleId').equals(raffleId)
  const keep = (key, alive) => alive.has(key) || pending.has(key)

  const people = new Set(snapshot.people.map((p) => `person:${p.id}`))
  await ofRaffle(db.people)
    .filter((p) => !keep(`person:${p.id}`, people))
    .delete()
  const sales = new Set(snapshot.sales.map((s) => `sale:${s.id}`))
  await ofRaffle(db.sales)
    .filter((s) => !keep(`sale:${s.id}`, sales))
    .delete()
  const numbers = new Set(snapshot.numbers.map((n) => `number:${n.number}`))
  await ofRaffle(db.numbers)
    .filter((n) => !keep(`number:${n.number}`, numbers))
    .delete()
  const receipts = new Set(snapshot.receipts.map((r) => `receipt:${r.saleId}`))
  const goneReceipts = await ofRaffle(db.receipts)
    .filter((r) => !keep(`receipt:${r.purchaseId}`, receipts))
    .primaryKeys()
  await db.receipts.bulkDelete(goneReceipts)
  await db.uploads.bulkDelete(goneReceipts)

  for (const row of snapshot.people) await applyPerson(db, raffleId, row, pending)
  for (const row of snapshot.sales) await applySale(db, raffleId, row, pending)
  for (const row of snapshot.numbers) await applyNumber(db, raffleId, row, pending)
  for (const row of snapshot.receipts) await applyReceipt(db, raffleId, row, pending)
  return raffleId
}

/** Aplica un pull incremental (`changes`): altas, cambios, bajas y unificaciones de personas. */
export async function applyChangeRows(db, raffleId, changes) {
  const pending = await pendingKeys(db, raffleId)
  const local = await db.raffles.get(raffleId)
  if (!local) return
  // Primero las unificaciones: la persona vieja y la nueva comparten la clave única.
  for (const alias of changes.aliases ?? []) await applyAlias(db, alias)
  for (const row of changes.people ?? []) await applyPerson(db, raffleId, row, pending)
  for (const row of changes.sales ?? []) await applySale(db, raffleId, row, pending)
  for (const row of changes.numbers ?? []) await applyNumber(db, raffleId, row, pending)
  for (const row of changes.receipts ?? []) await applyReceipt(db, raffleId, row, pending)
  const fields = changes.raffle ? raffleFields(changes.raffle, local, pending) : {}
  const remote = remoteFields(local, changes, { deleted: Boolean(changes.raffle?.deleted) })
  await db.raffles.update(raffleId, { ...fields, remote })
}
