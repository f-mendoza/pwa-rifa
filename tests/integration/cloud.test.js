import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, inject, it } from 'vitest'
import { createStore } from '../../src/db.js'
import { createApiClient } from '../../src/sync/api.js'
import { deleteCloudRaffle, downloadRaffle, fetchReceiptFile, syncRaffle } from '../../src/sync/engine.js'
import { createSession } from '../../src/sync/session.js'
import { SyncError } from '../../src/sync/transport.js'

/**
 * Ciclo completo contra la API real (Laravel, levantada por globalSetup.js) con el transporte HTTP
 * de la app: dos cuentas, dos teléfonos (dos bases Dexie), invitación, ventas del mismo número,
 * push/pull, conflicto, talonario, comprobante subido y bajado, borrar la rifa.
 */
const apiUrl = inject('apiUrl')
const png = readFileSync(resolve(import.meta.dirname, '../../public/pwa-192.png'))

let count = 0
const unique = () => `${Date.now()}-${++count}`

/** Un teléfono: su base, su sesión con la API y el transporte HTTP. */
async function phone(label) {
  const store = createStore(`integracion-${label}-${unique()}`)
  await store.db.open()
  const session = createSession({ store, createClient: (getToken) => createApiClient({ baseUrl: apiUrl, getToken }), deviceName: label })
  await session.ready
  return { store, session, get transport() {
    return session.transport()
  } }
}

const tickets = (store, raffleId) => store.db.numbers.where('raffleId').equals(raffleId).sortBy('number')
const names = async (store, raffleId) => {
  const people = new Map((await store.db.people.where('raffleId').equals(raffleId).toArray()).map((p) => [p.id, p.name]))
  return Object.fromEntries((await tickets(store, raffleId)).map((t) => [t.number, people.get(t.participantId)]))
}

it('el respaldo se importa en la misma rifa y el otro teléfono descarga sus datos y su archivo', async () => {
  const owner = await phone('importador')
  const member = await phone('miembro-importacion')
  const source = createStore(`respaldo-${unique()}`)
  try {
    await owner.session.register({ name: 'Creador', email: `importador-${unique()}@example.com`, password: 'secreto123', passwordConfirmation: 'secreto123' })
    await member.session.register({ name: 'Miembro', email: `miembro-${unique()}@example.com`, password: 'secreto123', passwordConfirmation: 'secreto123' })
    const raffleId = await owner.store.createCloudRaffle({ title: 'Vacía' }, owner.transport)
    const { token } = await owner.session.client.createInvitation(raffleId, { role: 'seller' })
    await member.session.client.acceptInvitation(token)
    await downloadRaffle(raffleId, member.transport, { store: member.store })
    const localId = await source.ensureRaffle()
    const blob = new Blob([png], { type: 'image/png' })
    await source.assignNumbers(localId, [5, 8], { name: 'Ana', referrer: 'Club' }, {
      amount: 7100, receipt: { blob, name: 'pago.png', type: blob.type, size: blob.size, addedAt: 1000, thumb: null },
    })
    await source.transferNumber(localId, 8, { name: 'Beto' })
    const backup = await source.exportBackup(localId)
    await expect(member.store.importCloudBackup(raffleId, backup)).rejects.toThrow('Sólo quien organiza')
    await owner.store.importCloudBackup(raffleId, backup)
    const [op] = await owner.store.db.outbox.where('raffleId').equals(raffleId).toArray()
    expect((await owner.transport.pushOps(raffleId, [op])).results[0].status).toBe('accepted')
    // El ciclo reenvía la misma operación: verifica idempotencia real después de perder una respuesta.
    expect((await syncRaffle(raffleId, owner.transport, { store: owner.store })).rejected).toBe(0)
    await syncRaffle(raffleId, member.transport, { store: member.store })
    expect(await names(member.store, raffleId)).toEqual({ 5: 'Ana', 8: 'Beto' })
    const [sale] = await member.store.db.sales.where('raffleId').equals(raffleId).toArray()
    expect(sale).toMatchObject({ amount: 7100, seq: 1, createdBy: { id: owner.session.user.id } })
    const downloaded = await fetchReceiptFile(raffleId, sale.id, member.transport, { store: member.store })
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(new Uint8Array(png))
    expect((await owner.store.db.raffles.get(raffleId)).remote.role).toBe('owner')
    await expect(owner.store.importCloudBackup(raffleId, backup)).rejects.toThrow('todavía esté vacía')
  } finally {
    await Promise.all([owner.store.db.delete(), member.store.db.delete(), source.db.delete()])
  }
})

