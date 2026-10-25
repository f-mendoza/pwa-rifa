import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { createSyncManager } from '../../src/sync/manager.js'
import { createSession, deviceLabel, errorKind } from '../../src/sync/session.js'
import { describeSyncState } from '../../src/sync/status.js'
import { device, sharedRaffle } from './syncHelpers.js'

const sessions = []
afterEach(() => {
  for (const s of sessions.splice(0)) s.stop()
})

/** Un teléfono con la app: su base y su sesión contra el servidor falso. */
async function phone(server = createFakeServer()) {
  const store = device('sesion')
  await store.db.open()
  const session = createSession({ store, createClient: (getToken) => server.client({ getToken }), deviceName: 'Test' })
  sessions.push(session)
  await session.ready
  return { server, store, session }
}

const auth = async (store) => (await store.db.settings.get('auth'))?.value
const syncState = async (store) => (await store.db.settings.get('syncState'))?.value ?? {}

describe('sesión (settings.auth)', () => {
  it('sin sesión no hay transporte: las rifas en la nube no sincronizan', async () => {
    const { session } = await phone()
    expect(session.auth).toBeNull()
    expect(session.transport()).toBeNull()
  })

  it('registrarse guarda { token, user } y deja de pedir iniciar sesión', async () => {
    const { store, session } = await phone()
    await store.setSyncState({ needsLogin: true })
    const listener = vi.fn()
    session.subscribe(listener)
    const user = await session.register({ name: ' Ana ', email: 'Ana@Example.com', password: 'secreto123', passwordConfirmation: 'secreto123' })
    expect(user).toMatchObject({ name: 'Ana', email: 'ana@example.com', emailVerifiedAt: null })
    expect(await auth(store)).toEqual({ token: expect.any(String), user: { id: user.id, name: 'Ana', email: 'ana@example.com', emailVerifiedAt: null } })
    expect((await syncState(store)).needsLogin).toBe(false)
    expect(session.transport()).toBe(session.client)
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ user: expect.objectContaining({ id: user.id }) }))
    // createdBy de las ventas sale de la sesión
    expect(await store.currentUser()).toEqual({ id: user.id, name: 'Ana' })
  })

  it('iniciar sesión con datos incorrectos explica el error y no guarda nada', async () => {
    const { server, store, session } = await phone()
    server.createUser('Ana', 'ana@example.com', 'secreto123')
    await expect(session.login({ email: 'ana@example.com', password: 'otra' })).rejects.toThrow('El correo o la contraseña no son correctos.')
    expect(await auth(store)).toBeUndefined()
    await expect(session.login({ email: 'ana@example.com', password: 'secreto123' })).resolves.toMatchObject({ name: 'Ana' })
  })

  it('sin conexión, iniciar sesión pide internet', async () => {
    const { session } = await phone()
    session.client.setOnline(false)
    const err = await session.login({ email: 'a@b.c', password: 'x' }).catch((e) => e)
    expect(err.message).toBe('Para iniciar sesión necesitás conexión a internet. Probá de nuevo cuando tengas señal.')
    expect(errorKind(err)).toBe('network')
  })

  it('cerrar sesión borra settings.auth y revoca el token; sin conexión se cierra igual', async () => {
    const { server, store, session } = await phone()
    const ana = server.createUser('Ana', 'ana@example.com')
    await session.login({ email: 'ana@example.com', password: 'secreto123' })
    const token = session.auth.token
    await session.logout()
    expect(await auth(store)).toBeUndefined()
    expect(session.transport()).toBeNull()
    // el token viejo ya no sirve
    const old = server.client({ getToken: () => token })
    await expect(old.me()).rejects.toMatchObject({ kind: 'auth' })

    await session.login({ email: 'ana@example.com', password: 'secreto123' })
    session.client.setOnline(false)
    await session.logout()
    expect(await auth(store)).toBeUndefined()
    expect(ana.id).toBe(1)
  })

  it('cerrar sesión deja las rifas en la nube con sus cambios sin enviar', async () => {
    const { a, raffleId } = await sharedRaffle()
    await a.store.assignNumbers(raffleId, [3], { name: 'Juan' })
    expect(await a.store.unsentChanges()).toBe(1)
    await a.store.clearAuth()
    expect(await a.store.unsentChanges()).toBe(1)
    expect(await a.store.db.raffles.get(raffleId)).toBeTruthy()
    // sin sesión se puede seguir vendiendo: queda a nombre de la cuenta de la rifa
    await a.store.assignNumbers(raffleId, [4], { name: 'Caro' })
    const sales = await a.store.db.sales.where('raffleId').equals(raffleId).toArray()
    expect(sales.map((s) => s.createdBy?.id)).toEqual([a.user.id, a.user.id])
  })

  it('un 401 en un pedido de la cuenta deja anotado que hay que iniciar sesión', async () => {
    const { server, store, session } = await phone()
    const ana = server.createUser('Ana', 'ana@example.com')
    await session.login({ email: 'ana@example.com', password: 'secreto123' })
    server.expireSessions(ana)
    const err = await session.request('ver tus rifas en la nube', (api) => api.listRaffles()).catch((e) => e)
    expect(err.message).toBe('Tu sesión venció. Iniciá sesión de nuevo para ver tus rifas en la nube.')
    expect(errorKind(err)).toBe('auth')
    expect((await syncState(store)).needsLogin).toBe(true)
    // la cuenta queda (para completar el correo al volver a entrar)
    expect(session.user.email).toBe('ana@example.com')
  })

  it('refreshUser trae el correo verificado', async () => {
    const { server, store, session } = await phone()
    const ana = server.createUser('Ana', 'ana@example.com')
    await session.login({ email: 'ana@example.com', password: 'secreto123' })
    server.verifyEmail(ana)
    const user = await session.refreshUser()
    expect(user.emailVerifiedAt).toEqual(expect.any(Number))
    expect((await auth(store)).user.emailVerifiedAt).toEqual(user.emailVerifiedAt)
  })

  it('recuperar y cambiar la contraseña', async () => {
    const { server, session } = await phone()
    server.createUser('Ana', 'ana@example.com')
    expect((await session.forgotPassword('ana@example.com')).message).toMatch(/Si hay una cuenta/)
    const token = server.resetTokenFor('ana@example.com')
    await expect(session.resetPassword({ token: 'mal', email: 'ana@example.com', password: 'nueva1234', passwordConfirmation: 'nueva1234' })).rejects.toThrow(/no es válido/)
    await session.resetPassword({ token, email: 'ana@example.com', password: 'nueva1234', passwordConfirmation: 'nueva1234' })
    await expect(session.login({ email: 'ana@example.com', password: 'nueva1234' })).resolves.toMatchObject({ name: 'Ana' })
  })

  it('se entera de la sesión que inicia otra pestaña', async () => {
    const { server, store, session } = await phone()
    session.start()
    const ana = server.createUser('Ana', 'ana@example.com')
    await store.setAuth(server.tokenFor(ana))
    await vi.waitFor(() => expect(session.user?.name).toBe('Ana'))
    await store.clearAuth()
    await vi.waitFor(() => expect(session.auth).toBeNull())
  })

  it('el nombre del dispositivo para el token', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).toBe('Rifa en iPhone')
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14)')).toBe('Rifa en Android')
    expect(deviceLabel('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Rifa en la compu')
  })
})

