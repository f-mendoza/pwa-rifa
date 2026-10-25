import { useSyncExternalStore } from 'react'
import { currentSession } from '../sync/index.js'

const noop = () => () => {}

/**
 * La sesión con la nube y la cuenta actual. `session` es `null` si la app no tiene nube
 * configurada (p. ej. en los tests de componentes); `auth` es `{ token, user }` o `null`.
 */
export function useSession() {
  const session = currentSession()
  const auth = useSyncExternalStore(session ? session.subscribe : noop, () => session?.auth ?? null)
  return { session, auth, user: auth?.user ?? null }
}
