/**
 * Interfaz entre el motor de sincronización y el servidor (ver docs/sync-protocolo.md).
 * El motor sólo conoce esta interfaz: en los tests la implementa el servidor falso
 * (`fakeServer.js`) y en la app, un transporte HTTP contra la API.
 *
 * Todas las fechas son milisegundos epoch y los cuerpos van en camelCase.
 *
 * @typedef {{ id: string, config: object, share: object, lastSeq: number, createdAt: number, ownerId: number, deleted: boolean }} RaffleRow
 * @typedef {{ id: string, name: string, key: string, phone: string, email: string, referrer: string, createdAt: number, deleted: boolean }} PersonRow
 * @typedef {{ id: string, seq: number, participantId: string, amount: number|null, createdAt: number, createdBy: {id: number, name: string}|null, deleted: boolean }} SaleRow
 * @typedef {{ number: number, participantId: string, saleId: string, createdAt: number, createdBy: {id: number, name: string}|null, deleted: boolean }} NumberRow
 * @typedef {{ saleId: string, name: string, type: string, size: number, thumb: string|null, addedAt: number, hasFile: boolean, deleted: boolean }} ReceiptRow
 * @typedef {'owner'|'seller'|'viewer'} Role
 * @typedef {Array<[number, number]>|null} Ranges  talonario: `null` = sin restricción
 *
 * @typedef {{ raffle: RaffleRow, people: PersonRow[], sales: SaleRow[], numbers: NumberRow[], receipts: ReceiptRow[], role: Role, ranges: Ranges, version: number }} Snapshot
 * @typedef {{ raffle: RaffleRow|null, people: PersonRow[], sales: SaleRow[], numbers: NumberRow[], receipts: ReceiptRow[], aliases: Array<{entity: 'person', from: string, to: string}>, role: Role, ranges: Ranges, version: number }} Changes
 * @typedef {{ opId: string, type: string, payload: object, createdAt: number }} Operation
 * @typedef {{ opId: string, status: 'accepted'|'rejected', reason?: string, message?: string, result?: object }} OperationResult
 * @typedef {{ id: string, title: string, role: Role, archivedAt: number|null, ownerName: string, version: number, deleted: boolean }} RaffleSummary
 *
 * @typedef {object} Transport
 * @property {(body: { config: object, share: object }) => Promise<Snapshot>} createRaffle  POST /raffles
 * @property {() => Promise<RaffleSummary[]>} listRaffles  GET /raffles
 * @property {(raffleId: string) => Promise<Snapshot>} getSnapshot  GET /raffles/{id}/snapshot
 * @property {(raffleId: string, since: number) => Promise<Changes>} pullChanges  GET /raffles/{id}/changes?since=
 * @property {(raffleId: string, ops: Operation[]) => Promise<{ results: OperationResult[], version: number }>} pushOps  POST /raffles/{id}/ops (hasta 100)
 * @property {(raffleId: string) => Promise<void>} deleteRaffle  DELETE /raffles/{id} (sólo owner)
 * @property {(raffleId: string) => Promise<void>} leaveRaffle  DELETE /raffles/{id}/members/me
 * @property {(raffleId: string, saleId: string, file: Blob, meta: { name: string, type: string, size: number, thumb: string|null, addedAt: number }) => Promise<ReceiptRow>} uploadReceipt  PUT …/sales/{saleId}/receipt
 * @property {(raffleId: string, saleId: string) => Promise<Blob>} downloadReceipt  GET …/sales/{saleId}/receipt
 *
 * Cada método falla con un `SyncError`.
 */

/** Cantidad máxima de operaciones por lote (`POST /ops`). */
export const MAX_OPS_PER_BATCH = 100

/**
 * Error del transporte. `kind` dice qué hacer:
 * - `network`: no hubo respuesta (sin señal, servidor caído) → reintentar más tarde.
 * - `server`: 5xx → reintentar más tarde.
 * - `auth`: 401 → pedir que inicie sesión (sin perder el outbox).
 * - `forbidden`: 403 → ya no tiene acceso a la rifa (o el rol no alcanza para el endpoint).
 * - `gone`: 404/410 → la rifa no existe o se borró.
 * - `client`: 4xx de validación (422 y similares) → no tiene sentido reintentar igual.
 */
export class SyncError extends Error {
  /**
   * @param {'network'|'server'|'auth'|'forbidden'|'gone'|'client'} kind
   * @param {string} [message] texto para mostrar, en castellano
   * @param {{ status?: number, details?: unknown, cause?: unknown }} [extra]
   */
  constructor(kind, message, { status = null, details = null, cause } = {}) {
    super(message || SYNC_MESSAGES[kind] || SYNC_MESSAGES.client, cause ? { cause } : undefined)
    this.name = 'SyncError'
    this.kind = kind
    this.status = status
    this.details = details
  }

  /** ¿Conviene volver a intentar más tarde? */
  get retryable() {
    return this.kind === 'network' || this.kind === 'server'
  }
}

export const SYNC_MESSAGES = {
  network: 'Sin conexión con el servidor. Los cambios quedan guardados en este teléfono y se envían solos al volver la señal.',
  server: 'El servidor tuvo un problema. Se vuelve a intentar en un rato.',
  auth: 'Tu sesión venció. Iniciá sesión de nuevo para sincronizar.',
  forbidden: 'Ya no tenés acceso a esta rifa.',
  gone: 'Esta rifa ya no existe en la nube.',
  client: 'El servidor no aceptó el pedido.',
}

/** Para el transporte HTTP: el tipo de error según el código de respuesta. */
export function syncErrorKind(status) {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 404 || status === 410) return 'gone'
  if (status >= 500) return 'server'
  return 'client'
}

/** Para el transporte HTTP: arma el `SyncError` de una respuesta con error (`message` del cuerpo, si vino). */
export function syncErrorFromStatus(status, message, details) {
  return new SyncError(syncErrorKind(status), message, { status, details })
}

export const isSyncError = (err) => err instanceof SyncError || err?.name === 'SyncError'

/**
 * Para pedidos que hace la persona (crear, borrar, bajar un archivo): un error común con el
 * motivo en castellano, listo para mostrar. Los errores que no son del transporte pasan igual.
 * @param {string} action en infinitivo, p. ej. "crear una rifa en la nube"
 */
export function explainSyncError(err, action) {
  if (!isSyncError(err)) return err
  const messages = {
    network: `Para ${action} necesitás conexión a internet. Probá de nuevo cuando tengas señal.`,
    server: `El servidor no respondió bien y no se pudo ${action}. Probá de nuevo en un rato.`,
    auth: `Tu sesión venció. Iniciá sesión de nuevo para ${action}.`,
  }
  return new Error(messages[err.kind] ?? err.message, { cause: err })
}