describe('rifas de otra cuenta', () => {
  it('no se modifican ni se sincronizan, y se avisa', async () => {
    const { server, a, raffleId } = await sharedRaffle()
    const other = server.createUser('Otra', 'otra@example.com')
    await a.store.setAuth(server.tokenFor(other))
    await expect(a.store.assignNumbers(raffleId, [3], { name: 'Juan' })).rejects.toThrow(
      'Esta rifa es de otra cuenta. Iniciá sesión con esa cuenta para modificarla.',
    )
    const transport = vi.fn(() => server.transportFor(other))
    const m = createSyncManager({ store: a.store, getTransport: transport, getUserId: () => other.id, locks: null, isOnline: () => true, isVisible: () => true, intervalMs: 60_000 })
    m.start()
    await m.syncNow()
    m.stop()
    expect(transport).not.toHaveBeenCalled()
    expect(describeSyncState({ status: 'active', pending: 0, needsLogin: false, otherAccount: true })).toMatchObject({
      tone: 'warn',
      label: 'Esta rifa es de otra cuenta',
    })
  })
})

describe('servidor falso: miembros e invitaciones', () => {
  async function owner() {
    const server = createFakeServer()
    const ana = server.createUser('Ana', 'ana@example.com')
    const beto = server.createUser('Beto', 'beto@example.com')
    const anaApi = server.client({ getToken: () => anaToken })
    const anaToken = server.tokenFor(ana).token
    const betoToken = server.tokenFor(beto).token
    const betoApi = server.client({ getToken: () => betoToken })
    const { raffle } = await anaApi.createRaffle({ config: { title: 'Club', total: 100 }, share: {} })
    return { server, ana, beto, anaApi, betoApi, raffleId: raffle.id }
  }

  it('invitar, ver la invitación sin sesión, aceptar, cambiar rol y talonario, quitar', async () => {
    const { server, beto, anaApi, betoApi, raffleId } = await owner()
    const { token, role, expiresAt } = await anaApi.createInvitation(raffleId, { role: 'seller' })
    expect(role).toBe('seller')
    expect(expiresAt).toBeGreaterThan(Date.now())
    const anon = server.client()
    expect(await anon.getInvitation(token)).toEqual({ raffleId, raffleTitle: 'Club', role: 'seller', invitedBy: 'Ana', expired: false, accepted: false })
    expect(await betoApi.acceptInvitation(token)).toEqual({ raffleId, role: 'seller' })
    expect(await betoApi.acceptInvitation(token)).toEqual({ raffleId, role: 'seller' }) // ya es miembro
    expect((await anaApi.listMembers(raffleId)).map((m) => [m.name, m.role])).toEqual([['Ana', 'owner'], ['Beto', 'seller']])
    expect(await anaApi.updateMember(raffleId, beto.id, { ranges: [[50, 60], [1, 10], [11, 20]] })).toMatchObject({ ranges: [[1, 20], [50, 60]] })
    await expect(betoApi.updateMember(raffleId, beto.id, { role: 'viewer' })).rejects.toMatchObject({ kind: 'forbidden' })
    expect(await anaApi.updateMember(raffleId, beto.id, { role: 'viewer' })).toMatchObject({ role: 'viewer', ranges: null })
    await expect(anaApi.updateMember(raffleId, beto.id, { ranges: [[5, 1]] })).rejects.toMatchObject({ kind: 'client', status: 422 })
    await expect(anaApi.removeMember(raffleId, 'me')).rejects.toMatchObject({ status: 422 })
    await anaApi.removeMember(raffleId, beto.id)
    await expect(betoApi.getSnapshot(raffleId)).rejects.toMatchObject({ kind: 'forbidden' })
  })

  it('invitación usada por otra, vencida, para otro correo o de una rifa borrada', async () => {
    const { server, anaApi, betoApi, raffleId } = await owner()
    const caro = server.createUser('Caro', 'caro@example.com')
    const caroToken = server.tokenFor(caro).token
    const caroApi = server.client({ getToken: () => caroToken })
    const used = (await anaApi.createInvitation(raffleId, { role: 'viewer' })).token
    await betoApi.acceptInvitation(used)
    await expect(caroApi.acceptInvitation(used)).rejects.toThrow(/ya la usó otra persona/)
    const old = (await anaApi.createInvitation(raffleId, { role: 'viewer' })).token
    server.expireInvitation(old)
    expect((await caroApi.getInvitation(old)).expired).toBe(true)
    await expect(caroApi.acceptInvitation(old)).rejects.toThrow(/venció/)
    const forDani = (await anaApi.createInvitation(raffleId, { role: 'viewer', email: 'dani@example.com' })).token
    await expect(caroApi.acceptInvitation(forDani)).rejects.toMatchObject({ kind: 'forbidden', message: 'Esta invitación es para otra cuenta de correo.' })
    await anaApi.deleteRaffle(raffleId)
    await expect(caroApi.getInvitation(forDani)).rejects.toMatchObject({ kind: 'gone', status: 404 })
  })
})
