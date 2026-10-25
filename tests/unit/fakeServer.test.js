import { beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../../src/lib/ids.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'

let server
let owner
let seller
let viewer
let raffleId

const person = (name, extra = {}) => ({ id: newId(), name, phone: '', email: '', referrer: '', ...extra })
const op = (type, payload) => ({ opId: newId(), type, payload, createdAt: Date.now() })
const assign = (numbers, who = person('Ana'), extra = {}) =>
  op('numbers.assign', { saleId: newId(), seq: 999, numbers, person: who, amount: null, createdAt: 1, ...extra })

/** Envía operaciones como una persona y devuelve los resultados. */
async function push(user, ...ops) {
  const { results } = await server.transportFor(user).pushOps(raffleId, ops)
  return results
}

beforeEach(async () => {
  server = createFakeServer()
  const users = ['Facu', 'Juan', 'Mirta'].map((name) => server.createUser(name))
  ;[owner, seller, viewer] = users
  const snapshot = await server.transportFor(owner).createRaffle({ config: { title: 'Club', total: 100 }, share: {} })
  raffleId = snapshot.raffle.id
  server.addMember(raffleId, seller, 'seller')
  server.addMember(raffleId, viewer, 'viewer')
})

const state = () => server.inspect(raffleId)

describe('crear y leer', () => {
  it('el servidor genera el id y devuelve el snapshot con el rol', async () => {
    const snap = await server.transportFor(owner).getSnapshot(raffleId)
    expect(snap).toMatchObject({ raffle: { id: raffleId, lastSeq: 0, ownerId: owner.id, deleted: false }, role: 'owner', ranges: null })
    expect(snap.raffle.config).toMatchObject({ title: 'Club', total: 100 })
    expect(snap.version).toBeGreaterThan(0)
  })

  it('listRaffles muestra las rifas con acceso y el rol de cada uno', async () => {
    const list = await server.transportFor(seller).listRaffles()
    expect(list).toEqual([{ id: raffleId, title: 'Club', role: 'seller', archivedAt: null, ownerName: 'Facu', version: expect.any(Number), deleted: false }])
    expect(await server.transportFor(server.createUser('Nadie')).listRaffles()).toEqual([])
  })
})

describe('numbers.assign', () => {
  it('el seq lo asigna el servidor (ignora el del cliente) y guarda quién vendió', async () => {
    const [first] = await push(seller, assign([1, 2]))
    const [second] = await push(owner, assign([3], person('Beto')))
    expect(first).toMatchObject({ status: 'accepted', result: { seq: 1, participantId: expect.any(String) } })
    expect(second.result.seq).toBe(2)
    const { sales, numbers, raffle } = state()
    expect(raffle.lastSeq).toBe(2)
    expect(sales.find((s) => s.seq === 1).createdBy).toEqual({ id: seller.id, name: 'Juan' })
    expect(numbers.map((n) => n.number)).toEqual([1, 2, 3])
  })

  it('rechaza números vendidos, fuera del total o fuera del talonario, sin aplicar nada', async () => {
    server.setMember(raffleId, seller, { ranges: [[1, 10]] })
    await push(owner, assign([7]))
    const results = await push(seller, assign([6, 7]), assign([101]), assign([10, 11]), assign([5], person('  ')))
    expect(results.map((r) => r.reason)).toEqual(['number_taken', 'out_of_range', 'outside_ranges', 'invalid'])
    expect(results[0].message).toBe('El número 7 ya lo había vendido Facu a Ana desde otro teléfono')
    expect(results[1].message).toMatch(/El número 101 no existe/)
    expect(results[2].message).toBe('El número 11 está fuera de tu talonario')
    expect(results[3].message).toBe('El nombre es obligatorio')
    expect(state().numbers.map((n) => n.number)).toEqual([7])
    expect(state().raffle.lastSeq).toBe(1)
  })

  it('reutiliza a la persona por nombre, completa contactos y registra el alias', async () => {
    const first = person('Ana Pérez', { phone: '1' })
    const again = person('ana perez', { email: 'a@b.c' })
    await push(owner, assign([1], first))
    const [res] = await push(seller, assign([2], again))
    expect(res.result.participantId).toBe(first.id)
    const { people, aliases } = state()
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ id: first.id, name: 'Ana Pérez', phone: '1', email: 'a@b.c' })
    expect(aliases).toEqual([{ entity: 'person', from: again.id, to: first.id }])
  })

  it('con varios números vendidos dice a quién se vendió cada uno', async () => {
    await push(owner, assign([7]), assign([8], person('Beto')))
    const [res] = await push(seller, assign([6, 7, 8]))
    expect(res.message).toBe('Los números 7 y 8 ya estaban vendidos desde otro teléfono (el 7 a Ana y el 8 a Beto)')
  })

  it('el talonario sólo limita a quien vende', async () => {
    server.setMember(raffleId, owner, { ranges: [[1, 5]] })
    const [res] = await push(owner, assign([50]))
    expect(res.status).toBe('accepted')
  })

  it('a una persona existente sólo se le completan los datos vacíos', async () => {
    const first = person('Ana', { phone: '1' })
    await push(owner, assign([1], first))
    await push(owner, assign([2], person('ana', { phone: '2', email: 'a@b.c' })))
    expect(state().people[0]).toMatchObject({ phone: '1', email: 'a@b.c' })
  })

  it('si el id es de una persona viva renombrada en otro teléfono, se usa esa persona (sin alias)', async () => {
    const ana = person('Ana')
    await push(owner, assign([1], ana))
    await push(owner, op('person.update', { personId: ana.id, data: { name: 'Anita', phone: '', email: '', referrer: '' } }))
    const [res] = await push(seller, assign([2], { ...ana, phone: '5' }))
    expect(res.result.participantId).toBe(ana.id)
    expect(state().people).toEqual([expect.objectContaining({ id: ana.id, name: 'Anita', phone: '5' })])
    expect(state().aliases).toEqual([])
  })

  it('una persona borrada se reactiva con su id; ids de venta repetidos o personas de otra rifa son inválidos', async () => {
    const ana = person('Ana')
    const sale = assign([1], ana)
    await push(owner, sale, op('number.release', { number: 1 }))
    expect(state().people).toEqual([])
    const [back] = await push(owner, assign([2], { ...ana, name: 'Ana María' }))
    expect(back.result.participantId).toBe(ana.id)
    expect(state().people[0].name).toBe('Ana María')

    const [repeated] = await push(owner, assign([3], person('Beto'), { saleId: sale.payload.saleId }))
    expect(repeated).toMatchObject({ status: 'rejected', reason: 'invalid' })
    const other = await server.transportFor(owner).createRaffle({ config: { title: 'Otra' }, share: {} })
    const { results } = await server.transportFor(owner).pushOps(other.raffle.id, [assign([1], ana)])
    expect(results[0]).toMatchObject({ status: 'rejected', reason: 'invalid' })
  })

  it('un número liberado y vuelto a vender reactiva su fila', async () => {
    await push(owner, assign([4]))
    await push(owner, op('number.release', { number: 4 }))
    const before = server.version
    await push(owner, assign([4], person('Beto')))
    const changes = await server.transportFor(owner).pullChanges(raffleId, before)
    expect(changes.numbers).toEqual([expect.objectContaining({ number: 4, deleted: false })])
  })
})

