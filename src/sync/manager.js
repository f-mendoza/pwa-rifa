import { liveQuery } from 'dexie'
import { store as defaultStore } from '../db.js'
import { syncRaffle } from './engine.js'
import { isSyncError } from './transport.js'

/**
 * Decide cuándo sincronizar (desde la página, no desde el service worker):
 * - cada ~12 s con la pestaña visible y conexión;
 * - al volver a la app (`visibilitychange`) y al recuperar señal (`online`);
 * - poco después de cada cambio local (agrupando los que vienen seguidos).
 *
 * Sincroniza una sola pestaña: la que tiene el Web Lock (`navigator.locks`); las demás esperan
 * su turno y toman la posta si esa se cierra. Sin Web Locks, cada pestaña sincroniza por su cuenta
 * (el servidor es idempotente, así que no se duplica nada).
 *
 * Ante errores de red o del servidor espera cada vez más por rifa (backoff exponencial). Con 401 deja
 * `settings.syncState.needsLogin` (lo ven todas las pestañas) sin tocar el outbox. Con 403/410
 * el motor marca `remote.status`.
 *
 * Si no hay rifas en la nube no hace nada de red, y sin transporte configurado tampoco. Las rifas
 * de otra cuenta (`remote.userId` distinto de `getUserId()`) no se tocan: sus cambios esperan a
 * que vuelva a iniciar sesión esa cuenta.
 *
 * @param {object} options
 * @param {() => import('./transport.js').Transport|null} [options.getTransport] el transporte con la sesión actual, o null
 * @param {() => number|null} [options.getUserId] la cuenta de la sesión actual, o null
 */
