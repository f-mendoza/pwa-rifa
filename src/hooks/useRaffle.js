import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, fallbackRaffle, hasReceiptFile, normalizeAppearance, normalizeSharePrefs, raffleConfig, receiptBlob } from '../db.js'
import { priceFor } from '../lib/format.js'
import { opKeys } from '../sync/local.js'

/**
 * Lee todo el estado de la rifa abierta desde IndexedDB y se vuelve a ejecutar sola
 * cada vez que cambia algo en la base. Devuelve `undefined` mientras carga y `null`
 * si no hay ninguna rifa (no debería pasar: la base siempre deja una).
 */
export function useRaffle() {
  const raw = useLiveQuery(async () => {
    const [active, appearance, auth, raffles] = await Promise.all([
      db.settings.get('activeRaffle'),
      db.settings.get('appearance'),
      db.settings.get('auth'),
      db.raffles.toArray(),
    ])
    const user = auth?.value?.token ? (auth.value.user ?? null) : null
    const raffle = raffles.find((r) => r.id === active?.value) ?? fallbackRaffle(raffles)
    if (!raffle) return null
    const ofRaffle = (table) => table.where('raffleId').equals(raffle.id).toArray()
    const [participants, tickets, purchases, receipts] = await Promise.all([
      ofRaffle(db.people),
      ofRaffle(db.numbers),
      ofRaffle(db.sales),
      // Los blobs de IndexedDB son referencias: leerlos no carga el archivo en memoria.
      ofRaffle(db.receipts),
    ])
    return {
      raffle: { id: raffle.id, createdAt: raffle.createdAt, archivedAt: raffle.archivedAt, lastSeq: raffle.lastSeq, remote: raffle.remote ?? null },
      // Las rifas locales no tienen nada que sincronizar: ni se consulta.
      sync: raffle.remote ? await readSync(raffle.id) : null,
      config: raffleConfig(raffle),
      share: normalizeSharePrefs(raffle.share),
      appearance: normalizeAppearance(appearance?.value),
      user,
      participants,
      tickets,
      purchases,
      receipts,
    }
  }, [])

  return useMemo(() => raw && derive(raw), [raw])
}

/** Lo pendiente de enviar, los conflictos y si hay que iniciar sesión, de una rifa en la nube. */
async function readSync(raffleId) {
  const [outbox, uploads, conflicts, syncState] = await Promise.all([
    db.outbox.where('raffleId').equals(raffleId).toArray(),
    db.uploads.where('raffleId').equals(raffleId).count(),
    db.conflicts.where('raffleId').equals(raffleId).toArray(),
    db.settings.get('syncState'),
  ])
  return { outbox, uploads, conflicts, needsLogin: Boolean(syncState?.value?.needsLogin) }
}

/** Ventas con operaciones sin enviar: su número de comprobante todavía es provisorio. */
function pendingSales(outbox) {
  const ids = new Set()
  for (const row of outbox) {
    for (const key of row.keys ?? opKeys(row.type, row.payload)) if (key.startsWith('sale:')) ids.add(key.slice(5))
  }
  return ids
}

/**
 * Estado de sincronización para la UI (`null` en una rifa local):
 * `{ status, role, ranges, lastSyncAt, needsReconcile, syncPending, syncError, pending, conflicts, needsLogin, otherAccount }`.
 * `otherAccount`: hay una sesión iniciada, pero la rifa es de otra cuenta (no se sincroniza).
 */
function syncInfo(raffle, sync, user) {
  if (!raffle.remote || !sync) return null
  const {
    status = 'active', role = null, ranges = null, lastSyncAt = null, userId = null,
    needsReconcile = false, syncPending = false, syncError = null,
  } = raffle.remote
  return {
    otherAccount: Boolean(user && userId != null && user.id !== userId),
    status,
    role,
    ranges,
    lastSyncAt,
    needsReconcile,
    syncPending,
    syncError,
    pending: sync.outbox.length + sync.uploads,
    conflicts: [...sync.conflicts].sort((a, b) => b.createdAt - a.createdAt || b.id - a.id),
    needsLogin: sync.needsLogin || syncError?.kind === 'auth',
  }
}

