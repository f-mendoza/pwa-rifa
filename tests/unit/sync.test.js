import { describe, expect, it } from 'vitest'
import { createStore } from '../../src/db.js'
import { pendingKeys } from '../../src/sync/local.js'
import { deleteCloudRaffle, downloadRaffle, fetchReceiptFile, syncRaffle } from '../../src/sync/engine.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { describeSyncState } from '../../src/sync/status.js'
import { SyncError } from '../../src/sync/transport.js'
import { deferred, device, ofRaffle, outbox, receipt, sharedRaffle, tickets } from './syncHelpers.js'

const sync = (phone, raffleId) => syncRaffle(raffleId, phone.transport, { store: phone.store })
const numbersOf = async (phone, raffleId) => (await tickets(phone.store, raffleId)).map((t) => t.number)
const personByName = async (phone, raffleId, name) =>
  (await ofRaffle(phone.store.db.people, raffleId)).find((p) => p.name === name)

describe('ciclo básico', () => {
  it('una pestaña que termina no limpia el pull pendiente de otra', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    const secondTab = createStore(a.store.db.name)
    const uploading = deferred()
    const finishUpload = deferred()
    const pulling = deferred()
    const finishPull = deferred()
    await a.store.assignNumbers(raffleId, [1], { name: 'Uno' }, { receipt: receipt() })
    const older = syncRaffle(raffleId, {
      ...a.transport,
      uploadReceipt: async (...args) => {
        uploading.resolve()
        await finishUpload.promise
        return a.transport.uploadReceipt(...args)
      },
    }, { store: a.store })
    await uploading.promise
    await b.store.assignNumbers(raffleId, [3], { name: 'Tres' })
    await sync(b, raffleId)
    const saleId = await a.store.assignNumbers(raffleId, [2], { name: 'Dos' })
    const newer = syncRaffle(raffleId, {
      ...a.transport,
      pullChanges: async (...args) => {
        pulling.resolve()
        await finishPull.promise
        return a.transport.pullChanges(...args)
      },
    }, { store: secondTab })
    try {
      await pulling.promise
      finishUpload.resolve()
      await older
      expect(await outbox(a.store, raffleId)).toEqual([])
      expect(await a.store.db.uploads.count()).toBe(0)
      const remote = (await a.store.db.raffles.get(raffleId)).remote
      expect(remote.syncPending).toBe(true)
      expect(describeSyncState({ ...remote, pending: 0 }).tone).toBe('pending')
      expect(await numbersOf(a, raffleId)).toEqual([1, 2])

      // Simula el cierre de la pestaña que esperaba el pull: otro ciclo retoma la rifa inactiva.
      await a.store.createRaffle({ title: 'Local abierta' })
      await sync(a, raffleId)
      expect(await numbersOf(a, raffleId)).toEqual([1, 2, 3])
      expect((await a.store.db.sales.get(saleId)).seq).toBe(3)
      expect((await a.store.db.raffles.get(raffleId)).remote.syncPending).toBe(false)
    } finally {
      finishUpload.resolve()
      finishPull.resolve()
      await Promise.all([older, newer])
      secondTab.db.close()
    }
  })

  it('el error tardío de una pestaña no reemplaza un ciclo ya completado por otra', async () => {
    const { a, raffleId } = await sharedRaffle()
    const pulling = deferred()
    const finishPull = deferred()
    const older = syncRaffle(raffleId, {
      ...a.transport,
      pullChanges: async () => {
        pulling.resolve()
        return finishPull.promise
      },
    }, { store: a.store }).catch((err) => err)
    await pulling.promise
    await sync(a, raffleId)
    finishPull.reject(new SyncError('network'))
    expect(await older).toMatchObject({ kind: 'network' })
    expect((await a.store.db.raffles.get(raffleId)).remote).toMatchObject({ syncPending: false, syncError: null })
  })

  it('un push tardío vuelve a dejar pendiente su pull aunque otro ciclo haya terminado', async () => {
    const { a, raffleId } = await sharedRaffle()
    const pushing = deferred()
    const finishPush = deferred()
    const pulling = deferred()
    const finishPull = deferred()
    await a.store.assignNumbers(raffleId, [1], { name: 'Uno' })
    const older = syncRaffle(raffleId, {
      ...a.transport,
      pushOps: async (...args) => {
        pushing.resolve()
        await finishPush.promise
        return a.transport.pushOps(...args)
      },
      pullChanges: async (...args) => {
        pulling.resolve()
        await finishPull.promise
        return a.transport.pullChanges(...args)
      },
    }, { store: a.store })
    try {
      await pushing.promise
      await sync(a, raffleId)
      await a.store.assignNumbers(raffleId, [2], { name: 'Dos' })
      finishPush.resolve()
      await pulling.promise
      expect(await outbox(a.store, raffleId)).toEqual([])
      expect((await a.store.db.raffles.get(raffleId)).remote.syncPending).toBe(true)
    } finally {
      finishPush.resolve()
      finishPull.resolve()
      await older
    }
    expect((await a.store.db.raffles.get(raffleId)).remote.syncPending).toBe(false)
  })

  it('mantiene el ciclo pendiente después del push hasta terminar de aplicar el pull', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [5], { name: 'Juan' })
    const pullChanges = a.transport.pullChanges
    a.transport.pullChanges = async (...args) => {
      expect(await outbox(a.store, raffleId)).toEqual([])
      expect((await a.store.db.raffles.get(raffleId)).remote.syncPending).toBe(true)
      return pullChanges(...args)
    }
    await sync(a, raffleId)
    expect((await a.store.db.raffles.get(raffleId)).remote).toMatchObject({ syncPending: false, syncError: null })
  })

  it('lo que vende un teléfono le llega al otro, con el seq del servidor y quién vendió', async () => {
    const { server, a, b, raffleId } = await sharedRaffle()
    await b.store.assignNumbers(raffleId, [7, 8], { name: 'Juan', phone: '1' })
    expect(await sync(b, raffleId)).toMatchObject({ pushed: 1, rejected: 0 })
    expect(await outbox(b.store, raffleId)).toEqual([])
    await sync(a, raffleId)
    expect(await numbersOf(a, raffleId)).toEqual([7, 8])
    const [sale] = await ofRaffle(a.store.db.sales, raffleId)
    expect(sale).toMatchObject({ seq: 1, createdBy: { id: b.user.id, name: 'Beto' } })
    expect((await personByName(a, raffleId, 'Juan')).phone).toBe('1')
    const remote = (await a.store.db.raffles.get(raffleId)).remote
    expect(remote).toMatchObject({ syncedVersion: server.inspect(raffleId).version, role: 'owner', status: 'active', lastSyncAt: expect.any(Number) })
  })

  it('una rifa local no hace nada de red', async () => {
    const server = createFakeServer()
    const transport = server.transportFor(server.createUser('Ana'))
    const store = device()
    await store.db.open()
    const local = (await store.db.settings.get('activeRaffle')).value
    await store.assignNumbers(local, [1], { name: 'Ana' })
    expect(await syncRaffle(local, transport, { store })).toEqual({ skipped: 'local' })
    expect(transport.calls).toEqual([])
  })

  it('configuración y estilo de la imagen viajan (gana la última escritura)', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.saveConfig(raffleId, { title: 'Club', total: 120, prizes: ['Bici'] })
    await b.store.saveSharePrefs(raffleId, { palette: 'menta' })
    await sync(a, raffleId)
    await sync(b, raffleId)
    await sync(a, raffleId)
    for (const phone of [a, b]) {
      const row = await phone.store.db.raffles.get(raffleId)
      expect(row.config).toMatchObject({ total: 120, prizes: ['Bici'] })
      expect(row.share.palette).toBe('menta')
    }
  })
})

