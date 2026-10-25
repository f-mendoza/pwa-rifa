import { store as defaultStore, hasReceiptFile, receiptBlob } from '../db.js'
import { newId } from '../lib/ids.js'
import { applyChangeRows, applySnapshotRows, pendingKeys } from './local.js'
import { MAX_OPS_PER_BATCH, SyncError, explainSyncError, isSyncError } from './transport.js'

/**
 * Motor de sincronización de una rifa en la nube contra un `transport` (ver transport.js).
 * Un ciclo:
 *   1. push de las operaciones pendientes, en orden y en lotes; las rechazadas pasan a `conflicts`;
 *   2. si hay una reconciliación pendiente (o es la primera vez), snapshot completo; si no, pull incremental;
 *   3. subida de los archivos de comprobantes cuyas ventas ya están en el servidor;
 *   4. confirma el ciclo, limpia el error y actualiza `lastSyncAt`;
 *      `syncedVersion`, `role` y `ranges` se guardan con el pull.
 * Las rifas locales no hacen nada de red.
 */

const syncTables = (db) => [db.raffles, db.people, db.numbers, db.sales, db.receipts, db.outbox, db.uploads]

/**
 * @param {string} raffleId
 * @param {import('./transport.js').Transport} transport
 * @param {{ store?: ReturnType<typeof import('../db.js').createStore> }} options
 * @returns {Promise<{ skipped?: string, pushed?: number, rejected?: number, uploaded?: number, version?: number }>}
 * @throws {SyncError} si falla el transporte (con 403/404/410 deja marcada la rifa antes de fallar)
 */
export async function syncRaffle(raffleId, transport, { store = defaultStore } = {}) {
  const { db } = store
  const raffle = await db.raffles.get(raffleId)
  if (!raffle) return { skipped: 'missing' }
  if (!raffle.remote) return { skipped: 'local' }
  if (raffle.remote.status && raffle.remote.status !== 'active') return { skipped: raffle.remote.status }
  const cycleId = newId()
  try {
    // Si se cierra la página tras confirmar el push, todavía queda pendiente completar el pull.
    await patchRemote(db, raffleId, { syncPending: true, syncCycleId: cycleId })
    const { pushed, rejected } = await pushPending(db, raffleId, transport, cycleId)
    const current = await db.raffles.get(raffleId)
    let version
    if (current.remote.needsReconcile || current.remote.syncedVersion == null) {
      // Reconciliarse con el estado completo deshace los cambios optimistas rechazados.
      const snapshot = await transport.getSnapshot(raffleId)
      // Las funciones de la transacción son async: así Dexie sigue los await nativos de adentro.
      await db.transaction('rw', syncTables(db), async () => applySnapshotRows(db, snapshot))
      version = snapshot.version
    } else {
      const changes = await transport.pullChanges(raffleId, current.remote.syncedVersion)
      await db.transaction('rw', syncTables(db), async () => applyChangeRows(db, raffleId, changes))
      version = changes.version
    }
    const after = await db.raffles.get(raffleId)
    const uploaded = after?.remote?.status === 'active' ? await uploadReceipts(db, raffleId, transport) : 0
    // Otra pestaña puede haber iniciado un ciclo o confirmado un push mientras ésta esperaba.
    await patchRemote(db, raffleId, { syncPending: false, syncCycleId: null, syncError: null, lastSyncAt: Date.now() }, cycleId)
    return { pushed, rejected, uploaded, version }
  } catch (err) {
    if (isSyncError(err) && (err.kind === 'forbidden' || err.kind === 'gone')) {
      await markStatus(db, raffleId, err.kind === 'gone' ? 'deleted' : 'revoked')
    } else {
      // Persistido por rifa: la UI de todas las pestañas lo ve, incluso después de recargar.
      await patchRemote(db, raffleId, { syncError: { kind: isSyncError(err) ? err.kind : 'server' } }, cycleId)
    }
    throw err
  }
}

/** Marca una rifa en la nube como borrada (`deleted`) o sin acceso (`revoked`). */
export function markStatus(db, raffleId, status) {
  return patchRemote(db, raffleId, { status })
}

function patchRemote(db, raffleId, patch, cycleId) {
  return db.raffles
    .where('id')
    .equals(raffleId)
    .modify((raffle) => {
      if (raffle.remote && (cycleId === undefined || raffle.remote.syncCycleId === cycleId)) {
        raffle.remote = { ...raffle.remote, ...patch }
      }
    })
}

const REJECTED_FALLBACK = 'El servidor no aceptó este cambio. Se corregirá al actualizar los datos desde la nube.'