export function createSyncManager({
  store = defaultStore,
  getTransport = () => null,
  getUserId = () => null,
  intervalMs = 12_000,
  debounceMs = 1_500,
  retryBaseMs = 2_000,
  retryMaxMs = 5 * 60_000,
  lockName = 'rifa-sync',
  locks = globalThis.navigator?.locks,
  isOnline = () => globalThis.navigator?.onLine ?? true,
  isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
} = {}) {
  const { db } = store
  let started = false
  let leader = false
  let releaseLock = null
  let interval = null
  let debounce = null
  let retryTimer = null
  let outboxWatch = null
  let running = null
  let again = false
  const retries = new Map()
  let status = { state: 'idle', error: null, retryAt: 0, lastSyncAt: null }
  const listeners = new Set()

  function setStatus(patch) {
    status = { ...status, ...patch }
    for (const listener of listeners) listener(status)
  }

  function schedule(delay = debounceMs) {
    if (!leader) return
    clearTimeout(debounce)
    debounce = setTimeout(() => request(), delay)
  }

  const onVisible = () => {
    if (isVisible()) request()
  }
  const onOnline = () => {
    // Volvió la señal: no hace falta esperar lo que quedaba del backoff.
    retries.clear()
    request()
  }

  function becomeLeader() {
    if (!started) return
    leader = true
    interval = setInterval(() => {
      if (isVisible()) request()
    }, intervalMs)
    globalThis.document?.addEventListener?.('visibilitychange', onVisible)
    globalThis.addEventListener?.('online', onOnline)
    // Un cambio local (de cualquier pestaña) agrega una fila al outbox: se sincroniza al rato.
    let lastSeen
    outboxWatch = liveQuery(() => db.outbox.orderBy('seq').lastKey()).subscribe({
      next: (seq) => {
        if (seq !== undefined && lastSeen !== undefined && seq !== lastSeen) schedule()
        lastSeen = seq ?? lastSeen ?? null
      },
      error: () => {},
    })
    request()
  }

  /** Pide un ciclo; si hay uno corriendo, se encadena otro al terminar. */
  function request() {
    if (!leader) return Promise.resolve()
    if (running) {
      again = true
      return running
    }
    running = cycle()
      .catch(() => {})
      .finally(() => {
        running = null
        if (again && leader) {
          again = false
          request()
        }
      })
    return running
  }

  /** Rifas para sincronizar: la abierta y las que tienen envíos o recuperación pendientes. */
  async function targets() {
    const userId = getUserId()
    const mine = (r) => userId == null || r.remote.userId == null || r.remote.userId === userId
    const raffles = (await db.raffles.toArray()).filter((r) => r.remote && (r.remote.status ?? 'active') === 'active' && mine(r))
    if (!raffles.length) return []
    const [active, outbox, uploads] = await Promise.all([
      db.settings.get('activeRaffle'),
      db.outbox.orderBy('raffleId').uniqueKeys(),
      db.uploads.orderBy('raffleId').uniqueKeys(),
    ])
    const busy = new Set([...outbox, ...uploads])
    return raffles
      .filter((r) =>
        r.id === active?.value || busy.has(r.id) || r.remote.syncedVersion == null ||
        r.remote.needsReconcile || r.remote.syncPending || r.remote.syncError,
      )
      .map((r) => r.id)
  }

  function backoff(id, err) {
    const failures = (retries.get(id)?.failures ?? 0) + 1
    const delay = Math.min(retryBaseMs * 2 ** (failures - 1), retryMaxMs)
    retries.set(id, { failures, retryAt: Date.now() + delay, error: err })
  }

  /** Un solo timer despierta al manager cuando vence la próxima espera de cualquier rifa. */
  function scheduleRetry() {
    clearTimeout(retryTimer)
    let next = null
    for (const retry of retries.values()) {
      if (!next || retry.retryAt < next.retryAt) next = retry
    }
    if (next && leader) retryTimer = setTimeout(() => request(), Math.max(1, next.retryAt - Date.now()))
    return next
  }

  async function cycle() {
    const ids = await targets()
    const targetsSet = new Set(ids)
    for (const id of retries.keys()) if (!targetsSet.has(id)) retries.delete(id)
    if (!ids.length) {
      scheduleRetry()
      return setStatus({ state: 'idle', error: null, retryAt: 0 })
    }
    const ready = ids.filter((id) => Date.now() >= (retries.get(id)?.retryAt ?? 0))
    if (!ready.length) {
      // Un timer puede dispararse antes del milisegundo previsto: se rearma sin perder el reintento.
      scheduleRetry()
      return
    }
    if (!isOnline()) return setStatus({ state: 'offline', error: null })
    const transport = getTransport()
    if (!transport) {
      await store.setSyncState({ needsLogin: true })
      return setStatus({ state: 'auth', error: null })
    }
    setStatus({ state: 'syncing' })
    let lastSyncAt = status.lastSyncAt
    for (const id of ready) {
      try {
        await syncRaffle(id, transport, { store })
        retries.delete(id)
        lastSyncAt = Date.now()
      } catch (err) {
        if (isSyncError(err) && err.kind === 'auth') {
          clearTimeout(retryTimer)
          await store.setSyncState({ needsLogin: true })
          return setStatus({ state: 'auth', error: err, retryAt: 0 })
        }
        if (!isSyncError(err) || err.retryable) backoff(id, err)
        else retries.delete(id)
        // forbidden / gone (ya marcados por el motor) o un rechazo puntual: se sigue con las demás.
      }
    }
    await store.setSyncState({ needsLogin: false })
    const next = scheduleRetry()
    setStatus({
      state: next ? (next.error?.kind === 'network' ? 'offline' : 'error') : 'idle',
      error: next?.error ?? null,
      retryAt: next?.retryAt ?? 0,
      lastSyncAt,
    })
  }

  return {
    start() {
      if (started) return
      started = true
      if (!locks?.request) {
        becomeLeader()
        return
      }
      locks
        .request(lockName, () => {
          if (!started) return undefined
          becomeLeader()
          // Se queda con el lock hasta `stop()` (o hasta que se cierre la pestaña).
          return new Promise((resolve) => {
            releaseLock = resolve
          })
        })
        .catch(() => {
          if (started && !leader) becomeLeader()
        })
    },

    stop() {
      started = false
      leader = false
      clearInterval(interval)
      clearTimeout(debounce)
      clearTimeout(retryTimer)
      outboxWatch?.unsubscribe()
      outboxWatch = null
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible)
      globalThis.removeEventListener?.('online', onOnline)
      releaseLock?.()
      releaseLock = null
    },

    /** Sincroniza ya (p. ej. al tocar "Reintentar"), sin esperar el backoff. */
    syncNow() {
      retries.clear()
      return request()
    },

    /** Avisa cuando cambia el estado de esta pestaña (`idle`, `syncing`, `offline`, `error`, `auth`). */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    get status() {
      return status
    },

    get isLeader() {
      return leader
    },
  }
}