describe('conflictos', () => {
  it('retoma el snapshot tras un corte y una reapertura, aunque se hayan descartado los avisos', async () => {
    const { server, a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [7], { name: 'Juan' })
    await sync(a, raffleId)
    await b.store.assignNumbers(raffleId, [7, 9], { name: 'Pedro' })
    const getSnapshot = b.transport.getSnapshot
    b.transport.getSnapshot = async () => { throw new SyncError('network') }
    await expect(sync(b, raffleId)).rejects.toMatchObject({ kind: 'network' })
    expect(await outbox(b.store, raffleId)).toEqual([])
    expect((await b.store.db.raffles.get(raffleId)).remote).toMatchObject({ needsReconcile: true, syncError: { kind: 'network' } })
    await b.store.dismissConflicts(raffleId)
    b.store.db.close()
    await b.store.db.open()
    b.transport.getSnapshot = getSnapshot

    // Una venta nueva mientras se recupera no debe perderse con el reemplazo completo.
    b.transport.getSnapshot = async (...args) => {
      const snapshot = await getSnapshot(...args)
      await b.store.assignNumbers(raffleId, [10], { name: 'Caro' })
      return snapshot
    }
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([7, 10])
    expect(await ofRaffle(b.store.db.sales, raffleId)).toHaveLength(2)
    expect(await personByName(b, raffleId, 'Pedro')).toBeUndefined()
    expect(await outbox(b.store, raffleId)).toHaveLength(1)
    expect((await b.store.db.raffles.get(raffleId)).remote).toMatchObject({ needsReconcile: false, syncError: null })
    b.transport.getSnapshot = getSnapshot
    await sync(b, raffleId)
    expect(server.inspect(raffleId).numbers.map((n) => n.number)).toEqual([7, 10])
  })

  it('conserva la reconciliación si falla un lote posterior al que tuvo rechazos', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [7], { name: 'Juan' })
    await sync(a, raffleId)
    await b.store.assignNumbers(raffleId, [7, 9], { name: 'Pedro' })
    for (let i = 0; i < 100; i++) await b.store.saveSharePrefs(raffleId, { palette: i % 2 ? 'menta' : 'limon' })
    expect(await outbox(b.store, raffleId)).toHaveLength(101)
    const pushOps = b.transport.pushOps
    let batches = 0
    b.transport.pushOps = async (...args) => {
      if (++batches === 2) throw new SyncError('server')
      return pushOps(...args)
    }
    await expect(sync(b, raffleId)).rejects.toMatchObject({ kind: 'server' })
    expect((await b.store.db.raffles.get(raffleId)).remote.needsReconcile).toBe(true)
    expect(await outbox(b.store, raffleId)).toHaveLength(1)
    b.transport.pushOps = pushOps
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([7])
    expect(await ofRaffle(b.store.db.sales, raffleId)).toHaveLength(1)
    expect((await b.store.db.raffles.get(raffleId)).remote.needsReconcile).toBe(false)
  })

  it('no da por reconciliado un snapshot cuya transacción local falla', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [7], { name: 'Juan' })
    await sync(a, raffleId)
    await b.store.assignNumbers(raffleId, [7, 9], { name: 'Pedro' })
    const getSnapshot = b.transport.getSnapshot
    b.transport.getSnapshot = async (...args) => ({ ...await getSnapshot(...args), people: null })
    await expect(sync(b, raffleId)).rejects.toThrow()
    expect((await b.store.db.raffles.get(raffleId)).remote.needsReconcile).toBe(true)
    expect(await numbersOf(b, raffleId)).toEqual([7, 9])
    b.transport.getSnapshot = getSnapshot
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([7])
    expect((await b.store.db.raffles.get(raffleId)).remote.needsReconcile).toBe(false)
  })

  it('dos teléfonos venden el mismo número sin conexión: uno queda con un conflicto y se corrige', async () => {
    const { server, a, b, raffleId } = await sharedRaffle()
    a.transport.setOnline(false)
    b.transport.setOnline(false)
    await a.store.assignNumbers(raffleId, [7], { name: 'Juan' })
    await b.store.assignNumbers(raffleId, [7, 9], { name: 'Pedro' })
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'network' })
    // Sin conexión no se pierde nada.
    expect(await outbox(a.store, raffleId)).toHaveLength(1)

    a.transport.setOnline(true)
    b.transport.setOnline(true)
    expect(await sync(a, raffleId)).toMatchObject({ pushed: 1, rejected: 0 })
    expect(await sync(b, raffleId)).toMatchObject({ pushed: 0, rejected: 1 })

    const [conflict] = await b.store.db.conflicts.toArray()
    expect(conflict).toMatchObject({
      raffleId,
      type: 'numbers.assign',
      reason: 'number_taken',
      message: 'El número 7 ya lo había vendido Ana a Juan desde otro teléfono',
      payload: expect.objectContaining({ numbers: [7, 9] }),
    })
    // El estado local de B quedó como el del servidor: el 7 es de Juan, el 9 libre, Pedro no está.
    expect(await numbersOf(b, raffleId)).toEqual([7])
    const [ticket] = await tickets(b.store, raffleId)
    expect((await b.store.db.people.get(ticket.participantId)).name).toBe('Juan')
    expect(await personByName(b, raffleId, 'Pedro')).toBeUndefined()
    expect(await ofRaffle(b.store.db.sales, raffleId)).toHaveLength(1)
    expect(await outbox(b.store, raffleId)).toEqual([])
    expect(server.inspect(raffleId).numbers.map((n) => n.number)).toEqual([7])

    await b.store.dismissConflicts(raffleId)
    expect(await b.store.db.conflicts.count()).toBe(0)
  })

  it('reconciliar con el snapshot conserva lo que todavía está pendiente', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [1], { name: 'Juan' })
    await sync(a, raffleId)
    await b.store.assignNumbers(raffleId, [1], { name: 'Pedro' })
    // Mientras el teléfono espera el snapshot, se vende otro número: no se tiene que perder.
    const getSnapshot = b.transport.getSnapshot
    b.transport.getSnapshot = async (id) => {
      const snap = await getSnapshot(id)
      await b.store.assignNumbers(raffleId, [2], { name: 'Caro' })
      return snap
    }
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([1, 2])
    expect(await outbox(b.store, raffleId)).toHaveLength(1)
    b.transport.getSnapshot = getSnapshot
    await sync(b, raffleId)
    await sync(a, raffleId)
    expect(await numbersOf(a, raffleId)).toEqual([1, 2])
  })
})

