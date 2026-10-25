import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncManager } from '../../src/sync/manager.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { downloadRaffle, syncRaffle } from '../../src/sync/engine.js'
import { SyncError } from '../../src/sync/transport.js'
import { device, outbox, sharedRaffle, tickets } from './syncHelpers.js'

const managers = []
afterEach(() => {
  for (const m of managers.splice(0)) m.stop()
})

/** Manager con tiempos cortos, sin Web Locks y siempre con conexión y la pestaña visible. */
function manager(store, getTransport, options = {}) {
  const m = createSyncManager({
    store,
    getTransport,
    intervalMs: 60_000,
    debounceMs: 10,
    retryBaseMs: 20,
    locks: null,
    isOnline: () => true,
    isVisible: () => true,
    ...options,
  })
  managers.push(m)
  return m
}

const needsLogin = async (store) => (await store.db.settings.get('syncState'))?.value?.needsLogin

describe('createSyncManager', () => {
  it('una rifa inactiva con error no bloquea el push y el pull de la abierta ni pierde su backoff', async () => {
    const { a, b, server, raffleId: brokenId } = await sharedRaffle()
    const activeId = await a.store.createCloudRaffle({ title: 'Sana' }, a.transport)
    server.addMember(activeId, b.user, 'seller')
    await downloadRaffle(activeId, b.transport, { store: b.store })
    await b.store.assignNumbers(activeId, [9], { name: 'Venta remota' })
    await syncRaffle(activeId, b.transport, { store: b.store })
    const pullChanges = vi.fn(async (id, ...args) => {
      if (id === brokenId) throw new SyncError('server')
      return a.transport.pullChanges(id, ...args)
    })
    const transport = { ...a.transport, pullChanges }
    await expect(syncRaffle(brokenId, transport, { store: a.store })).rejects.toMatchObject({ kind: 'server' })
    await a.store.assignNumbers(activeId, [7], { name: 'Ana' })
    pullChanges.mockClear()
    const m = manager(a.store, () => transport, { retryBaseMs: 60_000 })
    m.start()
    await vi.waitFor(async () => expect(await outbox(a.store, activeId)).toEqual([]))
    await vi.waitFor(() => expect(m.status.state).toBe('error'))
    expect(pullChanges.mock.calls.map(([id]) => id)).toEqual([brokenId, activeId])
    expect((await tickets(a.store, activeId)).map((n) => n.number)).toEqual([7, 9])
    const retryAt = m.status.retryAt

    // Otra escritura se sincroniza durante la espera de la rifa rota; su éxito no reinicia esa espera.
    await a.store.assignNumbers(activeId, [8], { name: 'Beto' })
    await vi.waitFor(async () => expect(await outbox(a.store, activeId)).toEqual([]))
    await vi.waitFor(async () => expect((await a.store.db.raffles.get(activeId)).remote.syncPending).toBe(false))
    expect(pullChanges.mock.calls.filter(([id]) => id === brokenId)).toHaveLength(1)
    expect(m.status.retryAt).toBe(retryAt)

    // Reintentar manualmente permite recuperar la rifa que fallaba y vuelve al estado normal.
    pullChanges.mockImplementation((...args) => a.transport.pullChanges(...args))
    await m.syncNow()
    expect((await a.store.db.raffles.get(brokenId)).remote).toMatchObject({ syncPending: false, syncError: null })
    expect(m.status).toMatchObject({ state: 'idle', retryAt: 0 })
  })

  it('recupera rifas inactivas con reconciliación o errores pendientes y sin outbox', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [7], { name: 'Juan' })
    await syncRaffle(raffleId, a.transport, { store: a.store })
    await b.store.assignNumbers(raffleId, [7, 9], { name: 'Pedro' })
    const getSnapshot = b.transport.getSnapshot
    b.transport.getSnapshot = async () => { throw new SyncError('network') }
    await expect(syncRaffle(raffleId, b.transport, { store: b.store })).rejects.toMatchObject({ kind: 'network' })
    await b.store.createRaffle({ title: 'Local abierta' })
    // Prueba la marca de reconciliación por sí sola, sin depender del error o del aviso.
    await b.store.db.raffles.update(raffleId, { 'remote.syncError': null, 'remote.syncPending': false })
    await b.store.dismissConflicts(raffleId)
    b.transport.getSnapshot = getSnapshot
    const m = manager(b.store, () => b.transport)
    m.start()
    await vi.waitFor(() => expect(m.status.lastSyncAt).toEqual(expect.any(Number)))
    await vi.waitFor(async () => expect((await b.store.db.raffles.get(raffleId)).remote.needsReconcile).toBe(false))
    expect((await b.store.db.numbers.where('raffleId').equals(raffleId).toArray()).map((n) => n.number)).toEqual([7])

    // Un fallo del pull, aun sin ventas pendientes, también debe retomarse si cambiamos de rifa.
    b.transport.setOnline(false)
    await expect(syncRaffle(raffleId, b.transport, { store: b.store })).rejects.toMatchObject({ kind: 'network' })
    await b.store.db.raffles.update(raffleId, { 'remote.syncPending': false })
    b.transport.setOnline(true)
    await m.syncNow()
    expect((await b.store.db.raffles.get(raffleId)).remote.syncError).toBeNull()

    // Una página cerrada durante un ciclo no alcanza a guardar un error.
    await b.store.db.raffles.update(raffleId, { 'remote.syncPending': true })
    b.transport.calls.length = 0
    await m.syncNow()
    expect(b.transport.calls.length).toBeGreaterThan(0)
    expect((await b.store.db.raffles.get(raffleId)).remote.syncPending).toBe(false)
  })

  it('sin rifas en la nube no hace nada de red (ni pide el transporte)', async () => {
    const store = device()
    await store.db.open()
    const getTransport = vi.fn(() => null)
    const m = manager(store, getTransport)
    m.start()
    await m.syncNow()
    const local = (await store.db.settings.get('activeRaffle')).value
    await store.assignNumbers(local, [1], { name: 'Ana' })
    await new Promise((r) => setTimeout(r, 40))
    expect(getTransport).not.toHaveBeenCalled()
    expect(m.status.state).toBe('idle')
    expect(await needsLogin(store)).toBeUndefined()
  })

  it('poco después de un cambio local, sincroniza solo', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    const m = manager(a.store, () => a.transport)
    m.start()
    await m.syncNow()
    await a.store.assignNumbers(raffleId, [5], { name: 'Juan' })
    await vi.waitFor(async () => expect(await outbox(a.store, raffleId)).toEqual([]), { timeout: 1000 })
    expect(server.inspect(raffleId).numbers.map((n) => n.number)).toEqual([5])
    await vi.waitFor(() => expect(m.status.state).toBe('idle'))
    expect(m.status).toMatchObject({ state: 'idle', lastSyncAt: expect.any(Number) })
  })

  it('con 401 pide iniciar sesión sin tocar el outbox; al volver la sesión se limpia', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [5], { name: 'Juan' })
    server.expireSessions(a.user)
    const m = manager(a.store, () => a.transport)
    m.start()
    await vi.waitFor(() => expect(m.status.state).toBe('auth'))
    expect(await needsLogin(a.store)).toBe(true)
    expect(await outbox(a.store, raffleId)).toHaveLength(1)

    server.restoreSessions(a.user)
    await m.syncNow()
    expect(await outbox(a.store, raffleId)).toEqual([])
    expect(await needsLogin(a.store)).toBe(false)
  })

  it('sin transporte (sin sesión) y con rifas en la nube, pide iniciar sesión', async () => {
    const { a } = await sharedRaffle()
    const m = manager(a.store, () => null)
    m.start()
    await vi.waitFor(async () => expect(await needsLogin(a.store)).toBe(true))
  })

  it('ante errores de red espera cada vez más y después reintenta solo', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [5], { name: 'Juan' })
    a.transport.failNext('network', 2)
    const m = manager(a.store, () => a.transport)
    const states = []
    m.subscribe((s) => states.push(s.state))
    m.start()
    await vi.waitFor(async () => expect(await outbox(a.store, raffleId)).toEqual([]), { timeout: 2000 })
    expect(states.filter((s) => s === 'offline')).toHaveLength(2)
    await vi.waitFor(() => expect(m.status.state).toBe('idle'))
    expect(m.status.state).toBe('idle')
  })

  it('sin conexión no intenta nada', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [5], { name: 'Juan' })
    const m = manager(a.store, () => a.transport, { isOnline: () => false })
    a.transport.calls.length = 0
    m.start()
    await vi.waitFor(() => expect(m.status.state).toBe('offline'))
    expect(a.transport.calls).toEqual([])
  })

  it('con Web Locks, sincroniza una sola pestaña', async () => {
    const server = createFakeServer()
    const transport = server.transportFor(server.createUser('Ana'))
    const store = device()
    await store.db.open()
    // Web Locks mínimo: el segundo pedido espera a que se libere el primero.
    let holder = null
    const waiting = []
    const locks = {
      request(_name, callback) {
        return new Promise((resolve) => {
          const run = async () => {
            holder = run
            resolve(await callback({}))
            holder = null
            waiting.shift()?.()
          }
          if (holder) waiting.push(run)
          else run()
        })
      },
    }
    const first = manager(store, () => transport, { locks })
    const second = manager(store, () => transport, { locks })
    first.start()
    second.start()
    await vi.waitFor(() => expect(first.isLeader).toBe(true))
    expect(second.isLeader).toBe(false)
    first.stop()
    await vi.waitFor(() => expect(second.isLeader).toBe(true))
  })
})
