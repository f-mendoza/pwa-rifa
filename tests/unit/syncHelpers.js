import { createStore } from '../../src/db.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'

let count = 0

/** Un "teléfono": una base Dexie propia, independiente de las demás. */
export function device(label = 'telefono') {
  count += 1
  return createStore(`${label}-${count}-${Date.now()}`)
}

/** Las operaciones pendientes de una rifa, en orden. */
export function outbox(store, raffleId) {
  return store.db.outbox.where('raffleId').equals(raffleId).sortBy('seq')
}

export const tickets = (store, raffleId) => store.db.numbers.where('raffleId').equals(raffleId).sortBy('number')
export const ofRaffle = (table, raffleId) => table.where('raffleId').equals(raffleId).toArray()

/** Comprobante como el que arma `prepareReceipt`. */
export function receipt(text = 'pdf', addedAt = 1000) {
  const blob = new Blob([text], { type: 'application/pdf' })
  return { name: 'pago.pdf', type: blob.type, size: blob.size, blob, thumb: null, addedAt }
}

/**
 * Servidor falso con quien organiza (Ana) y una persona vendedora (Beto), cada uno con su
 * teléfono, y una rifa en la nube creada por Ana y ya descargada en los dos teléfonos.
 */
export async function sharedRaffle({ title = 'Club', sellerRole = 'seller', ranges = null } = {}) {
  const server = createFakeServer()
  const ana = server.createUser('Ana')
  const beto = server.createUser('Beto')
  const a = { store: device('ana'), transport: server.transportFor(ana), user: ana }
  const b = { store: device('beto'), transport: server.transportFor(beto), user: beto }
  await a.store.db.settings.put({ key: 'auth', value: { token: 't-ana', user: { id: ana.id, name: ana.name } } })
  await b.store.db.settings.put({ key: 'auth', value: { token: 't-beto', user: { id: beto.id, name: beto.name } } })
  const raffleId = await a.store.createCloudRaffle({ title }, a.transport)
  server.addMember(raffleId, beto, sellerRole, ranges)
  const snapshot = await b.transport.getSnapshot(raffleId)
  await b.store.applySnapshot(snapshot, { activate: true })
  return { server, a, b, raffleId }
}
