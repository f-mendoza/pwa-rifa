import { SYNC_MESSAGES, SyncError, syncErrorFromStatus } from './transport.js'

/**
 * Transporte HTTP contra la API Laravel (`api/`, ver docs/sync-protocolo.md). Implementa el
 * typedef `Transport` de transport.js: el motor de sincronización no sabe que hay HTTP debajo.
 *
 * - Base: `VITE_API_URL` (por defecto `http://localhost:8000/api`).
 * - Sesión: `Authorization: Bearer <token>` (sin cookies). El token sale de `getToken()`, que
 *   la app arma con `settings.auth`.
 * - Errores: todo falla con `SyncError` (fetch que no llega → `network`; 401 → `auth`; 403 →
 *   `forbidden`; 404/410 → `gone`; 5xx → `server`; el resto → `client`), con el `message` en
 *   castellano que manda la API (en un 422, el primer error de validación).
 * - Cada pedido se corta a los `timeoutMs` (AbortController) y cuenta como sin conexión.
 */

export const DEFAULT_API_URL = 'http://localhost:8000/api'
export const DEFAULT_TIMEOUT_MS = 20_000
/** Subir un archivo puede tardar más que un pedido común. */
export const UPLOAD_TIMEOUT_MS = 90_000

/** La URL de la API para esta compilación (sin la barra final). */
export function apiBaseUrl(env = import.meta.env) {
  return String(env?.VITE_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
}

const TIMEOUT_MESSAGE = 'El servidor tardó demasiado en responder. Los cambios quedan guardados en este teléfono.'

/** El texto para mostrar de una respuesta con error: el primer error de validación o `message`. */
function errorMessage(status, body) {
  // Un 5xx trae textos técnicos (o en inglés): mejor el nuestro.
  if (status >= 500) return SYNC_MESSAGES.server
  if (!body || typeof body !== 'object') return undefined
  const errors = body.errors && typeof body.errors === 'object' ? Object.values(body.errors).flat() : []
  const first = errors.find((e) => typeof e === 'string' && e)
  if (first) return first
  return typeof body.message === 'string' && body.message ? body.message : undefined
}

async function readJson(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Hace pedidos a la API. Lo usan el transporte de sincronización y el cliente de cuentas.
 * @param {{ baseUrl?: string, getToken?: () => string|null|undefined, fetch?: typeof fetch, timeoutMs?: number }} options
 */
export function createRequester({
  baseUrl = apiBaseUrl(),
  getToken = () => null,
  fetch: fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const base = String(baseUrl).replace(/\/+$/, '')

  /**
   * @param {string} method
   * @param {string} path con la barra inicial, p. ej. `/raffles`
   * @param {{ json?: unknown, form?: FormData, query?: Record<string, unknown>, auth?: boolean, as?: 'json'|'blob', timeout?: number }} options
   */
  async function request(method, path, { json, form, query, auth = true, as = 'json', timeout = timeoutMs } = {}) {
    const headers = { Accept: 'application/json' }
    let body
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(json)
    } else if (form) {
      body = form // el navegador pone el Content-Type con el boundary
    }
    if (auth) {
      const token = getToken()
      if (!token) throw new SyncError('auth', 'Iniciá sesión para usar las rifas en la nube.', { status: 401 })
      headers.Authorization = `Bearer ${token}`
    }
    let url = `${base}${path}`
    if (query) {
      const params = new URLSearchParams()
      for (const [key, value] of Object.entries(query)) if (value != null) params.set(key, String(value))
      const qs = params.toString()
      if (qs) url += `?${qs}`
    }

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeout)
    try {
      let response
      try {
        response = await fetchImpl(url, { method, headers, body, signal: controller.signal })
      } catch (err) {
        throw new SyncError('network', timedOut ? TIMEOUT_MESSAGE : undefined, { cause: err })
      }
      if (!response.ok) {
        let parsed
        try {
          parsed = await readJson(response)
        } catch {
          parsed = undefined
        }
        throw syncErrorFromStatus(response.status, errorMessage(response.status, parsed), parsed?.errors ?? null)
      }
      if (response.status === 204) return null
      try {
        if (as === 'blob') return await response.blob()
        const data = await readJson(response)
        if (data === undefined) throw new Error('JSON inválido')
        return data
      } catch (err) {
        if (timedOut) throw new SyncError('network', TIMEOUT_MESSAGE, { cause: err })
        throw new SyncError('server', 'El servidor respondió algo que la app no entiende. Probá de nuevo en un rato.', {
          status: response.status,
          cause: err,
        })
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return { request, baseUrl: base }
}

const seg = (value) => encodeURIComponent(String(value))

/**
 * El transporte de sincronización por HTTP.
 * @param {Parameters<typeof createRequester>[0] & { requester?: ReturnType<typeof createRequester> }} options
 * @returns {import('./transport.js').Transport}
 */
export function createHttpTransport(options = {}) {
  const { request } = options.requester ?? createRequester(options)
  const raffle = (id) => `/raffles/${seg(id)}`
  return {
    createRaffle: (body) => request('POST', '/raffles', { json: { config: body?.config, share: body?.share } }),
    listRaffles: () => request('GET', '/raffles'),
    getSnapshot: (raffleId) => request('GET', `${raffle(raffleId)}/snapshot`),
    pullChanges: (raffleId, since) => request('GET', `${raffle(raffleId)}/changes`, { query: { since: since ?? 0 } }),
    pushOps: (raffleId, ops) => request('POST', `${raffle(raffleId)}/ops`, { json: { ops } }),
    deleteRaffle: async (raffleId) => {
      await request('DELETE', raffle(raffleId))
    },
    leaveRaffle: async (raffleId) => {
      await request('DELETE', `${raffle(raffleId)}/members/me`)
    },
    uploadReceipt: (raffleId, saleId, file, meta = {}) => {
      const form = new FormData()
      // PHP sólo lee multipart en POST: se manda POST con `_method=PUT` (Laravel lo toma como PUT).
      form.append('_method', 'PUT')
      form.append('file', file, meta.name || 'comprobante')
      if (meta.name) form.append('name', meta.name)
      if (typeof meta.thumb === 'string' && meta.thumb) form.append('thumb', meta.thumb)
      if (meta.addedAt != null) form.append('addedAt', String(Math.trunc(meta.addedAt)))
      return request('POST', `${raffle(raffleId)}/sales/${seg(saleId)}/receipt`, { form, timeout: UPLOAD_TIMEOUT_MS })
    },
    downloadReceipt: (raffleId, saleId) =>
      request('GET', `${raffle(raffleId)}/sales/${seg(saleId)}/receipt`, { as: 'blob', timeout: UPLOAD_TIMEOUT_MS }),
  }
}