describe('idempotencia', () => {
  it('si se pierde la respuesta del push, reenviar el mismo opId no duplica nada', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [3], { name: 'Juan' })
    const [op] = await outbox(a.store, raffleId)
    const pushOps = a.transport.pushOps
    a.transport.pushOps = async (...args) => {
      await pushOps(...args)
      a.transport.pushOps = pushOps
      throw new (await import('../../src/sync/transport.js')).SyncError('network', 'Se cortó')
    }
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'network' })
    const [kept] = await outbox(a.store, raffleId)
    expect(kept).toMatchObject({ opId: op.opId, attempts: 1, error: 'Se cortó' })

    expect(await sync(a, raffleId)).toMatchObject({ pushed: 1, rejected: 0 })
    expect(server.operationCount).toBe(1)
    expect(server.inspect(raffleId).sales).toHaveLength(1)
    expect(await ofRaffle(a.store.db.sales, raffleId)).toHaveLength(1)
    expect(await outbox(a.store, raffleId)).toEqual([])
  })
})

describe('pull', () => {
  it('no pisa lo que tiene operaciones pendientes', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    const saleId = await a.store.assignNumbers(raffleId, [1], { name: 'Juan' })
    await sync(a, raffleId)
    await sync(b, raffleId)
    await a.store.setPurchaseAmount(saleId, 9999)
    await sync(a, raffleId)
    // B corrige el mismo monto justo entre su push y su pull.
    const pullChanges = b.transport.pullChanges
    b.transport.pullChanges = async (...args) => {
      const changes = await pullChanges(...args)
      await b.store.setPurchaseAmount(saleId, 1234)
      return changes
    }
    await sync(b, raffleId)
    expect((await b.store.db.sales.get(saleId)).amount).toBe(1234)
    expect(await outbox(b.store, raffleId)).toHaveLength(1)
    expect(await pendingKeys(b.store.db, raffleId)).toContain(`sale:${saleId}`)

    b.transport.pullChanges = pullChanges
    await sync(b, raffleId)
    await sync(a, raffleId)
    expect((await a.store.db.sales.get(saleId)).amount).toBe(1234)
  })

  it('aplica las bajas: venta anulada, número liberado, persona y comprobante', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    const saleId = await a.store.assignNumbers(raffleId, [1, 2], { name: 'Juan' }, { receipt: receipt() })
    await a.store.assignNumbers(raffleId, [5, 6], { name: 'Caro' })
    await sync(a, raffleId)
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([1, 2, 5, 6])
    expect(await b.store.db.receipts.get(saleId)).toBeTruthy()

    await a.store.voidPurchase(saleId)
    await a.store.releaseNumber(raffleId, 6)
    await sync(a, raffleId)
    await sync(b, raffleId)
    expect(await numbersOf(b, raffleId)).toEqual([5])
    expect(await b.store.db.sales.get(saleId)).toBeUndefined()
    expect(await b.store.db.receipts.get(saleId)).toBeUndefined()
    expect(await personByName(b, raffleId, 'Juan')).toBeUndefined()
    expect(await personByName(b, raffleId, 'Caro')).toBeTruthy()
  })

  it('la misma persona creada en dos teléfonos queda unificada con el id del servidor', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [1], { name: 'Ana Pérez', phone: '1' })
    await b.store.assignNumbers(raffleId, [2], { name: 'ana perez', email: 'a@b.c' })
    const localId = (await personByName(b, raffleId, 'ana perez')).id
    await sync(a, raffleId)
    await sync(b, raffleId)
    const people = await ofRaffle(b.store.db.people, raffleId)
    expect(people).toHaveLength(1)
    expect(people[0].id).not.toBe(localId)
    expect(people[0]).toMatchObject({ name: 'Ana Pérez', phone: '1', email: 'a@b.c' })
    const rows = await tickets(b.store, raffleId)
    expect(rows.every((t) => t.participantId === people[0].id)).toBe(true)
    const sales = await ofRaffle(b.store.db.sales, raffleId)
    expect(sales.every((s) => s.participantId === people[0].id)).toBe(true)
  })

  it('una unificación hecha en otro teléfono llega como alias y reescribe las referencias', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [1], { name: 'Ana' })
    await a.store.assignNumbers(raffleId, [2], { name: 'Beto' })
    await sync(a, raffleId)
    await sync(b, raffleId)
    const beto = await personByName(a, raffleId, 'Beto')
    const anaId = (await personByName(a, raffleId, 'Ana')).id
    await a.store.updateParticipant(beto.id, { name: 'ANA' })
    await sync(a, raffleId)
    await sync(b, raffleId)
    expect(await b.store.db.people.get(beto.id)).toBeUndefined()
    expect((await tickets(b.store, raffleId)).map((t) => t.participantId)).toEqual([anaId, anaId])
  })

  it('el seq provisorio lo corrige el servidor', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [1], { name: 'Juan' })
    const mine = await b.store.assignNumbers(raffleId, [2], { name: 'Pedro' })
    expect((await b.store.db.sales.get(mine)).seq).toBe(1)
    await sync(a, raffleId)
    await sync(b, raffleId)
    expect((await b.store.db.sales.get(mine)).seq).toBe(2)
    expect((await b.store.db.raffles.get(raffleId)).lastSeq).toBe(2)
    // La próxima venta provisoria sigue desde el último del servidor.
    await b.store.assignNumbers(raffleId, [3], { name: 'Pedro' })
    expect((await outbox(b.store, raffleId))[0].payload.seq).toBe(3)
  })
})