describe('idempotencia y lotes', () => {
  it('reenviar el mismo opId devuelve el mismo resultado sin aplicarla de nuevo', async () => {
    const sale = assign([1])
    const [first] = await push(owner, sale)
    const [again] = await push(owner, sale)
    expect(again).toEqual(first)
    expect(state().sales).toHaveLength(1)
    expect(server.operationCount).toBe(1)
  })

  it('un opId usado en otra rifa o por otra cuenta se rechaza (y no se guarda)', async () => {
    const sale = assign([1])
    await push(owner, sale)
    const [again] = await push(seller, sale)
    expect(again).toMatchObject({ status: 'rejected', reason: 'invalid' })
    expect(server.operationCount).toBe(1)
  })

  it('una versión por operación; una aceptada sin efecto no consume versión', async () => {
    const before = server.version
    await push(owner, assign([1, 2, 3]))
    expect(server.version).toBe(before + 1)
    const changes = await server.transportFor(owner).pullChanges(raffleId, before)
    expect(changes.version).toBe(before + 1)
    expect(changes.numbers).toHaveLength(3)
    expect(await server.transportFor(owner).pullChanges(raffleId, before + 1)).toMatchObject({ numbers: [], sales: [], people: [] })
    await push(owner, op('number.release', { number: 50 }))
    expect(server.version).toBe(before + 1)
  })

  it('un rechazo no corta el lote y se aplica en orden', async () => {
    const results = await push(owner, assign([1]), assign([1]), assign([2]))
    expect(results.map((r) => r.status)).toEqual(['accepted', 'rejected', 'accepted'])
  })

  it('no acepta más de 100 operaciones por lote', async () => {
    const ops = Array.from({ length: 101 }, () => op('number.release', { number: 1 }))
    await expect(server.transportFor(owner).pushOps(raffleId, ops)).rejects.toMatchObject({ kind: 'client' })
  })

  it('tipos desconocidos y quien sólo mira se rechazan', async () => {
    const [unknown] = await push(owner, op('raffle.explode', {}))
    expect(unknown).toMatchObject({ status: 'rejected', reason: 'unknown_type' })
    const [forbidden] = await push(viewer, assign([1]))
    expect(forbidden).toMatchObject({ status: 'rejected', reason: 'forbidden' })
  })
})

