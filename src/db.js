import Dexie from 'dexie'
import { priceFor } from './lib/format.js'

/**
 * Base de datos local (IndexedDB). Es la única fuente de verdad de la app:
 * la UI lee todo con consultas en vivo y escribe sólo a través de estas funciones.
 *
 * - participants: personas (clave única por nombre normalizado). `referrer` es quién la trajo, texto libre.
 * - tickets: sólo los números tomados; un número sin fila está disponible.
 *   `participantId` es el dueño del número y `purchaseId` el comprobante con que se pagó.
 * - purchases: una por asignación (el "comprobante"). `amount: null` = usar el monto calculado.
 * - receipts: imagen o PDF del comprobante, aparte para no cargar blobs en cada consulta.
 *   Normalmente en `blob`; donde IndexedDB no acepta Blobs (Safari en modo privado), en `buffer`.
 * - settings: configuración de la rifa y preferencias de la imagen.
 */
export const db = new Dexie('rifa')

db.version(1).stores({
  participants: '++id, &key',
  tickets: 'number, participantId',
  settings: 'key',
})

db.version(2)
  .stores({
    participants: '++id, &key',
    tickets: 'number, participantId, purchaseId',
    purchases: '++id, participantId, createdAt',
    receipts: 'purchaseId',
    settings: 'key',
  })
  .upgrade(async (tx) => {
    const tickets = await tx.table('tickets').toArray()
    for (const group of groupLegacyTickets(tickets)) {
      const purchaseId = await tx.table('purchases').add({
        participantId: group.participantId,
        createdAt: group.createdAt,
        amount: null,
      })
      await tx.table('tickets').where('number').anyOf(group.numbers).modify({ purchaseId })
    }
  })

/** En la v1 cada asignación guardaba el mismo createdAt en todos sus números: así se reconstruyen. */
function groupLegacyTickets(tickets) {
  const groups = new Map()
  for (const t of tickets) {
    const key = `${t.participantId}:${t.createdAt}`
    if (!groups.has(key)) groups.set(key, { participantId: t.participantId, createdAt: t.createdAt, numbers: [] })
    groups.get(key).numbers.push(t.number)
  }
  return [...groups.values()]
}

export const MAX_TOTAL = 1000

export const DEFAULT_CONFIG = {
  title: 'Rifa',
  total: 300,
  price: 5000,
  packSize: 2,
  packPrice: 8000,
  prizes: [
    'TV de 32"',
    'Pava eléctrica',
    'Kit de librería',
    'Voucher peluquería',
    'Book de fotos en La Plata',
  ],
  drawText: 'Sorteamos el 16 de noviembre por Lotería de la Provincia nocturna',
}

export const DEFAULT_SHARE = { mode: 'available', format: 'story' }

/** Largos máximos: los mismos que limitan los campos del formulario. */
export const LIMITS = { name: 80, phone: 30, email: 120, referrer: 80 }