describe('comprobantes', () => {
  it('se suben después del push; el otro teléfono recibe la metadata y lo baja al abrirlo', async () => {
    const { server, a, b, raffleId } = await sharedRaffle()
    const saleId = await a.store.assignNumbers(raffleId, [1], { name: 'Juan' }, { receipt: receipt('%PDF') })
    expect(await sync(a, raffleId)).toMatchObject({ uploaded: 1 })
    expect(await a.store.db.uploads.count()).toBe(0)
    expect(server.inspect(raffleId).receipts).toEqual([expect.objectContaining({ saleId, hasFile: true, size: 4 })])

    // A conserva su archivo aunque el pull traiga la metadata.
    await sync(a, raffleId)
    const own = await a.store.db.receipts.get(saleId)
    expect(own.blob ?? own.buffer).toBeTruthy()
    expect(own.remote).toBeUndefined()

    await sync(b, raffleId)
    const remote = await b.store.db.receipts.get(saleId)
    expect(remote).toMatchObject({ purchaseId: saleId, raffleId, name: 'pago.pdf', size: 4, remote: true, hasFile: true })
    expect(remote.blob).toBeUndefined()
    expect(remote.buffer).toBeUndefined()

    const blob = await fetchReceiptFile(raffleId, saleId, b.transport, { store: b.store })
    expect(await blob.text()).toBe('%PDF')
    const stored = await b.store.db.receipts.get(saleId)
    expect(stored.remote).toBeUndefined()
    expect(stored.blob ?? stored.buffer).toBeTruthy()
  })

  it('si el servidor no acepta el archivo, deja de intentarlo y lo explica', async () => {
    const { a, raffleId } = await sharedRaffle()
    const saleId = await a.store.assignNumbers(raffleId, [1], { name: 'Juan' })
    await a.store.setReceipt(saleId, { name: 'x.txt', type: 'text/plain', size: 1, blob: new Blob(['x'], { type: 'text/plain' }), thumb: null, addedAt: 5 })
    await sync(a, raffleId)
    expect(await a.store.db.uploads.count()).toBe(0)
    expect(await a.store.db.conflicts.toArray()).toEqual([
      expect.objectContaining({ type: 'receipt.upload', reason: 'upload_failed', message: 'El comprobante tiene que ser una imagen o un PDF' }),
    ])
  })
})