/**
 * El comprobante como lo ve la app: siempre con `blob`. Los que vinieron del servidor sin el
 * archivo quedan con `blob: null` (se ve la miniatura y "sin descargar").
 */
function viewReceipt(r) {
  if (r.blob) return r
  if (r.remote && !hasReceiptFile(r)) return { ...r, blob: null }
  // Donde no se pueden guardar Blobs, el archivo viene como bytes.
  return { ...r, blob: receiptBlob(r) }
}

function groupNumbers(tickets, field) {
  const map = new Map()
  for (const t of tickets) {
    const key = t[field]
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t.number)
  }
  for (const list of map.values()) list.sort((a, b) => a - b)
  return map
}

function derive({ raffle, sync, config, share, appearance, user, participants, tickets, purchases: purchaseRows, receipts: receiptRows }) {
  const ticketByNumber = new Map(tickets.map((t) => [t.number, t]))
  const numbersByOwner = groupNumbers(tickets, 'participantId')
  const numbersByPurchase = groupNumbers(tickets, 'purchaseId')
  const receipts = new Map(receiptRows.map((r) => [r.purchaseId, viewReceipt(r)]))
  const provisional = sync ? pendingSales(sync.outbox) : new Set()
  const names = new Map(participants.map((p) => [p.id, p.name]))

  const purchases = purchaseRows
    .map((p) => {
      const numbers = numbersByPurchase.get(p.id) ?? []
      const auto = priceFor(numbers.length, config)
      return {
        ...p,
        payer: names.get(p.participantId) ?? 'Sin nombre',
        numbers,
        auto,
        manual: p.amount != null,
        total: p.amount ?? auto,
        receipt: receipts.get(p.id) ?? null,
        ...(sync && { provisional: provisional.has(p.id) }),
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.seq - a.seq)

  const paidBy = new Map()
  for (const p of purchases) paidBy.set(p.participantId, (paidBy.get(p.participantId) ?? 0) + p.total)

  const people = participants
    .map((p) => ({ ...p, numbers: numbersByOwner.get(p.id) ?? [], amount: paidBy.get(p.id) ?? 0 }))
    .filter((p) => p.numbers.length > 0 || paidBy.has(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))

  const available = []
  for (let n = 1; n <= config.total; n++) {
    if (!ticketByNumber.has(n)) available.push(n)
  }

  return {
    raffle,
    sync: syncInfo(raffle, sync, user),
    config,
    share,
    appearance,
    user,
    people,
    peopleById: new Map(people.map((p) => [p.id, p])),
    ticketByNumber,
    purchases,
    purchaseById: new Map(purchases.map((p) => [p.id, p])),
    available,
    takenCount: config.total - available.length,
    revenue: purchases.reduce((sum, p) => sum + p.total, 0),
    missingReceipts: purchases.filter((p) => !p.receipt).length,
  }
}

/**
 * Todas las rifas, con lo vendido y lo recaudado de cada una, de la más nueva a la más vieja.
 * Recorre todos los números y comprobantes: se usa sólo con la lista de rifas abierta.
 */
export function useRaffleList() {
  return useLiveQuery(async () => {
    const [raffles, numbers, sales] = await Promise.all([db.raffles.toArray(), db.numbers.toArray(), db.sales.toArray()])
    const countBySale = new Map()
    const taken = new Map()
    for (const n of numbers) {
      countBySale.set(n.purchaseId, (countBySale.get(n.purchaseId) ?? 0) + 1)
      taken.set(n.raffleId, (taken.get(n.raffleId) ?? 0) + 1)
    }
    const configs = new Map(raffles.map((r) => [r.id, raffleConfig(r)]))
    const revenue = new Map()
    for (const s of sales) {
      const config = configs.get(s.raffleId)
      if (!config) continue
      const total = s.amount ?? priceFor(countBySale.get(s.id) ?? 0, config)
      revenue.set(s.raffleId, (revenue.get(s.raffleId) ?? 0) + total)
    }
    return raffles
      .map((r) => ({
        id: r.id,
        title: configs.get(r.id).title,
        createdAt: r.createdAt,
        archivedAt: r.archivedAt,
        remote: r.remote ?? null,
        taken: taken.get(r.id) ?? 0,
        total: configs.get(r.id).total,
        revenue: revenue.get(r.id) ?? 0,
      }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }, [])
}
