import Dexie from 'dexie'
import { DEFAULT_TEXT_FONT, DEFAULT_TITLE_FONT, TEXT_FONTS, TITLE_FONTS } from './lib/fonts.js'
import { priceFor } from './lib/format.js'
import { newId } from './lib/ids.js'
import { IMAGE_FORMATS, IMAGE_MODES } from './lib/shareImage.js'
import { DEFAULT_THEME, THEMES, normalizeImageColors } from './lib/themes.js'
import { applySnapshotRows, opKeys } from './sync/local.js'
import { explainSyncError } from './sync/transport.js'

/**
 * Base de datos local (IndexedDB). Es la única fuente de verdad de la app:
 * la UI lee todo con consultas en vivo y escribe sólo a través de estas funciones.
 *
 * Puede haber varias rifas. Los ids son UUID generados acá (ver lib/ids.js) y cada fila
 * dice a qué rifa pertenece con `raffleId`.
 *
 * - raffles: una por rifa, con su configuración (`config`) y la de su imagen (`share`).
 *   `archivedAt` sólo la agrupa aparte en la lista. `lastSeq` es el último número de comprobante usado.
 *   `remote` es `null` en una rifa local; en una rifa en la nube,
 *   `{ syncedVersion, role, ranges, userId, lastSyncAt, status, needsReconcile, syncPending, syncCycleId, syncError }`
 *   (ver docs/sync-protocolo.md).
 * - people: personas de una rifa (clave única por nombre normalizado dentro de la rifa).
 *   `referrer` es quién la trajo, texto libre.
 * - numbers: sólo los números tomados; un número sin fila está disponible. El id es
 *   `raffleId:number`, así que un número no se puede vender dos veces.
 *   `participantId` es el dueño del número y `purchaseId` el comprobante con que se pagó.
 * - sales: una por asignación (el "comprobante"). `amount: null` = usar el monto calculado.
 *   `seq` es el número de comprobante que se muestra (#1, #2…), correlativo dentro de la rifa y
 *   sin reusar los de ventas anuladas. En una rifa en la nube es provisorio hasta que lo confirma
 *   el servidor, y `createdBy` dice quién vendió.
 * - receipts: imagen o PDF del comprobante, aparte para no cargar blobs en cada consulta.
 *   Normalmente en `blob`; donde IndexedDB no acepta Blobs (Safari en modo privado), en `buffer`.
 *   Los que llegaron del servidor sin el archivo tienen `remote: true` (sólo metadata y miniatura).
 * - outbox: operaciones de las rifas en la nube que todavía no recibió el servidor, en orden.
 *   Se escriben en la misma transacción que el cambio local. Las rifas locales nunca generan filas.
 * - uploads: archivos de comprobantes que esperan subirse (el archivo queda en receipts).
 * - conflicts: operaciones que el servidor rechazó, para explicarlas.
 * - settings: lo que es de este dispositivo y no de una rifa: el tema (`appearance`),
 *   la rifa abierta (`activeRaffle`), la sesión (`auth`) y el estado de la sincronización (`syncState`).
 */

/** Esquema y migraciones: el mismo para la base de la app y para las que se crean en los tests. */
function defineSchema(db) {
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

  // IndexedDB no deja cambiar la clave primaria de una tabla: las que pasan a ids UUID
  // (o a `raffleId:number`) son tablas nuevas, y las viejas se borran después de copiarlas.
  db.version(3)
    .stores({
      participants: null,
      tickets: null,
      purchases: null,
      raffles: 'id, createdAt',
      people: 'id, raffleId, &[raffleId+key]',
      numbers: 'id, [raffleId+number], participantId, purchaseId',
      sales: 'id, raffleId, participantId',
      receipts: 'purchaseId, raffleId',
      settings: 'key',
    })
    .upgrade(moveToRaffles)

  // Sincronización: las rifas que ya había son locales.
  db.version(4)
    .stores({
      outbox: '++seq, raffleId, opId',
      uploads: 'saleId, raffleId',
      conflicts: '++id, raffleId',
    })
    .upgrade((tx) =>
      tx
        .table('raffles')
        .toCollection()
        .modify((raffle) => {
          raffle.remote ??= null
        }),
    )

  // Instalación nueva: arranca con una rifa lista para usar.
  db.on('populate', (tx) => {
    const raffle = raffleRow()
    tx.table('raffles').add(raffle)
    tx.table('settings').put({ key: 'activeRaffle', value: raffle.id })
  })
}

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