describe('bajas en cascada', () => {
  it('liberar el último número borra la venta, su comprobante y la persona huérfana', async () => {
    const sale = assign([9])
    await push(owner, sale, op('receipt.set', { saleId: sale.payload.saleId, meta: { name: 'a.pdf', type: 'application/pdf', size: 3, thumb: null, addedAt: 5 } }))
    const before = server.version
    const [res] = await push(owner, op('number.release', { number: 9 }))
    expect(res.status).toBe('accepted')
    const changes = await server.transportFor(owner).pullChanges(raffleId, before)
    expect(changes.numbers).toEqual([expect.objectContaining({ number: 9, deleted: true })])
    expect(changes.sales).toEqual([expect.objectContaining({ id: sale.payload.saleId, deleted: true })])
    expect(changes.receipts).toEqual([expect.objectContaining({ saleId: sale.payload.saleId, deleted: true })])
    expect(changes.people).toEqual([expect.objectContaining({ id: sale.payload.person.id, deleted: true })])
    // Liberar uno libre: aceptado sin cambios.
    const [free] = await push(owner, op('number.release', { number: 9 }))
    expect(free.status).toBe('accepted')
  })

  it('sale.void: quien vende sólo anula sus ventas; si ya no existe, se acepta', async () => {
    const mine = assign([1])
    const theirs = assign([2], person('Beto'))
    await push(seller, mine)
    await push(owner, theirs)
    const [notYours, ok] = await push(seller, op('sale.void', { saleId: theirs.payload.saleId }), op('sale.void', { saleId: mine.payload.saleId }))
    expect(notYours).toMatchObject({ status: 'rejected', reason: 'not_yours' })
    expect(ok.status).toBe('accepted')
    expect(state().numbers.map((n) => n.number)).toEqual([2])
    const [gone] = await push(owner, op('sale.void', { saleId: mine.payload.saleId }))
    expect(gone.status).toBe('accepted')
  })

  it('transfer: el pago queda en la venta original y la persona anterior huérfana se borra', async () => {
    const sale = assign([3])
    await push(owner, sale, assign([4], person('Caro')))
    const beto = person('Beto')
    await push(owner, op('number.transfer', { number: 3, person: beto }))
    const { numbers, people, sales } = state()
    expect(numbers.find((n) => n.number === 3)).toMatchObject({ participantId: beto.id, saleId: sale.payload.saleId })
    // Ana sigue: pagó la venta.
    expect(people.map((p) => p.name).sort()).toEqual(['Ana', 'Beto', 'Caro'])
    expect(sales).toHaveLength(2)
    const [notTaken] = await push(owner, op('number.transfer', { number: 50, person: beto }))
    expect(notTaken).toMatchObject({ reason: 'number_not_taken' })
  })
})

describe('personas, montos y configuración', () => {
  it('person.update que coincide con otra persona las unifica y registra el alias', async () => {
    const ana = person('Ana', { phone: '' })
    const beto = person('Beto', { phone: '9', email: 'b@b.b' })
    await push(owner, assign([1], ana), assign([2], beto))
    const [res] = await push(owner, op('person.update', { personId: beto.id, data: { name: 'ANA', phone: '9', email: 'b@b.b', referrer: '' } }))
    expect(res.result).toEqual({ personId: ana.id })
    const { people, numbers, aliases } = state()
    expect(people).toEqual([expect.objectContaining({ id: ana.id, phone: '9', email: 'b@b.b' })])
    expect(numbers.every((n) => n.participantId === ana.id)).toBe(true)
    expect(aliases).toContainEqual({ entity: 'person', from: beto.id, to: ana.id })
    // Una operación vieja que se refiere a Beto se resuelve por el alias.
    const [later] = await push(owner, op('person.update', { personId: beto.id, data: { name: 'Ana', phone: '7', email: '', referrer: '' } }))
    expect(later).toMatchObject({ status: 'accepted', result: { personId: ana.id } })
    expect(state().people[0].phone).toBe('7')
  })

  it('person.update y sale.setAmount sobre algo que ya no existe se rechazan', async () => {
    const results = await push(owner, op('person.update', { personId: newId(), data: { name: 'X' } }), op('sale.setAmount', { saleId: newId(), amount: 5 }))
    expect(results.map((r) => r.reason)).toEqual(['person_not_found', 'sale_not_found'])
  })

  it('updateConfig: sólo quien organiza, y no por debajo de un número vendido', async () => {
    await push(owner, assign([80]))
    const [low, sellerTry, invalid, ok] = [
      ...(await push(owner, op('raffle.updateConfig', { config: { title: 'Club', total: 50 } }))),
      ...(await push(seller, op('raffle.updateConfig', { config: { title: 'Club', total: 90 } }))),
      ...(await push(owner, op('raffle.updateConfig', { config: { total: 0 } }))),
      ...(await push(owner, op('raffle.updateConfig', { config: { title: 'Club', total: 90 } }))),
    ]
    expect(low).toMatchObject({ reason: 'total_below_sold', message: 'No podés bajar el total a 50: el número 80 está vendido' })
    expect(sellerTry).toMatchObject({ reason: 'forbidden' })
    expect(invalid).toMatchObject({ reason: 'invalid' })
    expect(ok.status).toBe('accepted')
    expect(state().raffle.config.total).toBe(90)
  })
})

