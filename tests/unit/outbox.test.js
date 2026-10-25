import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { device, outbox, receipt, tickets } from './syncHelpers.js'

const ana = { name: 'Ana Pérez', phone: '221 555 1234', email: 'ana@mail.com' }

/** Teléfono con una rifa en la nube (de quien organiza) y la rifa local que trae la instalación. */
let store
let cloud
let local
let transport

beforeEach(async () => {
  const server = createFakeServer()
  const user = server.createUser('Facu')
  transport = server.transportFor(user)
  store = device()
  await store.db.open()
  local = (await store.db.settings.get('activeRaffle')).value
  await store.db.settings.put({ key: 'auth', value: { token: 't', user: { id: user.id, name: 'Facu', email: 'f@x.com' } } })
  cloud = await store.createCloudRaffle({ title: 'Nube' }, transport)
})

const ops = (raffleId = cloud) => outbox(store, raffleId)
const only = async (raffleId = cloud) => {
  const rows = await ops(raffleId)
  expect(rows).toHaveLength(1)
  return rows[0]
}
const clearOutbox = () => store.db.outbox.clear()

describe('rifas en la nube: cada escritura deja su operación', () => {
  it('la rifa creada en la nube queda con remote y sin operaciones', async () => {
    const row = await store.db.raffles.get(cloud)
    expect(row.remote).toMatchObject({ role: 'owner', status: 'active', ranges: null, syncedVersion: expect.any(Number) })
    expect(row.config.title).toBe('Nube')
    expect(await ops()).toEqual([])
    expect((await store.db.settings.get('activeRaffle')).value).toBe(cloud)
  })

  it('assignNumbers → numbers.assign con la venta, el seq provisorio y la persona nueva', async () => {
    const saleId = await store.assignNumbers(cloud, [7, 8], { ...ana, referrer: 'Manu' }, { amount: 7000 })
    const op = await only()
    const [person] = await store.db.people.where('raffleId').equals(cloud).toArray()
    expect(op).toMatchObject({ type: 'numbers.assign', raffleId: cloud, attempts: 0, error: null })
    expect(op.opId).toMatch(/^[0-9a-f-]{36}$/)
    expect(op.payload).toEqual({
      saleId,
      seq: 1,
      numbers: [7, 8],
      person: { id: person.id, name: 'Ana Pérez', phone: '221 555 1234', email: 'ana@mail.com', referrer: 'Manu' },
      amount: 7000,
      createdAt: expect.any(Number),
    })
    // La venta guarda quién la hizo.
    expect((await store.db.sales.get(saleId)).createdBy).toEqual({ id: expect.any(Number), name: 'Facu' })
  })

  it('con una persona existente manda su id, y el seq provisorio es el último local + 1', async () => {
    await store.assignNumbers(cloud, [1], ana)
    await store.db.raffles.update(cloud, { lastSeq: 41 })
    await clearOutbox()
    await store.assignNumbers(cloud, [2], { name: 'ana perez' })
    const op = await only()
    const [person] = await store.db.people.where('raffleId').equals(cloud).toArray()
    expect(op.payload.person).toEqual({ id: person.id, name: 'ana perez', phone: '', email: '', referrer: '' })
    expect(op.payload.seq).toBe(42)
    expect(op.payload.amount).toBeNull()
  })

  it('con comprobante agrega receipt.set y deja el archivo en la cola de subida', async () => {
    const saleId = await store.assignNumbers(cloud, [3], ana, { receipt: receipt() })
    const rows = await ops()
    expect(rows.map((r) => r.type)).toEqual(['numbers.assign', 'receipt.set'])
    expect(rows[1].payload).toEqual({ saleId, meta: { name: 'pago.pdf', type: 'application/pdf', size: 3, thumb: null, addedAt: 1000 } })
    expect(await store.db.uploads.toArray()).toEqual([{ saleId, raffleId: cloud, addedAt: 1000, createdAt: expect.any(Number) }])
  })

  it('releaseNumber → sólo number.release, aunque se borren la venta y la persona', async () => {
    await store.assignNumbers(cloud, [10], ana, { receipt: receipt() })
    await clearOutbox()
    await store.releaseNumber(cloud, 10)
    const op = await only()
    expect(op.type).toBe('number.release')
    expect(op.payload).toEqual({ number: 10 })
    expect(await store.db.sales.count()).toBe(0)
    expect(await store.db.uploads.count()).toBe(0)
    // Liberar uno libre no hace nada.
    await clearOutbox()
    await store.releaseNumber(cloud, 99)
    expect(await ops()).toEqual([])
  })

  it('transferNumber → number.transfer con la persona nueva', async () => {
    await store.assignNumbers(cloud, [5, 6], ana)
    await clearOutbox()
    await store.transferNumber(cloud, 5, { name: 'Beto', phone: '9' })
    const op = await only()
    const beto = await store.db.people.where('[raffleId+key]').equals([cloud, 'beto']).first()
    expect(op.type).toBe('number.transfer')
    expect(op.payload).toEqual({ number: 5, person: { id: beto.id, name: 'Beto', phone: '9', email: '', referrer: '' } })
  })

  it('pasar un número a quien ya lo tiene sin cambiar nada no genera operación', async () => {
    await store.assignNumbers(cloud, [5], ana)
    await clearOutbox()
    await store.transferNumber(cloud, 5, { name: 'Ana Perez' })
    expect(await ops()).toEqual([])
  })

  it('voidPurchase → sale.void', async () => {
    const saleId = await store.assignNumbers(cloud, [1, 2], ana)
    await clearOutbox()
    await store.voidPurchase(saleId)
    const op = await only()
    expect(op.type).toBe('sale.void')
    expect(op.payload).toEqual({ saleId })
  })

  it('setPurchaseAmount → sale.setAmount (null si es igual al calculado)', async () => {
    const saleId = await store.assignNumbers(cloud, [1], ana)
    await clearOutbox()
    await store.setPurchaseAmount(saleId, 1234)
    await store.setPurchaseAmount(saleId, 5000)
    const rows = await ops()
    expect(rows.map((r) => [r.type, r.payload])).toEqual([
      ['sale.setAmount', { saleId, amount: 1234 }],
      ['sale.setAmount', { saleId, amount: null }],
    ])
  })

  it('setReceipt y removeReceipt → receipt.set / receipt.remove, con su cola de subida', async () => {
    const saleId = await store.assignNumbers(cloud, [1], ana)
    await clearOutbox()
    await store.setReceipt(saleId, receipt('nuevo', 2000))
    let op = await only()
    expect(op.type).toBe('receipt.set')
    expect(op.payload).toEqual({ saleId, meta: { name: 'pago.pdf', type: 'application/pdf', size: 5, thumb: null, addedAt: 2000 } })
    expect(await store.db.uploads.get(saleId)).toMatchObject({ addedAt: 2000 })

    await clearOutbox()
    await store.removeReceipt(saleId)
    op = await only()
    expect(op.type).toBe('receipt.remove')
    expect(op.payload).toEqual({ saleId })
    expect(await store.db.uploads.count()).toBe(0)
  })

  it('un comprobante sin fecha ni tamaño los completa, para reconocerlo al volver del servidor', async () => {
    const saleId = await store.assignNumbers(cloud, [1], ana)
    await store.setReceipt(saleId, { name: 'a.pdf', type: 'application/pdf', blob: new Blob(['abcd']), thumb: null })
    const saved = await store.db.receipts.get(saleId)
    expect(saved.addedAt).toEqual(expect.any(Number))
    expect(saved.size).toBe(4)
  })

  it('updateParticipant → person.update (también cuando unifica)', async () => {
    await store.assignNumbers(cloud, [1], ana)
    await store.assignNumbers(cloud, [2], { name: 'Beto' })
    const beto = await store.db.people.where('[raffleId+key]').equals([cloud, 'beto']).first()
    await clearOutbox()
    await store.updateParticipant(beto.id, { name: 'Roberto', phone: '1' })
    await store.updateParticipant(beto.id, { name: 'ANA PEREZ' })
    const rows = await ops()
    expect(rows.map((r) => [r.type, r.payload])).toEqual([
      ['person.update', { personId: beto.id, data: { name: 'Roberto', phone: '1', email: '', referrer: '' } }],
      ['person.update', { personId: beto.id, data: { name: 'ANA PEREZ', phone: '', email: '', referrer: '' } }],
    ])
  })

  it('saveConfig y saveSharePrefs → raffle.updateConfig / raffle.updateShare normalizados', async () => {
    await store.saveConfig(cloud, { title: '  Club  ', total: 50 })
    await store.saveSharePrefs(cloud, { palette: 'menta', titleFont: 'nada' })
    const rows = await ops()
    expect(rows.map((r) => r.type)).toEqual(['raffle.updateConfig', 'raffle.updateShare'])
    expect(rows[0].payload.config).toEqual((await store.db.raffles.get(cloud)).config)
    expect(rows[0].payload.config).toMatchObject({ title: 'Club', total: 50 })
    expect(rows[1].payload.share).toEqual((await store.db.raffles.get(cloud)).share)
    expect(rows[1].payload.share.titleFont).not.toBe('nada')
  })

  it('archivar es de este dispositivo: no genera operación', async () => {
    await store.archiveRaffle(cloud)
    expect(await ops()).toEqual([])
  })

  it('quitarla del dispositivo no genera operación y se lleva su outbox, cola y conflictos', async () => {
    await store.assignNumbers(cloud, [1], ana, { receipt: receipt() })
    await store.db.conflicts.add({ raffleId: cloud, opId: 'x', type: 'numbers.assign', reason: 'number_taken', message: 'm', createdAt: 1 })
    await store.removeRaffleLocally(cloud)
    expect(await store.db.outbox.count()).toBe(0)
    expect(await store.db.uploads.count()).toBe(0)
    expect(await store.db.conflicts.count()).toBe(0)
    expect(await store.db.raffles.get(cloud)).toBeUndefined()
  })
})