export function cleanName(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

/** Clave para reconocer a la misma persona aunque cambien mayúsculas, tildes o espacios. */
export function personKey(name) {
  return cleanName(name)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

/**
 * Limpia y valida los datos de una persona. Con `lenient` (al restaurar respaldos de versiones
 * anteriores, que no tenían límites) recorta en vez de rechazar.
 */
function cleanPerson(person, { lenient = false } = {}) {
  const data = {
    name: cleanName(person.name),
    phone: String(person.phone ?? '').trim(),
    email: String(person.email ?? '').trim(),
    referrer: cleanName(person.referrer),
  }
  if (!data.name) throw new Error('El nombre es obligatorio')
  if (lenient) {
    for (const field of Object.keys(LIMITS)) data[field] = data[field].slice(0, LIMITS[field]).trim()
    return data
  }
  if (data.name.length > LIMITS.name) throw new Error(`El nombre puede tener hasta ${LIMITS.name} caracteres`)
  if (data.phone.length > LIMITS.phone) throw new Error(`El teléfono puede tener hasta ${LIMITS.phone} caracteres`)
  if (data.email.length > LIMITS.email) throw new Error(`El correo puede tener hasta ${LIMITS.email} caracteres`)
  if (data.referrer.length > LIMITS.referrer) {
    throw new Error(`El referido puede tener hasta ${LIMITS.referrer} caracteres`)
  }
  if (data.email && !/^[^\s@]+@[^\s@]+$/.test(data.email)) throw new Error('El correo no parece válido')
  return data
}

/** Devuelve el id de la persona con ese nombre, creándola si no existe. */
async function upsertParticipant(person) {
  const data = cleanPerson(person)
  const key = personKey(data.name)
  const existing = await db.participants.where('key').equals(key).first()
  if (existing) {
    // Si el contacto o el referido vienen vacíos se conserva lo que ya tenía.
    const patch = {}
    if (data.phone) patch.phone = data.phone
    if (data.email) patch.email = data.email
    if (data.referrer) patch.referrer = data.referrer
    if (Object.keys(patch).length) await db.participants.update(existing.id, patch)
    return existing.id
  }
  return db.participants.add({ ...data, key, createdAt: Date.now() })
}

let blobSupport = null

/**
 * ¿Este navegador puede guardar Blobs en IndexedDB? Safari en modo privado (y WebKit en
 * contextos efímeros) falla sin dar error útil, pero sí acepta ArrayBuffer. Se prueba una vez
 * en una base aparte, fuera de cualquier transacción de la app.
 */
export function supportsBlobStorage() {
  blobSupport ??= new Promise((resolve) => {
    let settled = false
    let probe = null
    const done = (ok) => {
      if (settled) return
      settled = true
      probe?.close()
      resolve(ok)
    }
    setTimeout(() => done(false), 3000)
    try {
      const request = indexedDB.open('rifa-blob-probe', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('probe')
      request.onerror = () => done(false)
      request.onsuccess = () => {
        probe = request.result
        try {
          const tx = probe.transaction('probe', 'readwrite')
          tx.objectStore('probe').put(new Blob(['ok'], { type: 'text/plain' }), 1)
          tx.oncomplete = () => done(true)
          tx.onerror = tx.onabort = () => done(false)
        } catch {
          done(false)
        }
      }
    } catch {
      done(false)
    }
  })
  return blobSupport
}

/** Deja un comprobante listo para guardar: si no se pueden guardar Blobs, va como bytes. */
async function storableReceipt(receipt) {
  if (!receipt?.blob || (await supportsBlobStorage())) return receipt
  const { blob, ...rest } = receipt
  return { ...rest, buffer: await blob.arrayBuffer() }
}

/** El archivo de un comprobante guardado, esté como Blob o como bytes. */
export function receiptBlob(receipt) {
  if (receipt.blob) return receipt.blob
  return new Blob(receipt.buffer ? [receipt.buffer] : [], { type: receipt.type })
}

/** Tablas que tocan las escrituras de números/personas/comprobantes. */
const SALES = () => [db.participants, db.tickets, db.purchases, db.receipts]

async function dropIfOrphan(participantId) {
  if (participantId == null) return
  const [owned, paid] = await Promise.all([
    db.tickets.where('participantId').equals(participantId).count(),
    db.purchases.where('participantId').equals(participantId).count(),
  ])
  if (owned === 0 && paid === 0) await db.participants.delete(participantId)
}

/** Borra el comprobante si ya no le queda ningún número. */
async function dropPurchaseIfEmpty(purchaseId) {
  if (purchaseId == null) return
  const purchase = await db.purchases.get(purchaseId)
  if (!purchase) return
  if ((await db.tickets.where('purchaseId').equals(purchaseId).count()) > 0) return
  await db.purchases.delete(purchaseId)
  await db.receipts.delete(purchaseId)
  await dropIfOrphan(purchase.participantId)
}

/** `null`/vacío = usar el calculado. Si no, un entero >= 0. */
export function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  if (!Number.isInteger(amount) || amount < 0) throw new Error('El monto tiene que ser un número entero mayor o igual a 0')
  return amount
}

async function readConfig() {
  return { ...DEFAULT_CONFIG, ...(await db.settings.get('config'))?.value }
}

/** Como `normalizeAmount`, pero un monto igual al calculado no es una corrección: queda `null`. */
async function purchaseAmount(value, count) {
  const amount = normalizeAmount(value)
  return amount !== null && amount === priceFor(count, await readConfig()) ? null : amount
}

/**
 * Asigna números a una persona y crea su comprobante.
 * @param {{ amount?: number|null, receipt?: object|null }} payment receipt viene de `prepareReceipt`
 */
export async function assignNumbers(numbers, person, { amount = null, receipt = null } = {}) {
  normalizeAmount(amount) // Falla antes de abrir la transacción si el monto es inválido.
  // Se convierte antes: dentro de una transacción de IndexedDB no se puede esperar otra cosa.
  receipt = await storableReceipt(receipt)
  return db.transaction('rw', [...SALES(), db.settings], async () => {
    const existing = await db.tickets.bulkGet(numbers)
    const taken = numbers.filter((_, i) => existing[i])
    if (taken.length) {
      throw new Error(`Ya están tomados: ${taken.join(', ')}`)
    }
    const participantId = await upsertParticipant(person)
    const now = Date.now()
    const fixedAmount = await purchaseAmount(amount, numbers.length)
    const purchaseId = await db.purchases.add({ participantId, createdAt: now, amount: fixedAmount })
    await db.tickets.bulkAdd(numbers.map((number) => ({ number, participantId, purchaseId, createdAt: now })))
    if (receipt) await db.receipts.put({ ...receipt, purchaseId })
    return purchaseId
  })
}

export function releaseNumber(number) {
  return db.transaction('rw', SALES(), async () => {
    const ticket = await db.tickets.get(number)
    if (!ticket) return
    await db.tickets.delete(number)
    await dropPurchaseIfEmpty(ticket.purchaseId)
    await dropIfOrphan(ticket.participantId)
  })
}

/** Anula una venta entera: libera sus números y borra el comprobante. */
export function voidPurchase(purchaseId) {
  return db.transaction('rw', SALES(), async () => {
    const purchase = await db.purchases.get(purchaseId)
    if (!purchase) return
    const tickets = await db.tickets.where('purchaseId').equals(purchaseId).toArray()
    await db.tickets.bulkDelete(tickets.map((t) => t.number))
    await db.purchases.delete(purchaseId)
    await db.receipts.delete(purchaseId)
    for (const id of new Set([purchase.participantId, ...tickets.map((t) => t.participantId)])) {
      await dropIfOrphan(id)
    }
  })
}

export async function setPurchaseAmount(purchaseId, amount) {
  normalizeAmount(amount)
  return db.transaction('rw', db.purchases, db.tickets, db.settings, async () => {
    if (!(await db.purchases.get(purchaseId))) throw new Error('El comprobante ya no existe')
    const count = await db.tickets.where('purchaseId').equals(purchaseId).count()
    await db.purchases.update(purchaseId, { amount: await purchaseAmount(amount, count) })
  })
}

export async function setReceipt(purchaseId, receipt) {
  receipt = await storableReceipt(receipt)
  return db.transaction('rw', db.purchases, db.receipts, async () => {
    if (!(await db.purchases.get(purchaseId))) throw new Error('El comprobante ya no existe')
    await db.receipts.put({ ...receipt, purchaseId })
  })
}

export function removeReceipt(purchaseId) {
  return db.receipts.delete(purchaseId)
}

/**
 * Edita los datos de una persona (afecta a todos sus números). Si el nombre nuevo
 * coincide con otra persona existente, se unifican.
 */
export function updateParticipant(id, person) {
  return db.transaction('rw', SALES(), async () => {
    const data = cleanPerson(person)
    const key = personKey(data.name)
    const clash = await db.participants.where('key').equals(key).first()
    if (clash && clash.id !== id) {
      await db.tickets.where('participantId').equals(id).modify({ participantId: clash.id })
      await db.purchases.where('participantId').equals(id).modify({ participantId: clash.id })
      await db.participants.update(clash.id, {
        phone: data.phone || clash.phone,
        email: data.email || clash.email,
        referrer: data.referrer || clash.referrer || '',
      })
      await db.participants.delete(id)
      return clash.id
    }
    await db.participants.update(id, { ...data, key })
    return id
  })
}

/** Pasa un número tomado a otra persona. El pago sigue en el comprobante original. */
export function transferNumber(number, person) {
  return db.transaction('rw', SALES(), async () => {
    const ticket = await db.tickets.get(number)
    if (!ticket) throw new Error(`El número ${number} no está tomado`)
    const participantId = await upsertParticipant(person)
    if (participantId === ticket.participantId) return participantId
    await db.tickets.update(number, { participantId })
    await dropIfOrphan(ticket.participantId)
    return participantId
  })
}

const toCount = (value, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}

/** Valida y completa una configuración (desde el formulario o desde un respaldo). */
export function normalizeConfig(raw) {
  const config = { ...DEFAULT_CONFIG, ...raw }
  const total = toCount(config.total, { min: 1, max: MAX_TOTAL })
  if (total === null) throw new Error(`La cantidad de números tiene que estar entre 1 y ${MAX_TOTAL}`)
  const [price, packSize, packPrice] = [config.price, config.packSize, config.packPrice].map((v) => toCount(v))
  if ([price, packSize, packPrice].includes(null)) throw new Error('Los precios tienen que ser números enteros')
  if (!Array.isArray(config.prizes)) throw new Error('Los premios tienen que ser una lista')
  return {
    title: String(config.title ?? '').trim().slice(0, 40),
    total,
    price,
    packSize,
    packPrice,
    prizes: config.prizes
      .map((p) => String(p ?? '').trim().slice(0, 60))
      .filter(Boolean)
      .slice(0, 20),
    drawText: String(config.drawText ?? '').trim().slice(0, 140),
  }
}

export async function saveConfig(raw) {
  const config = normalizeConfig(raw)
  await db.transaction('rw', db.settings, db.tickets, async () => {
    const last = await db.tickets.orderBy('number').last()
    if (last && last.number > config.total) {
      throw new Error(`No podés bajar el total a ${config.total}: el número ${last.number} está tomado`)
    }
    await db.settings.put({ key: 'config', value: config })
  })
}

export function saveSharePrefs(prefs) {
  return db.settings.put({ key: 'share', value: prefs })
}

export function clearNumbers() {
  return db.transaction('rw', SALES(), async () => {
    await Promise.all(SALES().map((table) => table.clear()))
  })
}

const BACKUP_APP = 'rifa'
const BACKUP_SCHEMA = 2

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // De a pedazos: pasar millones de argumentos a fromCharCode desborda la pila.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

export async function exportBackup() {
  // Una sola transacción de lectura: si no, una escritura entre lecturas deja un respaldo
  // inconsistente (números con un comprobante que no está) que después no se puede restaurar.
  const [participants, tickets, purchases, receipts, settings] = await db.transaction(
    'r',
    [...SALES(), db.settings],
    () =>
      Promise.all([
        db.participants.toArray(),
        db.tickets.toArray(),
        db.purchases.toArray(),
        db.receipts.toArray(),
        db.settings.toArray(),
      ]),
  )
  return {
    app: BACKUP_APP,
    schema: BACKUP_SCHEMA,
    exportedAt: new Date().toISOString(),
    participants,
    tickets,
    purchases,
    // Los archivos viajan en base64 dentro del JSON.
    receipts: await Promise.all(
      receipts.map(async (r) => {
        const { blob: _blob, buffer: _buffer, ...meta } = r
        return { ...meta, data: await blobToDataUrl(receiptBlob(r)) }
      }),
    ),
    settings,
  }
}

async function parseBackup(data) {
  const fail = (msg) => {
    throw new Error(`Respaldo inválido: ${msg}`)
  }
  if (!data || data.app !== BACKUP_APP) fail('no es un archivo de esta app')
  if (data.schema !== 1 && data.schema !== BACKUP_SCHEMA) fail(`versión ${data.schema} no soportada`)
  if (![data.participants, data.tickets, data.settings].every(Array.isArray)) fail('faltan datos')

  const participants = data.participants.map((p) => {
    if (!Number.isInteger(p?.id) || !cleanName(p.name)) fail('persona sin id o sin nombre')
    const person = cleanPerson(p, { lenient: true })
    return { ...person, id: p.id, key: personKey(person.name), createdAt: Number(p.createdAt) || Date.now() }
  })
  const keys = new Set(participants.map((p) => p.key))
  if (keys.size !== participants.length) fail('hay personas repetidas')
  const ids = new Set(participants.map((p) => p.id))

  const tickets = data.tickets.map((t) => {
    if (!Number.isInteger(t?.number) || t.number < 1 || t.number > MAX_TOTAL) fail('número fuera de rango')
    if (!ids.has(t.participantId)) fail(`el número ${t.number} no tiene dueño`)
    return {
      number: t.number,
      participantId: t.participantId,
      purchaseId: t.purchaseId,
      createdAt: Number(t.createdAt) || Date.now(),
    }
  })
  if (new Set(tickets.map((t) => t.number)).size !== tickets.length) fail('hay números repetidos')

  let purchases
  if (data.schema === 1) {
    purchases = groupLegacyTickets(tickets).map((g, i) => {
      for (const t of tickets) if (g.numbers.includes(t.number)) t.purchaseId = i + 1
      return { id: i + 1, participantId: g.participantId, createdAt: g.createdAt, amount: null }
    })
  } else {
    if (!Array.isArray(data.purchases)) fail('faltan los comprobantes')
    purchases = data.purchases.map((p) => {
      if (!Number.isInteger(p?.id) || !ids.has(p.participantId)) fail('comprobante sin id o sin persona')
      let amount
      try {
        amount = normalizeAmount(p.amount)
      } catch {
        fail(`monto inválido en el comprobante ${p.id}`)
      }
      return { id: p.id, participantId: p.participantId, createdAt: Number(p.createdAt) || Date.now(), amount }
    })
  }
  const purchaseIds = new Set(purchases.map((p) => p.id))
  if (purchaseIds.size !== purchases.length) fail('hay comprobantes repetidos')
  for (const t of tickets) if (!purchaseIds.has(t.purchaseId)) fail(`el número ${t.number} no tiene comprobante`)

  const receipts = []
  const withReceipt = new Set()
  for (const r of data.receipts ?? []) {
    if (!purchaseIds.has(r?.purchaseId) || typeof r.data !== 'string' || !r.data.startsWith('data:')) {
      fail('comprobante adjunto dañado')
    }
    if (withReceipt.has(r.purchaseId)) fail(`el comprobante ${r.purchaseId} tiene dos archivos adjuntos`)
    withReceipt.add(r.purchaseId)
    const blob = await (await fetch(r.data)).blob()
    // Tipo y tamaño salen del archivo mismo, no de lo que diga el JSON.
    receipts.push({
      purchaseId: r.purchaseId,
      name: typeof r.name === 'string' ? r.name : '',
      addedAt: Number(r.addedAt) || Date.now(),
      blob,
      type: blob.type || 'application/octet-stream',
      size: blob.size,
      thumb: typeof r.thumb === 'string' && r.thumb.startsWith('data:image/') ? r.thumb : null,
    })
  }

  for (let i = 0; i < receipts.length; i++) receipts[i] = await storableReceipt(receipts[i])

  const settings = data.settings.filter((s) => s && (s.key === 'config' || s.key === 'share'))
  const configRow = settings.find((s) => s.key === 'config')
  if (configRow) {
    try {
      configRow.value = normalizeConfig(configRow.value)
    } catch (err) {
      fail(err.message)
    }
  }
  const total = configRow?.value.total ?? DEFAULT_CONFIG.total
  const outside = tickets.find((t) => t.number > total)
  if (outside) fail(`el número ${outside.number} supera el total de ${total}`)

  return { participants, tickets, purchases, receipts, settings }
}

export async function importBackup(data) {
  // Se parsea (y se decodifican los archivos) antes de abrir la transacción:
  // IndexedDB cierra las transacciones que esperan trabajo ajeno a la base.
  const parsed = await parseBackup(data)
  const tables = [...SALES(), db.settings]
  await db.transaction('rw', tables, async () => {
    await Promise.all(tables.map((table) => table.clear()))
    await db.participants.bulkAdd(parsed.participants)
    await db.purchases.bulkAdd(parsed.purchases)
    await db.tickets.bulkAdd(parsed.tickets)
    await db.receipts.bulkAdd(parsed.receipts)
    await db.settings.bulkAdd(parsed.settings)
  })
  return {
    participants: parsed.participants.length,
    tickets: parsed.tickets.length,
    receipts: parsed.receipts.length,
  }
}
