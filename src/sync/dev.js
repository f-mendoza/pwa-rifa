import { DEFAULT_CONFIG, DEFAULT_SHARE, normalizeConfig, store } from '../db.js'
import { newId } from '../lib/ids.js'
import { createFakeServer } from './fakeServer.js'
import { setSession } from './index.js'
import { createSession } from './session.js'

/**
 * Sólo en desarrollo (`npm run dev` y abrir `/?nube-falsa`): un servidor falso en memoria en
 * lugar de la API, para probar las rifas en la nube, las cuentas y las invitaciones sin PHP. Se
 * pierde al recargar la página.
 *
 * Arranca con la sesión de «Yo» (yo@example.com, contraseña `secreto123`); con
 * `/?nube-falsa=sin-sesion` arranca sin sesión. También existe «Juan» (juan@example.com).
 *
 * Desde la consola (o los tests E2E), con `__rifaNube`:
 * - `await createRaffle('Prueba')` crea una rifa en la nube y la abre;
 * - `setOnline(false)` corta la conexión con el servidor;
 * - `await sellFromOtherPhone(raffleId, [7], 'Ana')` vende desde el teléfono de Juan;
 * - `await inviteFromJuan('seller')` crea una rifa de Juan y devuelve `{ raffleId, token }` de una invitación;
 * - `await shareWithMe('viewer', [[1, 10]])` crea una rifa de Juan y te suma directamente;
 * - `openPath('/invitacion/…')` navega sin recargar (recargar perdería el servidor).
 */
export async function installFakeCloud({ signedIn = true } = {}) {
  const server = createFakeServer()
  const me = server.createUser('Yo', 'yo@example.com')
  const other = server.createUser('Juan', 'juan@example.com')
  const session = createSession({ store, createClient: (getToken) => server.client({ getToken }) })
  setSession(session)
  await session.ready
  if (signedIn) await session.adopt(server.tokenFor(me))
  else await store.clearAuth()
  session.start()

  const otherPhone = server.transportFor(other)
  const juanToken = server.tokenFor(other).token
  const juan = server.client({ getToken: () => juanToken })
  const myAccount = () => session.user ?? me

  async function juanRaffle(title) {
    const snapshot = await juan.createRaffle({ config: normalizeConfig({ ...DEFAULT_CONFIG, title }), share: DEFAULT_SHARE })
    return snapshot.raffle.id
  }

  const api = {
    server,
    session,
    me,
    other,
    get transport() {
      return session.transport()
    },
    createRaffle: (title = 'Rifa en la nube') => store.createCloudRaffle({ title }, session.transport()),
    setOnline: (online) => session.client.setOnline(online),
    /** Vende números desde "otro teléfono" (otra cuenta, vendedora en la rifa). */
    async sellFromOtherPhone(raffleId, numbers, name = 'Comprador de Juan') {
      if (!server.inspect(raffleId)) throw new Error('La rifa no está en el servidor falso')
      if (!server.roleOf(raffleId, other)) server.addMember(raffleId, other, 'seller')
      const op = {
        opId: newId(),
        type: 'numbers.assign',
        payload: { saleId: newId(), seq: 0, numbers, person: { id: newId(), name, phone: '', email: '', referrer: '' }, amount: null, createdAt: Date.now() },
        createdAt: Date.now(),
      }
      const { results } = await otherPhone.pushOps(raffleId, [op])
      return results[0]
    },
    /** Juan crea una rifa y una invitación para ella. */
    async inviteFromJuan(role = 'seller', title = 'Rifa de Juan') {
      const raffleId = await juanRaffle(title)
      const { token } = await juan.createInvitation(raffleId, { role })
      return { raffleId, token }
    },
    /** Juan crea una rifa y te suma directamente (aparece en "Compartidas conmigo"). */
    async shareWithMe(role = 'seller', ranges = null, title = 'Rifa de Juan') {
      const raffleId = await juanRaffle(title)
      server.addMember(raffleId, myAccount(), role, ranges)
      return raffleId
    },
    /** Juan te cambia el rol (y el talonario) en una rifa suya. */
    setMyRole: (raffleId, role, ranges = null) => server.setMember(raffleId, myAccount(), { role, ranges }),
    /** Suma a otra persona a una rifa (para ver la lista de miembros). */
    addMember(raffleId, name = 'Caro', role = 'seller', ranges = null) {
      const user = server.createUser(name, `${name.toLowerCase()}@example.com`)
      server.addMember(raffleId, user, role, ranges)
      return user.id
    },
    /** Juan borra su rifa. */
    deleteFromJuan: (raffleId) => juan.deleteRaffle(raffleId),
    /** Juan te saca de su rifa. */
    removeMe: (raffleId) => server.removeMember(raffleId, myAccount()),
    /** Vence los tokens de la sesión actual: el próximo pedido responde 401. */
    expireSession: () => server.expireSessions(myAccount()),
    /** Navega dentro de la app sin recargar la página. */
    openPath(path) {
      history.pushState(null, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
    },
  }
  globalThis.__rifaNube = api
  return api
}
