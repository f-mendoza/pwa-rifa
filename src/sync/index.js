/**
 * Punto de entrada de la sincronización para la app. El transporte (HTTP contra la API, o el
 * servidor falso en desarrollo) se registra acá; mientras no haya ninguno, las rifas en la nube
 * piden iniciar sesión y las locales no se enteran.
 */
export { createSyncManager } from './manager.js'
export { deleteCloudRaffle, downloadRaffle, fetchReceiptFile, syncRaffle } from './engine.js'
export { SyncError, isSyncError } from './transport.js'
export { describeConflict, describeSyncState } from './status.js'

let transportFactory = null
let session = null

/**
 * Registra de dónde sale el transporte con la sesión actual (o `null` para quitarlo).
 * @param {(() => import('./transport.js').Transport|null)|null} factory
 */
export function setTransportFactory(factory) {
  transportFactory = factory
}

/** El transporte con la sesión actual, o `null` si no hay (sin sesión o sin API configurada). */
export function currentTransport() {
  return transportFactory?.() ?? null
}

/**
 * Registra la sesión de la app (ver session.js) y, con ella, el transporte: el cliente de la API
 * mientras haya sesión. `null` la quita.
 * @param {ReturnType<typeof import('./session.js').createSession>|null} next
 */
export function setSession(next) {
  session = next
  setTransportFactory(next ? () => next.transport() : null)
}

/** La sesión de la app, o `null` si no hay nube configurada (p. ej. en los tests de componentes). */
export function currentSession() {
  return session
}