describe('integración con la API real', () => {
  let ana
  let beto
  let raffleId
  const anaEmail = `ana-${unique()}@example.com`
  const betoEmail = `beto-${unique()}@example.com`

  beforeAll(async () => {
    ana = await phone('ana')
    beto = await phone('beto')
  })

  it('registro, sesión guardada en settings.auth y errores en castellano', async () => {
    const user = await ana.session.register({ name: 'Ana', email: anaEmail, password: 'secreto123', passwordConfirmation: 'secreto123' })
    expect(user).toMatchObject({ name: 'Ana', email: anaEmail, emailVerifiedAt: null })
    expect((await ana.store.db.settings.get('auth')).value).toMatchObject({ token: expect.stringContaining('|'), user: { id: user.id } })
    expect(await ana.session.client.me()).toMatchObject({ id: user.id })

    await expect(
      beto.session.register({ name: 'Beto', email: anaEmail, password: 'secreto123', passwordConfirmation: 'secreto123' }),
    ).rejects.toThrow('Ya hay una cuenta con ese correo.')
    await expect(beto.session.login({ email: anaEmail, password: 'otra-cosa' })).rejects.toThrow('El correo o la contraseña no son correctos.')
    await beto.session.register({ name: 'Beto', email: betoEmail, password: 'secreto123', passwordConfirmation: 'secreto123' })
    // Iniciar sesión otra vez reemplaza el token.
    await beto.session.logout()
    expect(beto.transport).toBeNull()
    await beto.session.login({ email: betoEmail, password: 'secreto123' })
    expect(beto.session.user.name).toBe('Beto')
    expect((await ana.session.resendVerification()).message).toMatch(/correo/)
    expect((await ana.session.forgotPassword(anaEmail)).message).toMatch(/Si hay una cuenta/)
  })

  it('crear una rifa en la nube: el id lo genera la API', async () => {
    raffleId = await ana.store.createCloudRaffle({ title: 'Club Atenas' }, ana.transport)
    expect(raffleId).toMatch(/^[0-9a-f-]{36}$/)
    const raffle = await ana.store.db.raffles.get(raffleId)
    expect(raffle.config.title).toBe('Club Atenas')
    expect(raffle.remote).toMatchObject({ role: 'owner', userId: ana.session.user.id, status: 'active', syncedVersion: expect.any(Number) })
    const list = await ana.session.client.listRaffles()
    expect(list).toContainEqual(expect.objectContaining({ id: raffleId, title: 'Club Atenas', role: 'owner', ownerName: 'Ana' }))
  })

  it('invitar y aceptar: el otro teléfono descarga el snapshot', async () => {
    const { token, role, expiresAt } = await ana.session.client.createInvitation(raffleId, { role: 'seller' })
    expect(role).toBe('seller')
    expect(expiresAt).toBeGreaterThan(Date.now())
    // Se ve sin sesión.
    const anon = createApiClient({ baseUrl: apiUrl })
    expect(await anon.getInvitation(token)).toEqual({ raffleId, raffleTitle: 'Club Atenas', role: 'seller', invitedBy: 'Ana', expired: false, accepted: false })
    await expect(anon.acceptInvitation(token)).rejects.toMatchObject({ kind: 'auth' })
    expect(await beto.session.client.acceptInvitation(token)).toEqual({ raffleId, role: 'seller' })
    await downloadRaffle(raffleId, beto.transport, { store: beto.store })
    expect((await beto.store.db.raffles.get(raffleId)).remote).toMatchObject({ role: 'seller', userId: beto.session.user.id })
    expect(await anon.getInvitation(token)).toMatchObject({ accepted: true })
    const members = await ana.session.client.listMembers(raffleId)
    expect(members.map((m) => [m.name, m.role])).toEqual([['Ana', 'owner'], ['Beto', 'seller']])
  })

  it('dos teléfonos venden el mismo número sin conexión: gana el primero y el otro ve el conflicto', async () => {
    await ana.store.assignNumbers(raffleId, [7, 8], { name: 'Juan', phone: '221 555 1234' })
    await beto.store.assignNumbers(raffleId, [7], { name: 'Caro' })
    await beto.store.assignNumbers(raffleId, [20], { name: 'Dani' })

    expect(await syncRaffle(raffleId, ana.transport, { store: ana.store })).toMatchObject({ pushed: 1, rejected: 0 })
    const result = await syncRaffle(raffleId, beto.transport, { store: beto.store })
    expect(result).toMatchObject({ pushed: 1, rejected: 1 })

    const conflicts = await beto.store.db.conflicts.where('raffleId').equals(raffleId).toArray()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ type: 'numbers.assign', reason: 'number_taken' })
    expect(conflicts[0].message).toBe('El número 7 ya lo había vendido Ana a Juan desde otro teléfono')
    // Beto quedó reconciliado con el servidor (snapshot): el 7 es de Juan, y su venta del 20 quedó.
    expect(await names(beto.store, raffleId)).toEqual({ 7: 'Juan', 8: 'Juan', 20: 'Dani' })
    expect(await beto.store.db.outbox.count()).toBe(0)

    // Pull incremental en el teléfono de Ana: trae la venta de Beto con su seq definitivo y quién la hizo.
    await syncRaffle(raffleId, ana.transport, { store: ana.store })
    expect(await names(ana.store, raffleId)).toEqual({ 7: 'Juan', 8: 'Juan', 20: 'Dani' })
    const sales = await ana.store.db.sales.where('raffleId').equals(raffleId).sortBy('seq')
    expect(sales.map((s) => [s.seq, s.createdBy?.name])).toEqual([
      [1, 'Ana'],
      [2, 'Beto'],
    ])
  })

  it('push idempotente: reenviar las mismas operaciones no duplica nada', async () => {
    await ana.store.releaseNumber(raffleId, 8)
    const ops = (await ana.store.db.outbox.toArray()).map(({ opId, type, payload, createdAt }) => ({ opId, type, payload, createdAt }))
    const first = await ana.transport.pushOps(raffleId, ops)
    const again = await ana.transport.pushOps(raffleId, ops)
    expect(again.results).toEqual(first.results)
    await syncRaffle(raffleId, ana.transport, { store: ana.store })
    await syncRaffle(raffleId, beto.transport, { store: beto.store })
    expect(await names(beto.store, raffleId)).toEqual({ 7: 'Juan', 20: 'Dani' })
  })

  it('reconcilia tras perder la conexión al snapshot con el outbox ya vacío', async () => {
    const id = await ana.store.createCloudRaffle({ title: 'Recuperación' }, ana.transport)
    const { token } = await ana.transport.createInvitation(id, { role: 'seller' })
    await beto.transport.acceptInvitation(token)
    await downloadRaffle(id, beto.transport, { store: beto.store })
    await ana.store.assignNumbers(id, [7], { name: 'Juan' })
    await syncRaffle(id, ana.transport, { store: ana.store })
    await beto.store.assignNumbers(id, [7, 9], { name: 'Pedro' })
    const interrupted = { ...beto.transport, getSnapshot: async () => { throw new SyncError('network') } }
    await expect(syncRaffle(id, interrupted, { store: beto.store })).rejects.toMatchObject({ kind: 'network' })
    expect(await beto.store.db.outbox.count()).toBe(0)
    beto.store.db.close()
    await beto.store.db.open()
    await syncRaffle(id, beto.transport, { store: beto.store })
    expect(await names(beto.store, id)).toEqual({ 7: 'Juan' })
    expect(await beto.store.db.sales.where('raffleId').equals(id).count()).toBe(1)
    expect((await beto.store.db.raffles.get(id)).remote).toMatchObject({ needsReconcile: false, syncPending: false, syncError: null })
  })

  it('talonario: la API lo guarda, el pull lo trae y la app avisa antes de vender afuera', async () => {
    const betoId = beto.session.user.id
    const updated = await ana.session.client.updateMember(raffleId, betoId, { ranges: [[1, 50]] })
    expect(updated).toMatchObject({ role: 'seller', ranges: [[1, 50]] })
    await expect(ana.session.client.updateMember(raffleId, betoId, { ranges: [[60, 10]] })).rejects.toMatchObject({ kind: 'client', status: 422 })
    await syncRaffle(raffleId, beto.transport, { store: beto.store })
    expect((await beto.store.db.raffles.get(raffleId)).remote.ranges).toEqual([[1, 50]])
    await expect(beto.store.assignNumbers(raffleId, [99], { name: 'Eli' })).rejects.toThrow('El número 99 está fuera de tu talonario')
  })

  it('comprobante: se sube (multipart) desde un teléfono y se baja en el otro', async () => {
    const blob = new Blob([png], { type: 'image/png' })
    const receipt = { name: 'pago.png', type: 'image/png', size: blob.size, blob, thumb: 'data:image/png;base64,iVBORw0KGgo=', addedAt: 1_729_850_000_000 }
    const saleId = await beto.store.assignNumbers(raffleId, [21], { name: 'Fede' }, { receipt })
    const result = await syncRaffle(raffleId, beto.transport, { store: beto.store })
    expect(result).toMatchObject({ pushed: 2, uploaded: 1 })
    expect(await beto.store.db.uploads.count()).toBe(0)

    await syncRaffle(raffleId, ana.transport, { store: ana.store })
    const meta = await ana.store.db.receipts.get(saleId)
    expect(meta).toMatchObject({ remote: true, hasFile: true, name: 'pago.png', type: 'image/png', size: png.length, addedAt: receipt.addedAt })
    expect(meta.thumb).toBe(receipt.thumb)
    const file = await fetchReceiptFile(raffleId, saleId, ana.transport, { store: ana.store })
    expect(file.size).toBe(png.length)
    expect(Buffer.from(await file.arrayBuffer()).equals(png)).toBe(true)
    const stored = await ana.store.db.receipts.get(saleId)
    expect(stored.remote).toBeUndefined()
  })

  it('una sesión vencida o cerrada responde 401 sin perder el outbox', async () => {
    const token = ana.session.auth.token
    await ana.store.assignNumbers(raffleId, [30], { name: 'Gabi' })
    const stale = createApiClient({ baseUrl: apiUrl, getToken: () => token })
    await ana.session.logout()
    await expect(syncRaffle(raffleId, stale, { store: ana.store })).rejects.toMatchObject({ kind: 'auth', status: 401 })
    expect(await ana.store.db.outbox.count()).toBe(1)
    await ana.session.login({ email: anaEmail, password: 'secreto123' })
    await syncRaffle(raffleId, ana.transport, { store: ana.store })
    expect(await ana.store.db.outbox.count()).toBe(0)
  })

  it('quien vende sale de la rifa; quien organiza la borra y el otro teléfono la ve borrada', async () => {
    // Beto sale y vuelve a entrar con otra invitación.
    await deleteCloudRaffle(raffleId, beto.transport, { store: beto.store })
    expect(await beto.store.db.raffles.get(raffleId)).toBeUndefined()
    await expect(beto.transport.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden' })
    const { token } = await ana.session.client.createInvitation(raffleId, { role: 'viewer' })
    await beto.session.client.acceptInvitation(token)
    await downloadRaffle(raffleId, beto.transport, { store: beto.store })
    await expect(beto.store.assignNumbers(raffleId, [40], { name: 'Hugo' })).rejects.toThrow('Sólo podés ver esta rifa')

    await deleteCloudRaffle(raffleId, ana.transport, { store: ana.store })
    expect(await ana.store.db.raffles.get(raffleId)).toBeUndefined()
    await expect(syncRaffle(raffleId, beto.transport, { store: beto.store })).rejects.toMatchObject({ kind: 'gone', status: 410 })
    expect((await beto.store.db.raffles.get(raffleId)).remote.status).toBe('deleted')
    // Se puede guardar una copia local.
    const copy = await beto.store.saveLocalCopy(raffleId, { title: 'Copia' })
    expect((await beto.store.db.raffles.get(copy.raffleId)).remote).toBeNull()
  })
})