describe('errores del transporte', () => {
  it('conserva el error del pull sin operaciones pendientes hasta completar la recuperación', async () => {
    const { a, raffleId } = await sharedRaffle()
    a.transport.setOnline(false)
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'network' })
    expect(await outbox(a.store, raffleId)).toEqual([])
    a.store.db.close()
    await a.store.db.open()
    expect((await a.store.db.raffles.get(raffleId)).remote.syncError).toEqual({ kind: 'network' })
    a.transport.setOnline(true)
    await sync(a, raffleId)
    expect((await a.store.db.raffles.get(raffleId)).remote.syncError).toBeNull()
  })

  it('no limpia el error hasta que también se hayan subido los comprobantes', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [3], { name: 'Juan' }, { receipt: receipt() })
    const uploadReceipt = a.transport.uploadReceipt
    a.transport.uploadReceipt = async () => { throw new SyncError('network') }
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'network' })
    expect(await outbox(a.store, raffleId)).toEqual([])
    expect(await a.store.db.uploads.count()).toBe(1)
    expect((await a.store.db.raffles.get(raffleId)).remote.syncError).toEqual({ kind: 'network' })
    a.transport.uploadReceipt = uploadReceipt
    await sync(a, raffleId)
    expect(await a.store.db.uploads.count()).toBe(0)
    expect((await a.store.db.raffles.get(raffleId)).remote.syncError).toBeNull()
  })

  it('401: se pide iniciar sesión y el outbox queda intacto', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [4], { name: 'Juan' })
    server.expireSessions(a.user)
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'auth' })
    expect(await outbox(a.store, raffleId)).toHaveLength(1)
    expect(await numbersOf(a, raffleId)).toEqual([4])
    server.restoreSessions(a.user)
    await sync(a, raffleId)
    expect(await outbox(a.store, raffleId)).toEqual([])
  })

  it('410: la rifa queda marcada como borrada, no se sincroniza más y se puede guardar una copia', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await b.store.assignNumbers(raffleId, [3], { name: 'Juan' })
    await sync(b, raffleId)
    await a.transport.deleteRaffle(raffleId)
    await b.store.assignNumbers(raffleId, [4], { name: 'Pedro' })
    await expect(sync(b, raffleId)).rejects.toMatchObject({ kind: 'gone' })
    expect((await b.store.db.raffles.get(raffleId)).remote.status).toBe('deleted')
    expect(await sync(b, raffleId)).toEqual({ skipped: 'deleted' })
    await expect(b.store.assignNumbers(raffleId, [5], { name: 'X' })).rejects.toThrow('se borró de la nube')

    const copy = await b.store.saveLocalCopy(raffleId)
    expect((await b.store.db.raffles.get(copy.raffleId)).remote).toBeNull()
    expect(await numbersOf(b, copy.raffleId)).toEqual([3, 4])
    await deleteCloudRaffle(raffleId, b.transport, { store: b.store })
    expect(await b.store.db.raffles.get(raffleId)).toBeUndefined()
    expect(await outbox(b.store, raffleId)).toEqual([])
  })

  it('403: sin acceso, queda marcada como revocada', async () => {
    const { server, b, raffleId } = await sharedRaffle()
    server.removeMember(raffleId, b.user)
    await expect(sync(b, raffleId)).rejects.toMatchObject({ kind: 'forbidden' })
    expect((await b.store.db.raffles.get(raffleId)).remote.status).toBe('revoked')
  })

  it('5xx: el outbox queda y se reintenta después', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [1], { name: 'Juan' })
    a.transport.failNext('server')
    await expect(sync(a, raffleId)).rejects.toMatchObject({ kind: 'server' })
    expect(await outbox(a.store, raffleId)).toHaveLength(1)
    await sync(a, raffleId)
    expect(await outbox(a.store, raffleId)).toEqual([])
  })
})

