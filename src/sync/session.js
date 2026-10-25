import { liveQuery } from 'dexie'
import { store as defaultStore } from '../db.js'
import { explainSyncError, isSyncError } from './transport.js'

/**
 * La sesión de este dispositivo con la nube: guarda `settings.auth = { token, user }` (en
 * IndexedDB, sin sincronizar) y arma el cliente de la API con ese token.
 *
 * - `transport()` da el cliente sólo si hay sesión: sin sesión, las rifas en la nube no se
 *   sincronizan (sus cambios esperan en el outbox) y las locales no se enteran de nada.
 * - Ante un 401 deja `syncState.needsLogin`, que la UI muestra como "Iniciá sesión".
 * - Se entera de los cambios de otras pestañas (iniciar o cerrar sesión) con una consulta en vivo.
 *
 * @param {{ store?: ReturnType<typeof import('../db.js').createStore>, createClient: (getToken: () => string|null) => import('./api.js').ApiClient, deviceName?: string }} options
 */
export function createSession({ store = defaultStore, createClient, deviceName = deviceLabel() }) {
  let auth = null
  const listeners = new Set()
  const client = createClient(() => auth?.token ?? null)
  let watch = null

  function set(next) {
    const value = next?.token ? next : null
    if (value?.token === auth?.token && JSON.stringify(value?.user) === JSON.stringify(auth?.user)) return
    auth = value
    for (const listener of listeners) listener(auth)
  }

  const ready = store.getAuth().then(set)

  /** Si el servidor dice que la sesión no vale más, lo deja anotado para que la UI lo pida. */
  async function noteAuthError(err) {
    if (isSyncError(err) && err.kind === 'auth' && auth) await store.setSyncState({ needsLogin: true })
  }

  /** Corre un pedido de la cuenta y traduce el error (en infinitivo: "iniciar sesión"). */
  async function call(action, fn) {
    try {
      return await fn()
    } catch (err) {
      await noteAuthError(err)
      throw explainSyncError(err, action)
    }
  }

  /** Empieza a usar una sesión nueva (iniciar sesión, registrarse). */
  async function adopt({ token, user }) {
    await store.setAuth({ token, user })
    set(await store.getAuth())
    return auth.user
  }

  return {
    client,
    ready,

    /** La sesión actual (`{ token, user }`) o `null`. */
    get auth() {
      return auth
    },

    get user() {
      return auth?.user ?? null
    },

    /** El transporte para sincronizar, o `null` sin sesión. */
    transport() {
      return auth?.token ? client : null
    },

    /** Se entera de los cambios de sesión (también los de otras pestañas). Devuelve cómo dejar de escuchar. */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /** Sigue `settings.auth` en vivo (para enterarse de otras pestañas). */
    start() {
      watch ??= liveQuery(() => store.getAuth()).subscribe({ next: set, error: () => {} })
    },

    stop() {
      watch?.unsubscribe()
      watch = null
    },

    adopt,

    async login({ email, password }) {
      const result = await call('iniciar sesión', () =>
        client.login({ email: String(email ?? '').trim(), password, deviceName }),
      )
      return adopt(result)
    },

    async register({ name, email, password, passwordConfirmation }) {
      const result = await call('crear la cuenta', () =>
        client.register({ name: String(name ?? '').trim(), email: String(email ?? '').trim(), password, passwordConfirmation, deviceName }),
      )
      return adopt(result)
    },

    /**
     * Cierra la sesión en este dispositivo (y revoca el token si hay conexión). Las rifas en la
     * nube quedan acá con sus cambios sin enviar; se envían al volver a iniciar sesión con esa cuenta.
     */
    async logout() {
      if (auth?.token) {
        try {
          await client.logout()
        } catch {
          // Sin conexión o con el token ya vencido: la sesión se cierra igual en este dispositivo.
        }
      }
      await store.clearAuth()
      set(null)
    },

    /** Vuelve a pedir los datos de la cuenta (p. ej. después de verificar el correo). */
    async refreshUser() {
      if (!auth) return null
      const user = await call('actualizar tu cuenta', () => client.me())
      await store.updateAuthUser(user)
      set(await store.getAuth())
      return auth?.user ?? null
    },

    forgotPassword: (email) => call('pedir el cambio de contraseña', () => client.forgotPassword(String(email ?? '').trim())),

    resetPassword: (data) => call('cambiar la contraseña', () => client.resetPassword(data)),

    resendVerification: () => call('reenviar el correo', () => client.resendVerification()),

    /**
     * Un pedido a la API con la sesión actual (rifas compartidas, miembros, invitaciones). Falla
     * con un `Error` en castellano; el original queda en `cause` (con su `kind`).
     * @template T
     * @param {string} action en infinitivo, p. ej. "cargar los miembros"
     * @param {(client: import('./api.js').ApiClient) => Promise<T>} fn
     * @returns {Promise<T>}
     */
    request(action, fn) {
      return call(action, () => fn(client))
    },
  }
}

/** Nombre del token en la API, para reconocerlo entre los dispositivos de la cuenta. */
export function deviceLabel(userAgent = globalThis.navigator?.userAgent ?? '') {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'Rifa en iPhone'
  if (/Android/i.test(userAgent)) return 'Rifa en Android'
  return 'Rifa en la compu'
}

/** El `kind` del error del transporte detrás de un error ya traducido (o `null`). */
export function errorKind(err) {
  if (isSyncError(err)) return err.kind
  return isSyncError(err?.cause) ? err.cause.kind : null
}