describe('changes', () => {
  it('trae sólo lo posterior a la versión pedida; la rifa es null si no cambió', async () => {
    await push(owner, assign([1]))
    const since = server.version
    let changes = await server.transportFor(owner).pullChanges(raffleId, since)
    expect(changes).toMatchObject({ raffle: null, people: [], sales: [], numbers: [], receipts: [], aliases: [], role: 'owner', version: since })
    await push(seller, op('sale.setAmount', { saleId: state().sales[0].id, amount: 10 }))
    changes = await server.transportFor(seller).pullChanges(raffleId, since)
    expect(changes.sales).toHaveLength(1)
    expect(changes.raffle).toBeNull()
    expect(changes.role).toBe('seller')
  })
})

describe('comprobantes', () => {
  it('se suben aparte y se bajan con el mismo transporte', async () => {
    const sale = assign([1])
    await push(owner, sale)
    const t = server.transportFor(seller)
    const file = new Blob(['%PDF'], { type: 'application/pdf' })
    const row = await t.uploadReceipt(raffleId, sale.payload.saleId, file, { name: 'p.pdf', thumb: null, addedAt: 3 })
    expect(row).toMatchObject({ saleId: sale.payload.saleId, hasFile: true, size: 4, type: 'application/pdf', deleted: false })
    expect(await (await t.downloadReceipt(raffleId, sale.payload.saleId)).text()).toBe('%PDF')
    await expect(t.uploadReceipt(raffleId, sale.payload.saleId, new Blob(['x'], { type: 'text/plain' }), {})).rejects.toMatchObject({ kind: 'client' })
    await expect(server.transportFor(viewer).uploadReceipt(raffleId, sale.payload.saleId, file, {})).rejects.toMatchObject({ kind: 'forbidden' })
  })
})

describe('errores del transporte', () => {
  it('sin conexión, sesión vencida, sin acceso, rifa inexistente o borrada', async () => {
    const t = server.transportFor(seller)
    t.setOnline(false)
    await expect(t.getSnapshot(raffleId)).rejects.toMatchObject({ name: 'SyncError', kind: 'network' })
    t.setOnline(true)
    t.failNext('server')
    await expect(t.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'server', status: 503 })
    server.expireSessions(seller)
    await expect(t.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'auth', status: 401 })
    server.restoreSessions(seller)
    await expect(t.getSnapshot(newId())).rejects.toMatchObject({ kind: 'gone', status: 404 })
    await expect(server.transportFor(server.createUser('X')).getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden', status: 403 })
    await expect(t.deleteRaffle(raffleId)).rejects.toMatchObject({ kind: 'forbidden' })
    await server.transportFor(owner).deleteRaffle(raffleId)
    await expect(t.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'gone', status: 410 })
    // Quien no es miembro no se entera de que se borró: 403.
    await expect(server.transportFor(server.createUser('Y')).getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden', status: 403 })
  })

  it('salir de una rifa: cualquiera menos quien la organiza', async () => {
    await server.transportFor(seller).leaveRaffle(raffleId)
    await expect(server.transportFor(seller).getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden' })
    await expect(server.transportFor(owner).leaveRaffle(raffleId)).rejects.toMatchObject({ kind: 'client' })
  })

  it('lo que entra y sale se copia, como por la red', async () => {
    const snap = await server.transportFor(owner).getSnapshot(raffleId)
    snap.raffle.config.total = 5
    expect(state().raffle.config.total).toBe(100)
  })
})