describe('borrar o salir de una rifa en la nube', () => {
  it('quien vende sale de la rifa; quien organiza la borra para todos', async () => {
    const { server, a, b, raffleId } = await sharedRaffle()
    await deleteCloudRaffle(raffleId, b.transport, { store: b.store })
    expect(await b.store.db.raffles.get(raffleId)).toBeUndefined()
    expect(server.inspect(raffleId).raffle.deleted).toBe(false)
    await expect(b.transport.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden' })

    await deleteCloudRaffle(raffleId, a.transport, { store: a.store })
    expect(server.inspect(raffleId).raffle.deleted).toBe(true)
  })

  it('sin conexión no la borra y lo explica', async () => {
    const { a, raffleId } = await sharedRaffle()
    a.transport.setOnline(false)
    await expect(deleteCloudRaffle(raffleId, a.transport, { store: a.store })).rejects.toThrow('Para borrar la rifa necesitás conexión')
    expect(await a.store.db.raffles.get(raffleId)).toBeTruthy()
  })

  it('downloadRaffle la trae completa a un teléfono nuevo', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [10, 11], { name: 'Juan' })
    await sync(a, raffleId)
    const caro = server.createUser('Caro')
    server.addMember(raffleId, caro, 'viewer')
    const phone = { store: device('caro'), transport: server.transportFor(caro) }
    await downloadRaffle(raffleId, phone.transport, { store: phone.store })
    expect(await numbersOf(phone, raffleId)).toEqual([10, 11])
    expect((await phone.store.db.raffles.get(raffleId)).remote.role).toBe('viewer')
    expect((await phone.store.db.settings.get('activeRaffle')).value).toBe(raffleId)
    await expect(phone.store.assignNumbers(raffleId, [1], { name: 'X' })).rejects.toThrow('Sólo podés ver')
  })
})
