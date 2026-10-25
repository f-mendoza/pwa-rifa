import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncManager } from '../../src/sync/manager.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { device, outbox, sharedRaffle } from './syncHelpers.js'

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
