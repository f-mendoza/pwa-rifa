import { createHttpTransport, createRequester } from './httpTransport.js'

/**
 * Cliente de la API para todo lo que no es sincronizar: cuentas, rifas compartidas, miembros e
 * invitaciones (ver docs/sync-protocolo.md). Incluye también los métodos del `Transport`, así la
 * app tiene un solo objeto por sesión.
 *
 * El servidor falso (`fakeServer.js`, modo `/?nube-falsa`) ofrece exactamente esta misma
 * interfaz con `server.client({ getToken })`.
 *
 * @typedef {{ id: number, name: string, email: string, emailVerifiedAt: number|null }} User
 * @typedef {{ userId: number, name: string, email: string, role: import('./transport.js').Role, ranges: import('./transport.js').Ranges }} Member
 * @typedef {{ raffleId: string, raffleTitle: string, role: 'seller'|'viewer', invitedBy: string|null, expired: boolean, accepted: boolean }} InvitationInfo
 *
 * @typedef {import('./transport.js').Transport & {
 *   register(data: { name: string, email: string, password: string, passwordConfirmation: string, deviceName?: string }): Promise<{ token: string, user: User }>,
 *   login(data: { email: string, password: string, deviceName?: string }): Promise<{ token: string, user: User }>,
 *   logout(): Promise<void>,
 *   me(): Promise<User>,
 *   forgotPassword(email: string): Promise<{ message: string }>,
 *   resetPassword(data: { token: string, email: string, password: string, passwordConfirmation: string }): Promise<{ message: string }>,
 *   resendVerification(): Promise<{ message: string }>,
 *   listMembers(raffleId: string): Promise<Member[]>,
 *   updateMember(raffleId: string, userId: number, patch: { role?: string, ranges?: import('./transport.js').Ranges }): Promise<Member>,
 *   removeMember(raffleId: string, userId: number|'me'): Promise<void>,
 *   createInvitation(raffleId: string, data: { role: 'seller'|'viewer', email?: string }): Promise<{ token: string, role: string, expiresAt: number }>,
 *   getInvitation(token: string): Promise<InvitationInfo>,
 *   acceptInvitation(token: string): Promise<{ raffleId: string, role: import('./transport.js').Role }>,
 * }} ApiClient
 */

const seg = (value) => encodeURIComponent(String(value))

/**
 * @param {Parameters<typeof createRequester>[0]} options
 * @returns {ApiClient}
 */
export function createApiClient(options = {}) {
  const requester = createRequester(options)
  const { request } = requester
  const transport = createHttpTransport({ requester })
  const raffle = (id) => `/raffles/${seg(id)}`

  return {
    ...transport,

    register: (data) => request('POST', '/auth/register', { auth: false, json: data }),
    login: (data) => request('POST', '/auth/login', { auth: false, json: data }),
    logout: async () => {
      await request('POST', '/auth/logout')
    },
    me: async () => (await request('GET', '/auth/me')).user,
    forgotPassword: (email) => request('POST', '/auth/forgot-password', { auth: false, json: { email } }),
    resetPassword: (data) => request('POST', '/auth/reset-password', { auth: false, json: data }),
    resendVerification: async () => (await request('POST', '/auth/email/resend')) ?? { message: '' },

    listMembers: (raffleId) => request('GET', `${raffle(raffleId)}/members`),
    updateMember: (raffleId, userId, patch) => request('PATCH', `${raffle(raffleId)}/members/${seg(userId)}`, { json: patch }),
    removeMember: async (raffleId, userId) => {
      await request('DELETE', `${raffle(raffleId)}/members/${seg(userId)}`)
    },

    createInvitation: (raffleId, { role, email } = {}) =>
      request('POST', `${raffle(raffleId)}/invitations`, { json: email ? { role, email } : { role } }),
    getInvitation: (token) => request('GET', `/invitations/${seg(token)}`, { auth: false }),
    acceptInvitation: (token) => request('POST', `/invitations/${seg(token)}/accept`),
  }
}