/** Envía el outbox de la rifa en orden. Aceptadas → salen; rechazadas → salen y quedan como conflicto. */
async function pushPending(db, raffleId, transport, cycleId) {
  let pushed = 0
  let rejected = 0
  for (;;) {
    const rows = await db.outbox.where('raffleId').equals(raffleId).limit(MAX_OPS_PER_BATCH).toArray()
    if (!rows.length) break
    let response
    try {
      response = await transport.pushOps(
        raffleId,
        rows.map(({ opId, type, payload, createdAt }) => ({ opId, type, payload, createdAt })),
      )
    } catch (err) {
      await noteAttempt(db, rows, err)
      throw err
    }
    const results = new Map((response?.results ?? []).map((r) => [r.opId, r]))
    const unanswered = rows.filter((row) => !results.has(row.opId))
    await db.transaction('rw', db.raffles, db.outbox, db.conflicts, async () => {
      // Un push que responde tarde también debe dejar su pull pendiente, aunque otro ciclo
      // ya haya terminado. La marca y la retirada del outbox se confirman juntas.
      if (unanswered.length < rows.length) {
        await patchRemote(db, raffleId, { syncPending: true, syncCycleId: cycleId })
      }
      for (const row of rows) {
        const result = results.get(row.opId)
        if (!result) continue
        await db.outbox.delete(row.seq)
        if (result.status === 'accepted') {
          pushed++
          continue
        }
        rejected++
        // La obligación de reconciliar se guarda junto con el rechazo: sobrevive a un corte
        // en un lote posterior, al fallo del snapshot y al cierre de la aplicación.
        await patchRemote(db, raffleId, { needsReconcile: true })
        await db.conflicts.add({
          raffleId,
          opId: row.opId,
          type: row.type,
          payload: row.payload,
          reason: result.reason ?? 'rejected',
          message: result.message || REJECTED_FALLBACK,
          createdAt: Date.now(),
        })
      }
    })
    if (unanswered.length) {
      // No debería pasar; si pasa, no se insiste en este ciclo (quedan para el próximo).
      const err = new SyncError('server', 'El servidor no respondió por todos los cambios enviados.')
      await noteAttempt(db, unanswered, err)
      throw err
    }
  }
  return { pushed, rejected }
}

function noteAttempt(db, rows, err) {
  return db.outbox
    .where('seq')
    .anyOf(rows.map((r) => r.seq))
    .modify((row) => {
      row.attempts = (row.attempts ?? 0) + 1
      row.error = err?.message ?? String(err)
    })
}

/** Sube los archivos pendientes cuyas ventas ya existen en el servidor (sin operaciones pendientes). */
async function uploadReceipts(db, raffleId, transport) {
  const queue = await db.uploads.where('raffleId').equals(raffleId).toArray()
  if (!queue.length) return 0
  const pending = await pendingKeys(db, raffleId)
  let uploaded = 0
  for (const item of queue) {
    const { saleId } = item
    if (pending.has(`sale:${saleId}`) || pending.has(`receipt:${saleId}`)) continue
    const receipt = await db.receipts.get(saleId)
    if (!receipt || !hasReceiptFile(receipt)) {
      await db.uploads.delete(saleId)
      continue
    }
    const meta = { name: receipt.name ?? '', type: receipt.type, size: receipt.size, thumb: receipt.thumb ?? null, addedAt: receipt.addedAt }
    try {
      await transport.uploadReceipt(raffleId, saleId, receiptBlob(receipt), meta)
    } catch (err) {
      if (!isSyncError(err) || err.kind !== 'client') throw err
      // El servidor no lo acepta (muy pesado, formato): reintentar no sirve, se avisa.
      await db.transaction('rw', db.uploads, db.conflicts, async () => {
        await db.uploads.delete(saleId)
        await db.conflicts.add({
          raffleId,
          opId: null,
          type: 'receipt.upload',
          payload: { saleId, name: meta.name },
          reason: 'upload_failed',
          message: err.message,
          createdAt: Date.now(),
        })
      })
      continue
    }
    // Si mientras subía se eligió otro archivo, ese sigue en la cola.
    await db.transaction('rw', db.uploads, async () => {
      const current = await db.uploads.get(saleId)
      if (current && current.addedAt === item.addedAt) await db.uploads.delete(saleId)
    })
    uploaded++
  }
  return uploaded
}

/**
 * Descarga una rifa en la nube a la que se tiene acceso (p. ej. después de aceptar una
 * invitación) y la deja guardada en este dispositivo.
 */
export async function downloadRaffle(raffleId, transport, { store = defaultStore, activate = true } = {}) {
  let snapshot
  try {
    snapshot = await transport.getSnapshot(raffleId)
  } catch (err) {
    throw explainSyncError(err, 'abrir la rifa')
  }
  return store.applySnapshot(snapshot, { activate })
}

/** Baja el archivo de un comprobante que vino del servidor sin él y lo guarda en el dispositivo. */
export async function fetchReceiptFile(raffleId, saleId, transport, { store = defaultStore } = {}) {
  if (!transport) throw new Error('Iniciá sesión para ver este comprobante.')
  let blob
  try {
    blob = await transport.downloadReceipt(raffleId, saleId)
  } catch (err) {
    throw explainSyncError(err, 'ver el comprobante')
  }
  await store.storeReceiptFile(saleId, blob)
  return blob
}

/**
 * Borra una rifa en la nube: si es de quien la organiza, en el servidor; si no, sale de ella.
 * Después la quita del dispositivo con sus operaciones pendientes. Si la rifa ya estaba borrada
 * o sin acceso, sólo la quita. Una rifa local se borra directamente.
 * @returns {Promise<string>} la rifa que queda abierta
 */
export async function deleteCloudRaffle(raffleId, transport, { store = defaultStore } = {}) {
  const raffle = await store.db.raffles.get(raffleId)
  const remote = raffle?.remote
  if (remote && (remote.status ?? 'active') === 'active') {
    if (!transport) throw new Error('Iniciá sesión para borrar esta rifa de la nube.')
    try {
      if (remote.role === 'owner') await transport.deleteRaffle(raffleId)
      else await transport.leaveRaffle(raffleId)
    } catch (err) {
      const alreadyGone = isSyncError(err) && (err.kind === 'gone' || err.kind === 'forbidden')
      if (!alreadyGone) throw explainSyncError(err, remote.role === 'owner' ? 'borrar la rifa' : 'salir de la rifa')
    }
  }
  return store.removeRaffleLocally(raffleId)
}
