import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { DEFAULT_CONFIG, DEFAULT_SHARE, db } from '../db.js'
import { priceFor } from '../lib/format.js'

/**
 * Lee todo el estado de la rifa desde IndexedDB y se vuelve a ejecutar sola
 * cada vez que cambia algo en la base. Devuelve `undefined` mientras carga.
 */
export function useRaffle() {
  const raw = useLiveQuery(async () => {
    const [config, share, participants, tickets, purchases, receipts] = await Promise.all([
      db.settings.get('config'),
      db.settings.get('share'),
      db.participants.toArray(),
      db.tickets.toArray(),
      db.purchases.toArray(),
      // Los blobs de IndexedDB son referencias: leerlos no carga el archivo en memoria.
      db.receipts.toArray(),
    ])
    return {
      config: { ...DEFAULT_CONFIG, ...config?.value },
      share: { ...DEFAULT_SHARE, ...share?.value },
      participants,
      tickets,
      purchases,
      receipts,
    }
  }, [])

  return useMemo(() => raw && derive(raw), [raw])
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

function derive({ config, share, participants, tickets, purchases: purchaseRows, receipts: receiptRows }) {
  const ticketByNumber = new Map(tickets.map((t) => [t.number, t]))
  const numbersByOwner = groupNumbers(tickets, 'participantId')
  const numbersByPurchase = groupNumbers(tickets, 'purchaseId')
  const receipts = new Map(receiptRows.map((r) => [r.purchaseId, r]))
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
      }
    })
    .sort((a, b) => b.createdAt - a.createdAt || b.id - a.id)

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
    config,
    share,
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
