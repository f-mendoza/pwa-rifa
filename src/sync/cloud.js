import { store } from '../db.js'
import { createApiClient } from './api.js'
import { apiBaseUrl } from './httpTransport.js'
import { setSession } from './index.js'
import { createSession } from './session.js'

/**
 * Conecta la app con la API real (`VITE_API_URL`): crea la sesión (que lee `settings.auth`) y
 * registra el transporte HTTP. Devuelve la sesión ya cargada.
 */
export async function installCloud({ baseUrl = apiBaseUrl() } = {}) {
  const session = createSession({ store, createClient: (getToken) => createApiClient({ baseUrl, getToken }) })
  setSession(session)
  await session.ready
  session.start()
  return session
}
