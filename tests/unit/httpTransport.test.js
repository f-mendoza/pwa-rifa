import { describe, expect, it, vi } from 'vitest'
import { createApiClient } from '../../src/sync/api.js'
import { DEFAULT_API_URL, apiBaseUrl, createHttpTransport } from '../../src/sync/httpTransport.js'
import { SYNC_MESSAGES } from '../../src/sync/transport.js'

const BASE = 'https://api.example.com/api'

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })

/** fetch falso: guarda los pedidos y responde con `respond(url, init)`. */
function fakeFetch(respond = () => json(200, {})) {
  const calls = []
  const fn = vi.fn(async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  })
  return { fn, calls }
}

const transport = (fetch, token = 'tok-1', extra = {}) => createHttpTransport({ baseUrl: BASE, getToken: () => token, fetch, ...extra })

describe('apiBaseUrl', () => {
  it('usa VITE_API_URL sin la barra final, o la de desarrollo', () => {
    expect(apiBaseUrl({ VITE_API_URL: 'https://rifa.example.com/api/' })).toBe('https://rifa.example.com/api')
    expect(apiBaseUrl({})).toBe(DEFAULT_API_URL)
    expect(DEFAULT_API_URL).toBe('http://localhost:8000/api')
  })
})

describe('createHttpTransport', () => {
  it('manda el Bearer, Accept y JSON, y arma las rutas del contrato', async () => {
    const { fn, calls } = fakeFetch(() => json(200, { results: [], version: 3 }))
    const t = transport(fn)
    const ops = [{ opId: 'o1', type: 'number.release', payload: { number: 3 }, createdAt: 1 }]
    expect(await t.pushOps('r 1', ops)).toEqual({ results: [], version: 3 })
    const { url, init } = calls[0]
    expect(url).toBe(`${BASE}/raffles/r%201/ops`)
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer tok-1' })
    expect(JSON.parse(init.body)).toEqual({ ops })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('cada método va a su endpoint', async () => {
    const { fn, calls } = fakeFetch((url, init) => (init.method === 'DELETE' ? new Response(null, { status: 204 }) : json(200, {})))
    const t = transport(fn)
    await t.createRaffle({ config: { title: 'X' }, share: {}, id: 'ignorado' })
    await t.listRaffles()
    await t.getSnapshot('r1')
    await t.pullChanges('r1', 42)
    await expect(t.deleteRaffle('r1')).resolves.toBeUndefined()
    await expect(t.leaveRaffle('r1')).resolves.toBeUndefined()
    expect(calls.map((c) => `${c.init.method} ${c.url.replace(BASE, '')}`)).toEqual([
      'POST /raffles',
      'GET /raffles',
      'GET /raffles/r1/snapshot',
      'GET /raffles/r1/changes?since=42',
      'DELETE /raffles/r1',
      'DELETE /raffles/r1/members/me',
    ])
    // El id de la rifa lo genera el servidor: no se manda.
    expect(JSON.parse(calls[0].init.body)).toEqual({ config: { title: 'X' }, share: {} })
  })

  it('sin token falla con `auth` sin llamar a la red', async () => {
    const { fn } = fakeFetch()
    await expect(transport(fn, null).listRaffles()).rejects.toMatchObject({ name: 'SyncError', kind: 'auth', status: 401 })
    expect(fn).not.toHaveBeenCalled()
  })

  it('si fetch falla (sin señal, CORS, servidor caído) es `network`', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const err = await transport(fetch).getSnapshot('r1').catch((e) => e)
    expect(err).toMatchObject({ name: 'SyncError', kind: 'network', retryable: true, message: SYNC_MESSAGES.network })
    expect(err.cause).toBeInstanceOf(TypeError)
  })

  it.each([
    [401, 'Tenés que iniciar sesión.', 'auth'],
    [403, 'No tenés acceso a esta rifa.', 'forbidden'],
    [404, 'La rifa no existe.', 'gone'],
    [410, 'La rifa fue borrada.', 'gone'],
    [429, 'Demasiados intentos. Esperá un momento y probá de nuevo.', 'client'],
  ])('%i → %s (con el mensaje de la API)', async (status, message, kind) => {
    const { fn } = fakeFetch(() => json(status, { message }))
    await expect(transport(fn).getSnapshot('r1')).rejects.toMatchObject({ name: 'SyncError', kind, status, message })
  })

  it('un 422 muestra el primer error de validación y guarda los demás', async () => {
    const errors = { 'config.total': ['El total tiene que estar entre 1 y 1000.'], share: ['Otro.'] }
    const { fn } = fakeFetch(() => json(422, { message: 'The given data was invalid. (and 1 more error)', errors }))
    await expect(transport(fn).createRaffle({ config: {}, share: {} })).rejects.toMatchObject({
      kind: 'client',
      status: 422,
      message: 'El total tiene que estar entre 1 y 1000.',
      details: errors,
    })
  })

  it('un 5xx (o una respuesta que no es JSON) usa el mensaje propio', async () => {
    const { fn } = fakeFetch(() => new Response('<html>Server Error</html>', { status: 500 }))
    await expect(transport(fn).pullChanges('r1', 0)).rejects.toMatchObject({ kind: 'server', status: 500, message: SYNC_MESSAGES.server })
    const bad = fakeFetch(() => new Response('<html>ok</html>', { status: 200 }))
    await expect(transport(bad.fn).pullChanges('r1', 0)).rejects.toMatchObject({ kind: 'server' })
    const noBody = fakeFetch(() => new Response('', { status: 400 }))
    await expect(transport(noBody.fn).pullChanges('r1', 0)).rejects.toMatchObject({ kind: 'client', message: SYNC_MESSAGES.client })
  })

  it('corta el pedido que tarda demasiado y lo trata como sin conexión', async () => {
    const fetch = vi.fn(
      (url, init) =>
        new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
        }),
    )
    const err = await transport(fetch, 'tok', { timeoutMs: 20 }).getSnapshot('r1').catch((e) => e)
    expect(err).toMatchObject({ kind: 'network' })
    expect(err.message).toMatch(/tardó demasiado/)
  })

  it('sube el comprobante como multipart (POST con _method=PUT) con file, name, thumb y addedAt', async () => {
    const row = { saleId: 's1', name: 'pago.png', type: 'image/png', size: 3, thumb: null, addedAt: 1000, hasFile: true, deleted: false }
    const { fn, calls } = fakeFetch(() => json(200, row))
    const file = new Blob(['abc'], { type: 'image/png' })
    const result = await transport(fn).uploadReceipt('r1', 's1', file, { name: 'pago.png', type: 'image/png', size: 3, thumb: 'data:image/jpeg;base64,AA', addedAt: 1000 })
    expect(result).toEqual(row)
    const { url, init } = calls[0]
    expect(url).toBe(`${BASE}/raffles/r1/sales/s1/receipt`)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBeUndefined() // el boundary lo pone fetch
    expect(init.headers.Authorization).toBe('Bearer tok-1')
    const form = init.body
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('_method')).toBe('PUT')
    expect(form.get('name')).toBe('pago.png')
    expect(form.get('thumb')).toBe('data:image/jpeg;base64,AA')
    expect(form.get('addedAt')).toBe('1000')
    const sent = form.get('file')
    expect(sent.name).toBe('pago.png')
    expect(await sent.text()).toBe('abc')
  })

  it('sin miniatura no manda thumb', async () => {
    const { fn, calls } = fakeFetch(() => json(200, {}))
    await transport(fn).uploadReceipt('r1', 's1', new Blob(['%PDF'], { type: 'application/pdf' }), { name: '', thumb: null, addedAt: 5 })
    expect(calls[0].init.body.has('thumb')).toBe(false)
    expect(calls[0].init.body.get('file').name).toBe('comprobante')
  })

  it('baja el archivo del comprobante como Blob', async () => {
    const { fn, calls } = fakeFetch(() => new Response(new Blob(['%PDF-1.4']), { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
    const blob = await transport(fn).downloadReceipt('r1', 's1')
    expect(await blob.text()).toBe('%PDF-1.4')
    expect(calls[0].url).toBe(`${BASE}/raffles/r1/sales/s1/receipt`)
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok-1')
  })

  it('lee el token en cada pedido (la sesión puede cambiar)', async () => {
    let token = 'a'
    const { fn, calls } = fakeFetch(() => json(200, []))
    const t = createHttpTransport({ baseUrl: `${BASE}/`, getToken: () => token, fetch: fn })
    await t.listRaffles()
    token = 'b'
    await t.listRaffles()
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual(['Bearer a', 'Bearer b'])
    expect(calls[0].url).toBe(`${BASE}/raffles`)
  })
})

describe('createApiClient', () => {
  const client = (fetch, token = 'tok') => createApiClient({ baseUrl: BASE, getToken: () => token, fetch })

  it('registrarse e iniciar sesión no mandan token y devuelven { token, user }', async () => {
    const user = { id: 1, name: 'Ana', email: 'ana@example.com', emailVerifiedAt: null }
    const { fn, calls } = fakeFetch(() => json(201, { token: '1|abc', user }))
    const api = client(fn, null)
    const data = { name: 'Ana', email: 'ana@example.com', password: 'secreto123', passwordConfirmation: 'secreto123', deviceName: 'Rifa en Android' }
    expect(await api.register(data)).toEqual({ token: '1|abc', user })
    await api.login({ email: 'ana@example.com', password: 'secreto123' })
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual(['/auth/register', '/auth/login'])
    expect(calls.every((c) => !c.init.headers.Authorization)).toBe(true)
    expect(JSON.parse(calls[0].init.body)).toEqual(data)
  })

  it('un login con datos incorrectos falla con el mensaje en castellano', async () => {
    const { fn } = fakeFetch(() => json(422, { message: 'x', errors: { email: ['El correo o la contraseña no son correctos.'] } }))
    await expect(client(fn, null).login({ email: 'a@b.c', password: 'nop' })).rejects.toMatchObject({
      kind: 'client',
      message: 'El correo o la contraseña no son correctos.',
    })
  })

  it('cuenta: me, logout, recuperar y cambiar la contraseña, reenviar el correo', async () => {
    const user = { id: 1, name: 'Ana', email: 'a@b.c', emailVerifiedAt: 5 }
    const { fn, calls } = fakeFetch((url) => {
      if (url.endsWith('/auth/me')) return json(200, { user })
      if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 })
      return json(200, { message: 'Listo.' })
    })
    const api = client(fn)
    expect(await api.me()).toEqual(user)
    await expect(api.logout()).resolves.toBeUndefined()
    expect(await api.forgotPassword('a@b.c')).toEqual({ message: 'Listo.' })
    await api.resetPassword({ token: 't', email: 'a@b.c', password: 'nueva1234', passwordConfirmation: 'nueva1234' })
    expect(await api.resendVerification()).toEqual({ message: 'Listo.' })
    expect(calls.map((c) => [c.init.method, c.url.replace(BASE, ''), Boolean(c.init.headers.Authorization)])).toEqual([
      ['GET', '/auth/me', true],
      ['POST', '/auth/logout', true],
      ['POST', '/auth/forgot-password', false],
      ['POST', '/auth/reset-password', false],
      ['POST', '/auth/email/resend', true],
    ])
  })

  it('miembros e invitaciones', async () => {
    const { fn, calls } = fakeFetch((url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 })
      if (url.includes('/invitations') && init.method === 'POST' && !url.endsWith('/accept')) return json(201, { token: 'abc', role: 'seller', expiresAt: 9 })
      return json(200, {})
    })
    const api = client(fn)
    await api.listMembers('r1')
    await api.updateMember('r1', 7, { role: 'seller', ranges: [[1, 100]] })
    await api.removeMember('r1', 7)
    await api.removeMember('r1', 'me')
    expect(await api.createInvitation('r1', { role: 'seller' })).toEqual({ token: 'abc', role: 'seller', expiresAt: 9 })
    await api.getInvitation('tok/en')
    await api.acceptInvitation('abc')
    expect(calls.map((c) => [c.init.method, c.url.replace(BASE, ''), Boolean(c.init.headers.Authorization)])).toEqual([
      ['GET', '/raffles/r1/members', true],
      ['PATCH', '/raffles/r1/members/7', true],
      ['DELETE', '/raffles/r1/members/7', true],
      ['DELETE', '/raffles/r1/members/me', true],
      ['POST', '/raffles/r1/invitations', true],
      ['GET', '/invitations/tok%2Fen', false],
      ['POST', '/invitations/abc/accept', true],
    ])
    expect(JSON.parse(calls[1].init.body)).toEqual({ role: 'seller', ranges: [[1, 100]] })
    expect(JSON.parse(calls[4].init.body)).toEqual({ role: 'seller' })
  })
})