describe('rifas locales: nunca generan operaciones', () => {
  it('ninguna escritura agrega filas al outbox ni a la cola de subida', async () => {
    await clearOutbox()
    const saleId = await store.assignNumbers(local, [1, 2, 3], ana, { receipt: receipt() })
    await store.assignNumbers(local, [4], { name: 'Beto' })
    await store.setPurchaseAmount(saleId, 100)
    await store.setReceipt(saleId, receipt('otro'))
    await store.removeReceipt(saleId)
    await store.transferNumber(local, 1, { name: 'Caro' })
    await store.releaseNumber(local, 2)
    const beto = await store.db.people.where('[raffleId+key]').equals([local, 'beto']).first()
    await store.updateParticipant(beto.id, { name: 'Roberto' })
    await store.saveConfig(local, { total: 40 })
    await store.saveSharePrefs(local, { palette: 'menta' })
    await store.archiveRaffle(local)
    await store.voidPurchase(saleId)
    expect(await store.db.outbox.count()).toBe(0)
    expect(await store.db.uploads.count()).toBe(0)
    expect((await store.db.raffles.get(local)).remote).toBeNull()
    // Las ventas locales no llevan createdBy.
    const [sale] = await store.db.sales.where('raffleId').equals(local).toArray()
    expect(sale).not.toHaveProperty('createdBy')
  })

  it('restaurar un respaldo (aunque sea de una rifa en la nube) crea una rifa local', async () => {
    await store.assignNumbers(cloud, [7], ana)
    const { raffleId } = await store.importBackup(await store.exportBackup(cloud))
    expect((await store.db.raffles.get(raffleId)).remote).toBeNull()
    await store.assignNumbers(raffleId, [8], ana)
    expect(await ops(raffleId)).toEqual([])
  })

  it('guardar una copia local: ids nuevos, sin remote y sin los archivos que nunca se bajaron', async () => {
    const saleId = await store.assignNumbers(cloud, [7], ana, { receipt: receipt() })
    const other = await store.assignNumbers(cloud, [8], { name: 'Beto' })
    await store.db.receipts.put({ purchaseId: other, raffleId: cloud, name: 'r.jpg', type: 'image/jpeg', size: 9, thumb: null, addedAt: 1, remote: true, hasFile: true })
    const copy = await store.saveLocalCopy(cloud, { title: 'Copia' })
    expect(copy).toMatchObject({ title: 'Copia', tickets: 2, participants: 2, receipts: 1, missingFiles: 1 })
    const row = await store.db.raffles.get(copy.raffleId)
    expect(row.remote).toBeNull()
    expect((await tickets(store, copy.raffleId)).map((t) => t.number)).toEqual([7, 8])
    expect(await store.db.sales.get(saleId)).toMatchObject({ raffleId: cloud })
    expect((await store.db.sales.where('raffleId').equals(copy.raffleId).toArray()).some((s) => s.id === saleId)).toBe(false)
    expect(await ops(copy.raffleId)).toEqual([])
  })
})

