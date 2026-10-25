import { describe, expect, it } from 'vitest'
import { syncRaffle } from '../../src/sync/engine.js'
import { device, ofRaffle, outbox, receipt, sharedRaffle, tickets } from './syncHelpers.js'

async function backup() {
  const source = device('respaldo')
  const id = await source.ensureRaffle()
  await source.assignNumbers(id, [5, 8], { name: 'Ana', phone: '123', referrer: 'Club' }, { amount: 7100, receipt: receipt() })
  await source.transferNumber(id, 8, { name: 'Beto' })
  return source.exportBackup(id)
}

const sync = (phone, id) => syncRaffle(id, phone.transport, { store: phone.store })

describe('respaldo en una rifa en la nube', () => {
  it('el creador carga los datos y los adjuntos en la misma rifa y llegan a otro teléfono', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    const data = await backup()
    const count = await a.store.db.raffles.count()
    expect(await a.store.importCloudBackup(raffleId, data)).toEqual({ tickets: 2, participants: 2, receipts: 1 })
    expect(await a.store.db.raffles.count()).toBe(count)
    const [op] = await outbox(a.store, raffleId)
    expect(op.type).toBe('raffle.importBackup')
    expect(op.payload.people.map((p) => p.id)).not.toContain(data.participants[0].id)
    expect(op.keys).toContain(`receipt:${op.payload.receipts[0].saleId}`)
    const result = await sync(a, raffleId)
    expect(result.rejected).toBe(0)
    await sync(b, raffleId)
    expect((await tickets(b.store, raffleId)).map((n) => n.number)).toEqual([5, 8])
    const people = await ofRaffle(b.store.db.people, raffleId)
    const owner = new Map(people.map((p) => [p.id, p.name]))
    expect((await tickets(b.store, raffleId)).map((n) => owner.get(n.participantId))).toEqual(['Ana', 'Beto'])
    const [sale] = await ofRaffle(b.store.db.sales, raffleId)
    expect(sale).toMatchObject({ amount: 7100, createdBy: { id: a.user.id }, seq: 1 })
    expect((await ofRaffle(b.store.db.receipts, raffleId))[0]).toMatchObject({ name: 'pago.pdf', hasFile: true })
    expect(await a.store.db.uploads.count()).toBe(0)
  })

  it('rechaza vendedores, observadores, otras cuentas y rifas sin acceso', async () => {
    const data = await backup()
    for (const role of ['seller', 'viewer']) {
      const { b, raffleId } = await sharedRaffle({ sellerRole: role })
      await expect(b.store.importCloudBackup(raffleId, data)).rejects.toThrow(role === 'viewer' ? 'Sólo podés ver' : 'Sólo quien organiza')
      expect(await outbox(b.store, raffleId)).toEqual([])
    }
    const { a, raffleId } = await sharedRaffle()
    await a.store.db.settings.put({ key: 'auth', value: { token: 'otro', user: { id: 999 } } })
    await expect(a.store.importCloudBackup(raffleId, data)).rejects.toThrow('otra cuenta')
    await a.store.db.settings.delete('auth')
    await a.store.db.raffles.update(raffleId, { 'remote.status': 'revoked' })
    await expect(a.store.importCloudBackup(raffleId, data)).rejects.toThrow('no tenés acceso')
  })

  it('valida antes de modificar y no permite cargar sobre una rifa con ventas', async () => {
    const { a, raffleId } = await sharedRaffle()
    await expect(a.store.importCloudBackup(raffleId, { app: 'otra' })).rejects.toThrow('Respaldo inválido')
    expect(await outbox(a.store, raffleId)).toEqual([])
    await a.store.assignNumbers(raffleId, [1], { name: 'Existente' })
    await expect(a.store.importCloudBackup(raffleId, await backup())).rejects.toThrow('todavía esté vacía')
    expect((await tickets(a.store, raffleId)).map((n) => n.number)).toEqual([1])
  })

  it('si otro teléfono vendió primero, rechaza toda la importación y conserva esa venta', async () => {
    const { a, b, raffleId } = await sharedRaffle()
    await b.store.assignNumbers(raffleId, [9], { name: 'Venta real' })
    await sync(b, raffleId)
    await a.store.importCloudBackup(raffleId, await backup())
    expect((await sync(a, raffleId)).rejected).toBe(1)
    expect((await tickets(a.store, raffleId)).map((n) => n.number)).toEqual([9])
    expect((await a.store.db.conflicts.toArray())[0]).toMatchObject({ reason: 'raffle_not_empty' })
    expect(await a.store.db.uploads.count()).toBe(0)
    expect(await a.store.db.receipts.count()).toBe(0)
  })

  it('un reintento después de perder la respuesta no duplica las ventas', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.importCloudBackup(raffleId, await backup())
    const ops = await outbox(a.store, raffleId)
    const first = await a.transport.pushOps(raffleId, ops)
    expect(first.results[0].status).toBe('accepted')
    expect(await a.transport.pushOps(raffleId, ops)).toEqual(first)
    await sync(a, raffleId)
    expect(await ofRaffle(a.store.db.sales, raffleId)).toHaveLength(1)
  })
})