/** v2 → v3: lo que había pasa a ser la primera rifa, con ids nuevos. */
async function moveToRaffles(tx) {
  const settings = new Map((await tx.table('settings').toArray()).map((s) => [s.key, s.value]))
  const [participants, tickets, purchases, receipts] = await Promise.all([
    tx.table('participants').toArray(),
    tx.table('tickets').toArray(),
    tx.table('purchases').toArray(),
    tx.table('receipts').toArray(),
  ])
  const firstUse = [...participants, ...purchases].reduce((min, row) => Math.min(min, Number(row.createdAt) || min), Date.now())
  const raffle = raffleRow({
    config: { ...DEFAULT_CONFIG, ...settings.get('config') },
    share: normalizeSharePrefs(settings.get('share')),
    createdAt: firstUse,
    lastSeq: purchases.reduce((max, p) => Math.max(max, p.id), 0),
  })
  const personIds = new Map(participants.map((p) => [p.id, newId()]))
  const saleIds = new Map(purchases.map((p) => [p.id, newId()]))

  await tx.table('raffles').add(raffle)
  await tx.table('people').bulkAdd(participants.map((p) => ({ ...p, id: personIds.get(p.id), raffleId: raffle.id })))
  await tx.table('sales').bulkAdd(
    // El número de comprobante que se veía (el id viejo) se mantiene.
    purchases.map((p) => ({
      ...p,
      id: saleIds.get(p.id),
      seq: p.id,
      raffleId: raffle.id,
      participantId: personIds.get(p.participantId),
    })),
  )
  await tx.table('numbers').bulkAdd(
    tickets.map((t) => ({
      ...t,
      id: numberId(raffle.id, t.number),
      raffleId: raffle.id,
      participantId: personIds.get(t.participantId),
      purchaseId: saleIds.get(t.purchaseId),
    })),
  )
  await tx.table('receipts').clear()
  await tx.table('receipts').bulkAdd(
    receipts
      .filter((r) => saleIds.has(r.purchaseId))
      .map((r) => ({ ...r, purchaseId: saleIds.get(r.purchaseId), raffleId: raffle.id })),
  )
  await tx.table('settings').bulkDelete(['config', 'share'])
  await tx.table('settings').put({ key: 'activeRaffle', value: raffle.id })
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

/** Una rifa nueva sin copiar otra: los premios y el texto del sorteo son de cada rifa. */
const BLANK_CONFIG = { ...DEFAULT_CONFIG, prizes: [], drawText: '' }

/**
 * Preferencias de la imagen. `palette` es 'app' (sigue al tema de la app), el id de un tema
 * o 'custom' (usa `colors`, ver IMAGE_COLOR_FIELDS en lib/themes.js).
 */
export const DEFAULT_SHARE = {
  mode: 'available',
  format: 'story',
  palette: 'app',
  colors: null,
  titleFont: DEFAULT_TITLE_FONT,
  textFont: DEFAULT_TEXT_FONT,
}

export const DEFAULT_APPEARANCE = { theme: DEFAULT_THEME }

/** Largos máximos: los mismos que limitan los campos del formulario. */
export const LIMITS = { name: 80, phone: 30, email: 120, referrer: 80 }

export function numberId(raffleId, number) {
  return `${raffleId}:${number}`
}

function raffleRow({ config = DEFAULT_CONFIG, share = DEFAULT_SHARE, createdAt = Date.now(), lastSeq = 0 } = {}) {
  return { id: newId(), config, share, createdAt, archivedAt: null, lastSeq, remote: null }
}

/** La configuración de una rifa, completa aunque se haya guardado con una versión anterior. */
export function raffleConfig(raffle) {
  return { ...DEFAULT_CONFIG, ...raffle?.config }
}

/**
 * La rifa a abrir cuando no hay una elegida (o la elegida ya no existe): la más nueva sin archivar.
 * Si dos se crearon en el mismo milisegundo desempata el id (los UUIDv7 crecen con el tiempo).
 */
export function fallbackRaffle(raffles) {
  const newest = [...raffles].sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
  return newest.find((r) => !r.archivedAt) ?? newest[0] ?? null
}

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
export function cleanPerson(person, { lenient = false } = {}) {
  const data = {
    name: cleanName(person?.name),
    phone: String(person?.phone ?? '').trim(),
    email: String(person?.email ?? '').trim(),
    referrer: cleanName(person?.referrer),
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
export async function storableReceipt(receipt) {
  if (!receipt?.blob || (await supportsBlobStorage())) return receipt
  const { blob, ...rest } = receipt
  return { ...rest, buffer: await blob.arrayBuffer() }
}

/** ¿Está guardado el archivo del comprobante? (Los que vinieron del servidor pueden no tenerlo todavía.) */
export function hasReceiptFile(receipt) {
  return Boolean(receipt?.blob || receipt?.buffer)
}

/** El archivo de un comprobante guardado, esté como Blob o como bytes. */
export function receiptBlob(receipt) {
  if (receipt.blob) return receipt.blob
  return new Blob(receipt.buffer ? [receipt.buffer] : [], { type: receipt.type })
}

/** Lo que viaja al servidor de un comprobante (el archivo va aparte). */
function receiptMeta(receipt) {
  return {
    name: receipt.name ?? '',
    type: receipt.type,
    size: receipt.size,
    thumb: receipt.thumb ?? null,
    addedAt: receipt.addedAt,
  }
}

/** `null`/vacío = usar el calculado. Si no, un entero >= 0. */
export function normalizeAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const amount = Number(value)
  if (!Number.isInteger(amount) || amount < 0) throw new Error('El monto tiene que ser un número entero mayor o igual a 0')
  return amount
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

const oneOf = (value, options, fallback) => (typeof value === 'string' && Object.hasOwn(options, value) ? value : fallback)

/** Completa y valida las preferencias de la imagen: lo desconocido (de otra versión) vuelve al valor por defecto. */
export function normalizeSharePrefs(raw) {
  const prefs = { ...DEFAULT_SHARE, ...raw }
  const palette = prefs.palette === 'app' || prefs.palette === 'custom' ? prefs.palette : oneOf(prefs.palette, THEMES, 'app')
  return {
    mode: oneOf(prefs.mode, IMAGE_MODES, DEFAULT_SHARE.mode),
    format: oneOf(prefs.format, IMAGE_FORMATS, DEFAULT_SHARE.format),
    palette,
    colors: normalizeImageColors(prefs.colors),
    titleFont: oneOf(prefs.titleFont, TITLE_FONTS, DEFAULT_TITLE_FONT),
    textFont: oneOf(prefs.textFont, TEXT_FONTS, DEFAULT_TEXT_FONT),
  }
}

export function normalizeAppearance(raw) {
  return { theme: oneOf(raw?.theme, THEMES, DEFAULT_THEME) }
}

/** ¿El número está dentro del talonario? (`null` = sin talonario.) */
export function inRanges(ranges, number) {
  return !ranges || ranges.some(([from, to]) => number >= from && number <= to)
}

const BACKUP_APP = 'rifa'
const BACKUP_SCHEMA = 3

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  // De a pedazos: pasar millones de argumentos a fromCharCode desborda la pila.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

/** Ids del archivo: enteros en los respaldos viejos, UUID desde el formato 3. */
const isBackupId = (id) => Number.isInteger(id) || (typeof id === 'string' && id.length > 0 && id.length <= 64)

async function parseBackup(data) {
  const fail = (msg) => {
    throw new Error(`Respaldo inválido: ${msg}`)
  }
  if (!data || data.app !== BACKUP_APP) fail('no es un archivo de esta app')
  if (![1, 2, BACKUP_SCHEMA].includes(data.schema)) fail(`versión ${data.schema} no soportada`)
  if (![data.participants, data.tickets].every(Array.isArray)) fail('faltan datos')
  // Hasta el formato 2 el respaldo era de toda la app: la rifa sale de sus filas de configuración.
  let rawRaffle
  if (data.schema === BACKUP_SCHEMA) {
    if (!data.raffle || typeof data.raffle !== 'object') fail('faltan los datos de la rifa')
    rawRaffle = data.raffle
  } else {
    if (!Array.isArray(data.settings)) fail('faltan datos')
    const setting = (key) => data.settings.find((s) => s?.key === key)?.value
    rawRaffle = { config: setting('config'), share: setting('share') }
  }

  const participants = data.participants.map((p) => {
    if (!isBackupId(p?.id) || !cleanName(p.name)) fail('persona sin id o sin nombre')
    const person = cleanPerson(p, { lenient: true })
    return { ...person, id: p.id, key: personKey(person.name), createdAt: Number(p.createdAt) || Date.now() }
  })
  const keys = new Set(participants.map((p) => p.key))
  if (keys.size !== participants.length) fail('hay personas repetidas')
  const ids = new Set(participants.map((p) => p.id))
  if (ids.size !== participants.length) fail('hay personas con el mismo id')

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
      return { id: i + 1, seq: i + 1, participantId: g.participantId, createdAt: g.createdAt, amount: null }
    })
  } else {
    if (!Array.isArray(data.purchases)) fail('faltan los comprobantes')
    purchases = data.purchases.map((p) => {
      if (!isBackupId(p?.id) || !ids.has(p.participantId)) fail('comprobante sin id o sin persona')
      let amount
      try {
        amount = normalizeAmount(p.amount)
      } catch {
        fail(`monto inválido en el comprobante ${p.id}`)
      }
      // Hasta el formato 2 el número de comprobante era el id.
      const seq = data.schema === 2 ? p.id : p.seq
      return {
        id: p.id,
        seq: Number.isInteger(seq) && seq > 0 ? seq : null,
        participantId: p.participantId,
        createdAt: Number(p.createdAt) || Date.now(),
        amount,
      }
    })
    // Los que no traen número siguen la numeración, en orden de venta.
    let next = Math.max(0, ...purchases.map((p) => p.seq ?? 0))
    for (const p of [...purchases].sort((a, b) => a.createdAt - b.createdAt)) p.seq ??= ++next
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

  let config = DEFAULT_CONFIG
  if (rawRaffle.config) {
    try {
      config = normalizeConfig(rawRaffle.config)
    } catch (err) {
      fail(err.message)
    }
  }
  const outside = tickets.find((t) => t.number > config.total)
  if (outside) fail(`el número ${outside.number} supera el total de ${config.total}`)

  return { config, share: normalizeSharePrefs(rawRaffle.share), participants, tickets, purchases, receipts }
}

/**
 * Crea las funciones de acceso a una base. La app usa una sola (`rifa`, exportada abajo);
 * los tests de sincronización crean otras para simular varios teléfonos.
 */
export function createStore(name = 'rifa') {
  const db = new Dexie(name)
  defineSchema(db)

  /** Tablas que tocan las escrituras: datos de la rifa, operaciones pendientes y la sesión (para `createdBy`). */
  const WRITE = () => [db.raffles, db.people, db.numbers, db.sales, db.receipts, db.outbox, db.uploads, db.settings]
  const SALES = () => [db.raffles, db.people, db.numbers, db.sales, db.receipts]

  /** Los números tomados de una rifa, ordenados. */
  function raffleNumbers(raffleId) {
    return db.numbers.where('[raffleId+number]').between([raffleId, Dexie.minKey], [raffleId, Dexie.maxKey])
  }

  function findPerson(raffleId, key) {
    return db.people.where('[raffleId+key]').equals([raffleId, key]).first()
  }

  /** La persona de la sesión de este dispositivo (`{ id, name }`), o `null`. */
  async function currentUser() {
    const user = (await db.settings.get('auth'))?.value?.user
    return user ? { id: user.id, name: user.name } : null
  }

  /**
   * Devuelve el id de la persona con ese nombre en la rifa, creándola si no existe, junto con
   * los datos limpios y si cambió algo. En una rifa en la nube (`fillEmpty`) sólo se completan
   * los datos vacíos de quien ya existía, como hace el servidor.
   */
  async function upsertParticipant(raffleId, person, { fillEmpty = false } = {}) {
    const data = cleanPerson(person)
    const key = personKey(data.name)
    const existing = await findPerson(raffleId, key)
    if (existing) {
      // Si el contacto o el referido vienen vacíos se conserva lo que ya tenía.
      const patch = {}
      for (const field of ['phone', 'email', 'referrer']) {
        if (data[field] && data[field] !== existing[field] && !(fillEmpty && existing[field])) patch[field] = data[field]
      }
      if (Object.keys(patch).length) await db.people.update(existing.id, patch)
      return { id: existing.id, data, changed: Object.keys(patch).length > 0 }
    }
    const id = await db.people.add({ ...data, id: newId(), raffleId, key, createdAt: Date.now() })
    return { id, data, changed: true }
  }

  async function readRaffle(raffleId) {
    const raffle = await db.raffles.get(raffleId)
    if (!raffle) throw new Error('La rifa ya no existe')
    return raffle
  }

  /**
   * En una rifa en la nube, lo que el servidor rechazaría seguro se avisa antes, sin generar un
   * conflicto: rifa borrada o sin acceso, rol que no alcanza o número fuera del talonario.
   */
  function assertWritable(raffle, { numbers = [], ownerOnly = false, saleBy, user } = {}) {
    const remote = raffle.remote
    if (!remote) return
    if (remote.status === 'deleted') throw new Error('Esta rifa se borró de la nube: ya no se puede modificar.')
    if (remote.status === 'revoked') throw new Error('Ya no tenés acceso a esta rifa: no se puede modificar.')
    if (user && remote.userId != null && user.id !== remote.userId) {
      throw new Error('Esta rifa es de otra cuenta. Iniciá sesión con esa cuenta para modificarla.')
    }
    if (remote.role === 'viewer') throw new Error('Sólo podés ver esta rifa: no podés hacer cambios.')
    if (ownerOnly && remote.role && remote.role !== 'owner') {
      throw new Error('Sólo quien organiza la rifa puede cambiar la configuración.')
    }
    if (remote.role === 'seller') {
      const outside = numbers.filter((n) => !inRanges(remote.ranges, n))
      if (outside.length === 1) throw new Error(`El número ${outside[0]} está fuera de tu talonario`)
      if (outside.length > 1) throw new Error(`Los números ${outside.join(', ')} están fuera de tu talonario`)
      if (saleBy !== undefined && remote.userId != null && saleBy?.id !== remote.userId) {
        throw new Error('Sólo podés anular las ventas que hiciste vos.')
      }
    }
  }

  /**
   * `assertWritable` con la sesión de este dispositivo: una rifa en la nube de otra cuenta no se
   * modifica (sus cambios saldrían a nombre de quien tiene la sesión). Sin sesión sí se puede: los
   * cambios esperan en el outbox hasta que vuelva a iniciar sesión.
   */
  async function checkWritable(raffle, options = {}) {
    const user = raffle.remote ? await currentUser() : null
    assertWritable(raffle, { ...options, user })
  }

  /**
   * Agrega al outbox la operación de un cambio. Se llama dentro de la transacción del cambio:
   * si algo falla, no queda ni el cambio ni la operación. En las rifas locales no hace nada.
   * `touches` son entidades que el cambio afectó además de las del payload (p. ej. la venta que
   * se borra al liberar su último número), para que el pull no las pise mientras esté pendiente.
   */
  async function queueOp(raffle, type, payload, touches = []) {
    if (!raffle?.remote) return
    const keys = [...new Set([...opKeys(type, payload), ...touches.filter((k) => !/:(undefined|null)$/.test(k))])]
    await db.outbox.add({ opId: newId(), raffleId: raffle.id, type, payload, keys, createdAt: Date.now(), attempts: 0, error: null })
  }

  /** Comprobante nuevo en una rifa en la nube: su metadata va al outbox y el archivo, a la cola de subida. */
  async function queueReceipt(raffle, saleId, receipt) {
    if (!raffle?.remote) return
    await queueOp(raffle, 'receipt.set', { saleId, meta: receiptMeta(receipt) })
    await db.uploads.put({ saleId, raffleId: raffle.id, addedAt: receipt.addedAt, createdAt: Date.now() })
  }

  /** En la nube, el comprobante tiene que saber su fecha y tamaño: así se reconoce el mismo archivo al volver del servidor. */
  function completeReceipt(raffle, receipt) {
    if (!raffle.remote || !receipt) return receipt
    return {
      ...receipt,
      addedAt: receipt.addedAt ?? Date.now(),
      size: receipt.size ?? receipt.blob?.size ?? receipt.buffer?.byteLength ?? 0,
    }
  }

  async function dropIfOrphan(participantId) {
    if (participantId == null) return
    const [owned, paid] = await Promise.all([
      db.numbers.where('participantId').equals(participantId).count(),
      db.sales.where('participantId').equals(participantId).count(),
    ])
    if (owned === 0 && paid === 0) await db.people.delete(participantId)
  }

  /** Borra el comprobante si ya no le queda ningún número. */
  async function dropPurchaseIfEmpty(purchaseId) {
    if (purchaseId == null) return
    const purchase = await db.sales.get(purchaseId)
    if (!purchase) return
    if ((await db.numbers.where('purchaseId').equals(purchaseId).count()) > 0) return
    await db.sales.delete(purchaseId)
    await db.receipts.delete(purchaseId)
    await db.uploads.delete(purchaseId)
    await dropIfOrphan(purchase.participantId)
  }

  /** Como `normalizeAmount`, pero un monto igual al calculado no es una corrección: queda `null`. */
  async function purchaseAmount(raffleId, value, count) {
    const amount = normalizeAmount(value)
    return amount !== null && amount === priceFor(count, raffleConfig(await readRaffle(raffleId))) ? null : amount
  }

  /**
   * Asigna números de una rifa a una persona y crea su comprobante.
   * @param {{ amount?: number|null, receipt?: object|null }} payment receipt viene de `prepareReceipt`
   */
  async function assignNumbers(raffleId, numbers, person, { amount = null, receipt = null } = {}) {
    normalizeAmount(amount) // Falla antes de abrir la transacción si el monto es inválido.
    // Se convierte antes: dentro de una transacción de IndexedDB no se puede esperar otra cosa.
    receipt = await storableReceipt(receipt)
    return db.transaction('rw', WRITE(), async () => {
      const raffle = await readRaffle(raffleId)
      const existing = await db.numbers.bulkGet(numbers.map((n) => numberId(raffleId, n)))
      const taken = numbers.filter((_, i) => existing[i])
      if (taken.length) {
        throw new Error(`Ya están tomados: ${taken.join(', ')}`)
      }
      await checkWritable(raffle, { numbers })
      const { id: participantId, data } = await upsertParticipant(raffleId, person, { fillEmpty: Boolean(raffle.remote) })
      const now = Date.now()
      const fixedAmount = await purchaseAmount(raffleId, amount, numbers.length)
      // En una rifa en la nube es provisorio: el definitivo lo asigna el servidor.
      const seq = (raffle.lastSeq ?? 0) + 1
      await db.raffles.update(raffleId, { lastSeq: seq })
      const sale = { id: newId(), raffleId, seq, participantId, createdAt: now, amount: fixedAmount }
      // Sin sesión (los cambios esperan en el outbox) se sabe igual de qué cuenta es la rifa.
      const createdBy = raffle.remote
        ? ((await currentUser()) ?? (raffle.remote.userId != null ? { id: raffle.remote.userId, name: '' } : null))
        : undefined
      if (raffle.remote) sale.createdBy = createdBy
      const purchaseId = await db.sales.add(sale)
      await db.numbers.bulkAdd(
        numbers.map((number) => ({
          id: numberId(raffleId, number),
          raffleId,
          number,
          participantId,
          purchaseId,
          createdAt: now,
          ...(raffle.remote && { createdBy }),
        })),
      )
      receipt = completeReceipt(raffle, receipt)
      if (receipt) await db.receipts.put({ ...receipt, purchaseId, raffleId })
      await queueOp(raffle, 'numbers.assign', {
        saleId: purchaseId,
        seq,
        numbers: [...numbers],
        person: { id: participantId, ...data },
        amount: fixedAmount,
        createdAt: now,
      })
      if (receipt) await queueReceipt(raffle, purchaseId, receipt)
      return purchaseId
    })
  }

  function releaseNumber(raffleId, number) {
    return db.transaction('rw', WRITE(), async () => {
      const ticket = await db.numbers.get(numberId(raffleId, number))
      if (!ticket) return
      const raffle = await readRaffle(raffleId)
      await checkWritable(raffle, { numbers: [number] })
      const purchase = await db.sales.get(ticket.purchaseId)
      await db.numbers.delete(ticket.id)
      await dropPurchaseIfEmpty(ticket.purchaseId)
      await dropIfOrphan(ticket.participantId)
      // El servidor deriva solo lo demás (venta vacía, persona sin números): va sólo la liberación.
      await queueOp(raffle, 'number.release', { number }, [
        `sale:${ticket.purchaseId}`,
        `receipt:${ticket.purchaseId}`,
        `person:${ticket.participantId}`,
        `person:${purchase?.participantId}`,
      ])
    })
  }

  /** Anula una venta entera: libera sus números y borra el comprobante. */
  function voidPurchase(purchaseId) {
    return db.transaction('rw', WRITE(), async () => {
      const purchase = await db.sales.get(purchaseId)
      if (!purchase) return
      const raffle = await readRaffle(purchase.raffleId)
      await checkWritable(raffle, { saleBy: purchase.createdBy ?? null })
      const tickets = await db.numbers.where('purchaseId').equals(purchaseId).toArray()
      await db.numbers.bulkDelete(tickets.map((t) => t.id))
      await db.sales.delete(purchaseId)
      await db.receipts.delete(purchaseId)
      await db.uploads.delete(purchaseId)
      const people = new Set([purchase.participantId, ...tickets.map((t) => t.participantId)])
      for (const id of people) {
        await dropIfOrphan(id)
      }
      await queueOp(raffle, 'sale.void', { saleId: purchaseId }, [
        ...tickets.map((t) => `number:${t.number}`),
        ...[...people].map((id) => `person:${id}`),
      ])
    })
  }

  async function setPurchaseAmount(purchaseId, amount) {
    normalizeAmount(amount)
    return db.transaction('rw', WRITE(), async () => {
      const purchase = await db.sales.get(purchaseId)
      if (!purchase) throw new Error('El comprobante ya no existe')
      const raffle = await readRaffle(purchase.raffleId)
      await checkWritable(raffle)
      const count = await db.numbers.where('purchaseId').equals(purchaseId).count()
      const fixed = await purchaseAmount(purchase.raffleId, amount, count)
      await db.sales.update(purchaseId, { amount: fixed })
      await queueOp(raffle, 'sale.setAmount', { saleId: purchaseId, amount: fixed })
    })
  }

  async function setReceipt(purchaseId, receipt) {
    receipt = await storableReceipt(receipt)
    return db.transaction('rw', WRITE(), async () => {
      const purchase = await db.sales.get(purchaseId)
      if (!purchase) throw new Error('El comprobante ya no existe')
      const raffle = await db.raffles.get(purchase.raffleId)
      if (raffle) {
        await checkWritable(raffle)
        receipt = completeReceipt(raffle, receipt)
      }
      await db.receipts.put({ ...receipt, purchaseId, raffleId: purchase.raffleId })
      await queueReceipt(raffle, purchaseId, receipt)
    })
  }

  function removeReceipt(purchaseId) {
    return db.transaction('rw', WRITE(), async () => {
      const receipt = await db.receipts.get(purchaseId)
      if (!receipt) return
      const raffle = await db.raffles.get(receipt.raffleId)
      if (raffle) await checkWritable(raffle)
      await db.receipts.delete(purchaseId)
      await db.uploads.delete(purchaseId)
      await queueOp(raffle, 'receipt.remove', { saleId: purchaseId })
    })
  }

  /** Baja el archivo de un comprobante que vino del servidor y lo deja guardado en el dispositivo. */
  async function storeReceiptFile(purchaseId, blob) {
    const stored = await storableReceipt({ blob })
    return db.transaction('rw', db.receipts, async () => {
      const receipt = await db.receipts.get(purchaseId)
      if (!receipt) throw new Error('El comprobante ya no existe')
      const { remote: _remote, hasFile: _hasFile, blob: _blob, buffer: _buffer, ...meta } = receipt
      await db.receipts.put({ ...meta, ...stored })
    })
  }

  /**
   * Edita los datos de una persona (afecta a todos sus números). Si el nombre nuevo
   * coincide con otra persona de la misma rifa, se unifican.
   */
  function updateParticipant(id, person) {
    return db.transaction('rw', WRITE(), async () => {
      const data = cleanPerson(person)
      const current = await db.people.get(id)
      if (!current) throw new Error('La persona ya no existe')
      const raffle = await readRaffle(current.raffleId)
      await checkWritable(raffle)
      const key = personKey(data.name)
      const clash = await findPerson(current.raffleId, key)
      await queueOp(raffle, 'person.update', { personId: id, data }, clash ? [`person:${clash.id}`] : [])
      if (clash && clash.id !== id) {
        await db.numbers.where('participantId').equals(id).modify({ participantId: clash.id })
        await db.sales.where('participantId').equals(id).modify({ participantId: clash.id })
        // En la nube, como en el servidor, la persona que queda sólo completa sus datos vacíos.
        const keep = (field) => (raffle.remote ? clash[field] || data[field] : data[field] || clash[field]) || ''
        await db.people.update(clash.id, { phone: keep('phone'), email: keep('email'), referrer: keep('referrer') })
        await db.people.delete(id)
        return clash.id
      }
      await db.people.update(id, { ...data, key })
      return id
    })
  }

  /** Pasa un número tomado a otra persona. El pago sigue en el comprobante original. */
  function transferNumber(raffleId, number, person) {
    return db.transaction('rw', WRITE(), async () => {
      const ticket = await db.numbers.get(numberId(raffleId, number))
      if (!ticket) throw new Error(`El número ${number} no está tomado`)
      const raffle = await readRaffle(raffleId)
      await checkWritable(raffle, { numbers: [number] })
      const { id: participantId, data, changed } = await upsertParticipant(raffleId, person, { fillEmpty: Boolean(raffle.remote) })
      const moved = participantId !== ticket.participantId
      if (moved || changed) {
        await queueOp(raffle, 'number.transfer', { number, person: { id: participantId, ...data } }, [
          `person:${ticket.participantId}`,
        ])
      }
      if (!moved) return participantId
      await db.numbers.update(ticket.id, { participantId })
      await dropIfOrphan(ticket.participantId)
      return participantId
    })
  }

  async function saveConfig(raffleId, raw) {
    const config = normalizeConfig(raw)
    await db.transaction('rw', WRITE(), async () => {
      const raffle = await readRaffle(raffleId)
      const last = await raffleNumbers(raffleId).last()
      if (last && last.number > config.total) {
        throw new Error(`No podés bajar el total a ${config.total}: el número ${last.number} está tomado`)
      }
      await checkWritable(raffle, { ownerOnly: true })
      await db.raffles.update(raffleId, { config })
      await queueOp(raffle, 'raffle.updateConfig', { config })
    })
  }

  function saveSharePrefs(raffleId, prefs) {
    const share = normalizeSharePrefs(prefs)
    return db.transaction('rw', WRITE(), async () => {
      const raffle = await db.raffles.get(raffleId)
      if (!raffle) return 0
      await checkWritable(raffle)
      const updated = await db.raffles.update(raffleId, { share })
      await queueOp(raffle, 'raffle.updateShare', { share })
      return updated
    })
  }

  function saveAppearance(prefs) {
    return db.settings.put({ key: 'appearance', value: normalizeAppearance(prefs) })
  }

  /** Abre una rifa (queda elegida en este dispositivo). */
  function setActiveRaffle(raffleId) {
    return db.settings.put({ key: 'activeRaffle', value: raffleId })
  }

  /** Configuración y estilo de una rifa nueva, copiando (o no) los de otra. */
  async function newRaffleData({ title, copyFrom }) {
    const source = copyFrom ? await readRaffle(copyFrom) : null
    const base = source ? raffleConfig(source) : BLANK_CONFIG
    return {
      config: normalizeConfig({ ...base, title: title ?? base.title }),
      share: normalizeSharePrefs(source?.share),
    }
  }

  /**
   * Crea una rifa local y la deja abierta. Con `copyFrom` usa los precios, premios y estilo de
   * imagen de esa rifa, pero sin sus ventas.
   */
  async function createRaffle({ title, copyFrom } = {}) {
    return db.transaction('rw', db.raffles, db.settings, async () => {
      const raffle = raffleRow(await newRaffleData({ title, copyFrom }))
      await db.raffles.add(raffle)
      await setActiveRaffle(raffle.id)
      return raffle.id
    })
  }

  /**
   * Inserta o reemplaza una rifa en la nube con el snapshot del servidor (crearla, sumarse con
   * una invitación o reconciliarse). Lo que tiene operaciones pendientes se conserva.
   * @param {import('./sync/transport.js').Snapshot} snapshot
   * @param {{ userId?: number, activate?: boolean }} options
   */
  function applySnapshot(snapshot, { userId, activate = false } = {}) {
    return db.transaction('rw', [...SALES(), db.outbox, db.uploads, db.settings], async () => {
      const uid = userId ?? (await currentUser())?.id ?? null
      const raffleId = await applySnapshotRows(db, snapshot, { userId: uid })
      if (activate) await setActiveRaffle(raffleId)
      return raffleId
    })
  }

  /**
   * Crea una rifa en la nube (el id lo genera el servidor) y la deja abierta. Necesita sesión
   * y conexión. Con `copyFrom` copia configuración e imagen de otra rifa, como `createRaffle`.
   * @param {import('./sync/transport.js').Transport|null} transport
   */
  async function createCloudRaffle({ title, copyFrom } = {}, transport) {
    if (!transport) throw new Error('Iniciá sesión para crear una rifa en la nube.')
    const body = await newRaffleData({ title, copyFrom })
    let snapshot
    try {
      snapshot = await transport.createRaffle(body)
    } catch (err) {
      throw explainSyncError(err, 'crear una rifa en la nube')
    }
    return applySnapshot(snapshot, { userId: snapshot.raffle.ownerId, activate: true })
  }

  /** Archivar es de este dispositivo: no genera operación. */
  function archiveRaffle(raffleId, archived = true) {
    return db.raffles.update(raffleId, { archivedAt: archived ? Date.now() : null })
  }

  /** Garantiza que haya una rifa abierta: si no queda ninguna, crea una vacía. */
  async function ensureActiveRaffle() {
    const raffles = await db.raffles.toArray()
    const active = (await db.settings.get('activeRaffle'))?.value
    if (raffles.some((r) => r.id === active)) return active
    let next = fallbackRaffle(raffles)
    if (!next) {
      next = raffleRow({ config: BLANK_CONFIG })
      await db.raffles.add(next)
    }
    await setActiveRaffle(next.id)
    return next.id
  }

  function ensureRaffle() {
    return db.transaction('rw', db.raffles, db.settings, ensureActiveRaffle)
  }

  /**
   * Borra una rifa de este dispositivo con todo lo suyo (también sus operaciones pendientes,
   * archivos por subir y conflictos). Si era la abierta se pasa a otra (o a una nueva si era la
   * última). En una rifa en la nube no genera operación: borrarla en el servidor (o salir de
   * ella) es un pedido aparte, con conexión (ver `deleteCloudRaffle` en sync/engine.js).
   */
  function removeRaffleLocally(raffleId) {
    return db.transaction('rw', [...SALES(), db.outbox, db.uploads, db.conflicts, db.settings], async () => {
      await Promise.all([
        raffleNumbers(raffleId).delete(),
        ...[db.people, db.sales, db.receipts, db.outbox, db.uploads, db.conflicts].map((table) =>
          table.where('raffleId').equals(raffleId).delete(),
        ),
      ])
      await db.raffles.delete(raffleId)
      return ensureActiveRaffle()
    })
  }

  /** Respaldo de una rifa. Los ids sólo enlazan las filas dentro del archivo: al restaurar se generan otros. */
  async function exportBackup(raffleId) {
    // Una sola transacción de lectura: si no, una escritura entre lecturas deja un respaldo
    // inconsistente (números con un comprobante que no está) que después no se puede restaurar.
    const [raffle, participants, tickets, purchases, receipts] = await db.transaction('r', SALES(), () =>
      Promise.all([
        readRaffle(raffleId),
        db.people.where('raffleId').equals(raffleId).toArray(),
        raffleNumbers(raffleId).toArray(),
        db.sales.where('raffleId').equals(raffleId).toArray(),
        db.receipts.where('raffleId').equals(raffleId).toArray(),
      ]),
    )
    return {
      app: BACKUP_APP,
      schema: BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      raffle: { config: raffleConfig(raffle), share: normalizeSharePrefs(raffle.share), createdAt: raffle.createdAt },
      participants: participants.map(({ raffleId: _r, key: _k, ...p }) => p),
      tickets: tickets.map(({ id: _id, raffleId: _r, ...t }) => t),
      purchases: purchases.map(({ raffleId: _r, ...p }) => p),
      // Los archivos viajan en base64 dentro del JSON. Los de la nube que nunca se bajaron no están.
      receipts: await Promise.all(
        receipts
          .filter((r) => !r.remote || hasReceiptFile(r))
          .map(async (r) => {
            const { blob: _blob, buffer: _buffer, raffleId: _r, remote: _remote, hasFile: _hasFile, ...meta } = r
            return { ...meta, data: await blobToDataUrl(receiptBlob(r)) }
          }),
      ),
    }
  }

  /** Restaura un respaldo como una rifa local nueva (no toca las que ya hay) y la deja abierta. */
  async function importBackup(data) {
    // Se parsea (y se decodifican los archivos) antes de abrir la transacción:
    // IndexedDB cierra las transacciones que esperan trabajo ajeno a la base.
    const parsed = await parseBackup(data)
    const raffle = raffleRow({
      config: parsed.config,
      share: parsed.share,
      lastSeq: parsed.purchases.reduce((max, p) => Math.max(max, p.seq), 0),
    })
    const personIds = new Map(parsed.participants.map((p) => [p.id, newId()]))
    const saleIds = new Map(parsed.purchases.map((p) => [p.id, newId()]))
    const raffleId = raffle.id
    await db.transaction('rw', [...SALES(), db.settings], async () => {
      await db.raffles.add(raffle)
      await db.people.bulkAdd(parsed.participants.map((p) => ({ ...p, id: personIds.get(p.id), raffleId })))
      await db.sales.bulkAdd(
        parsed.purchases.map((p) => ({ ...p, id: saleIds.get(p.id), raffleId, participantId: personIds.get(p.participantId) })),
      )
      await db.numbers.bulkAdd(
        parsed.tickets.map((t) => ({
          ...t,
          id: numberId(raffleId, t.number),
          raffleId,
          participantId: personIds.get(t.participantId),
          purchaseId: saleIds.get(t.purchaseId),
        })),
      )
      await db.receipts.bulkAdd(parsed.receipts.map((r) => ({ ...r, purchaseId: saleIds.get(r.purchaseId), raffleId })))
      await setActiveRaffle(raffleId)
    })
    return {
      raffleId,
      title: parsed.config.title,
      participants: parsed.participants.length,
      tickets: parsed.tickets.length,
      receipts: parsed.receipts.length,
    }
  }

  /**
   * Guarda una copia local (independiente, con ids nuevos) de una rifa, p. ej. de una rifa en la
   * nube que se borró o a la que se perdió el acceso. La copia queda abierta. Los comprobantes de
   * la nube que nunca se bajaron no se copian: `missingFiles` dice cuántos quedaron afuera.
   */
  async function saveLocalCopy(raffleId, { title } = {}) {
    const backup = await exportBackup(raffleId)
    if (title !== undefined) backup.raffle.config.title = title
    const missingFiles = await db.receipts
      .where('raffleId')
      .equals(raffleId)
      .filter((r) => r.remote && !hasReceiptFile(r))
      .count()
    return { ...(await importBackup(backup)), missingFiles }
  }

  /** Descarta conflictos ya leídos ("Entendido"). Sin `ids`, todos los de la rifa. */
  function dismissConflicts(raffleId, ids) {
    if (ids) return db.conflicts.bulkDelete(ids)
    return db.conflicts.where('raffleId').equals(raffleId).delete()
  }

  /** La sesión de este dispositivo (`{ token, user }`) o `null`. No se sincroniza. */
  async function getAuth() {
    const auth = (await db.settings.get('auth'))?.value
    return auth?.token ? auth : null
  }

  const accountUser = (user) => ({
    id: user.id,
    name: user.name ?? '',
    email: user.email ?? '',
    emailVerifiedAt: user.emailVerifiedAt ?? null,
  })

  /** Guarda la sesión al iniciarla (o registrarse) y deja de pedir que inicie sesión. */
  function setAuth({ token, user }) {
    if (!token || !user) throw new Error('Faltan los datos de la sesión')
    return db.transaction('rw', db.settings, async () => {
      await db.settings.put({ key: 'auth', value: { token, user: accountUser(user) } })
      const state = (await db.settings.get('syncState'))?.value ?? {}
      if (state.needsLogin) await db.settings.put({ key: 'syncState', value: { ...state, needsLogin: false } })
    })
  }

  /** Actualiza los datos de la cuenta (p. ej. después de verificar el correo) sin tocar el token. */
  function updateAuthUser(user) {
    return db.transaction('rw', db.settings, async () => {
      const auth = (await db.settings.get('auth'))?.value
      if (!auth?.token || auth.user?.id !== user.id) return
      await db.settings.put({ key: 'auth', value: { ...auth, user: accountUser(user) } })
    })
  }

  /**
   * Cierra la sesión en este dispositivo. Las rifas en la nube quedan acá con sus cambios sin
   * enviar, que se mandan cuando vuelva a iniciar sesión esa misma cuenta.
   */
  function clearAuth() {
    return db.settings.delete('auth')
  }

  /** Cambios de rifas en la nube que todavía no llegaron al servidor (operaciones y archivos). */
  async function unsentChanges() {
    const [ops, files] = await Promise.all([db.outbox.count(), db.uploads.count()])
    return ops + files
  }

  /** Estado de la sincronización que ven todas las pestañas (p. ej. `{ needsLogin: true }`). */
  async function setSyncState(patch) {
    return db.transaction('rw', db.settings, async () => {
      const current = (await db.settings.get('syncState'))?.value ?? {}
      if (Object.keys(patch).every((k) => current[k] === patch[k])) return
      await db.settings.put({ key: 'syncState', value: { ...current, ...patch } })
    })
  }

  return {
    db,
    currentUser,
    assignNumbers,
    releaseNumber,
    voidPurchase,
    setPurchaseAmount,
    setReceipt,
    removeReceipt,
    storeReceiptFile,
    updateParticipant,
    transferNumber,
    saveConfig,
    saveSharePrefs,
    saveAppearance,
    setActiveRaffle,
    createRaffle,
    createCloudRaffle,
    applySnapshot,
    archiveRaffle,
    ensureRaffle,
    deleteRaffle: removeRaffleLocally,
    removeRaffleLocally,
    exportBackup,
    importBackup,
    saveLocalCopy,
    dismissConflicts,
    setSyncState,
    getAuth,
    setAuth,
    updateAuthUser,
    clearAuth,
    unsentChanges,
  }
}

/** La base de la app. */
export const store = createStore()

export const {
  db,
  currentUser,
  assignNumbers,
  releaseNumber,
  voidPurchase,
  setPurchaseAmount,
  setReceipt,
  removeReceipt,
  storeReceiptFile,
  updateParticipant,
  transferNumber,
  saveConfig,
  saveSharePrefs,
  saveAppearance,
  setActiveRaffle,
  createRaffle,
  createCloudRaffle,
  applySnapshot,
  archiveRaffle,
  ensureRaffle,
  deleteRaffle,
  removeRaffleLocally,
  exportBackup,
  importBackup,
  saveLocalCopy,
  dismissConflicts,
  setSyncState,
  getAuth,
  setAuth,
  updateAuthUser,
  clearAuth,
  unsentChanges,
} = store