describe('atomicidad', () => {
  it('si la escritura falla no queda la operación', async () => {
    await store.assignNumbers(cloud, [5], ana)
    await clearOutbox()
    await expect(store.assignNumbers(cloud, [4, 5], { name: 'Beto' })).rejects.toThrow('Ya están tomados: 5')
    await expect(store.saveConfig(cloud, { total: 3 })).rejects.toThrow('el número 5 está tomado')
    await expect(store.transferNumber(cloud, 9, { name: 'Beto' })).rejects.toThrow('no está tomado')
    await expect(store.updateParticipant('no-existe', { name: 'X' })).rejects.toThrow('ya no existe')
    expect(await ops()).toEqual([])
  })

  it('si falla un paso posterior a encolar, se deshace todo: el cambio y la operación', async () => {
    vi.spyOn(store.db.uploads, 'put').mockRejectedValue(new Error('disco lleno'))
    await expect(store.assignNumbers(cloud, [1], ana, { receipt: receipt() })).rejects.toThrow('disco lleno')
    expect(await ops()).toEqual([])
    expect(await tickets(store, cloud)).toEqual([])
    expect(await store.db.sales.count()).toBe(0)
    expect(await store.db.receipts.count()).toBe(0)
  })
})

describe('lo que el servidor rechazaría seguro se avisa antes', () => {
  const setRemote = (patch) => store.db.raffles.where('id').equals(cloud).modify((r) => Object.assign(r.remote, patch))

  it('quien sólo mira no puede hacer cambios', async () => {
    await setRemote({ role: 'viewer' })
    await expect(store.assignNumbers(cloud, [1], ana)).rejects.toThrow('Sólo podés ver esta rifa')
    expect(await ops()).toEqual([])
  })

  it('quien vende no puede salir de su talonario ni cambiar la configuración', async () => {
    await setRemote({ role: 'seller', ranges: [[1, 10]] })
    await expect(store.assignNumbers(cloud, [9, 11, 12], ana)).rejects.toThrow('Los números 11, 12 están fuera de tu talonario')
    await expect(store.saveConfig(cloud, { total: 50 })).rejects.toThrow('Sólo quien organiza')
    await store.assignNumbers(cloud, [9], ana)
    expect((await ops()).map((o) => o.type)).toEqual(['numbers.assign'])
  })

  it('una rifa borrada de la nube o sin acceso ya no se modifica', async () => {
    await setRemote({ status: 'deleted' })
    await expect(store.assignNumbers(cloud, [1], ana)).rejects.toThrow('se borró de la nube')
    await setRemote({ status: 'revoked' })
    await expect(store.saveSharePrefs(cloud, {})).rejects.toThrow('Ya no tenés acceso')
  })
})

describe('createCloudRaffle', () => {
  it('sin conexión explica que hace falta conexión y no crea nada', async () => {
    transport.setOnline(false)
    const before = await store.db.raffles.count()
    await expect(store.createCloudRaffle({ title: 'Otra' }, transport)).rejects.toThrow(
      'Para crear una rifa en la nube necesitás conexión a internet',
    )
    expect(await store.db.raffles.count()).toBe(before)
  })

  it('sin sesión pide iniciar sesión', async () => {
    await expect(store.createCloudRaffle({ title: 'Otra' }, null)).rejects.toThrow('Iniciá sesión')
  })

  it('copia configuración e imagen de otra rifa, como createRaffle', async () => {
    await store.saveConfig(local, { title: 'Base', total: 80, prizes: ['Bici'] })
    const id = await store.createCloudRaffle({ title: 'Club 2', copyFrom: local }, transport)
    expect((await store.db.raffles.get(id)).config).toMatchObject({ title: 'Club 2', total: 80, prizes: ['Bici'] })
  })
})
