import { useEffect, useState } from 'react'

/**
 * Rutas de la app (sin router: son pocas y el service worker devuelve index.html para cualquier
 * dirección):
 * - `/invitacion/:token` → aceptar una invitación a una rifa en la nube;
 * - `/restablecer-clave?token=…&email=…` → elegir una contraseña nueva (link del correo);
 * - `/?correo=verificado` → volvió del link para verificar el correo;
 * - cualquier otra → la rifa abierta.
 */
export function parseRoute(loc = globalThis.location) {
  const path = decodeURIComponent(loc?.pathname ?? '/').replace(/\/+$/, '')
  const params = new URLSearchParams(loc?.search ?? '')
  const invitation = /^\/invitacion\/([^/]+)$/.exec(path)
  if (invitation) return { name: 'invitation', token: invitation[1] }
  if (path === '/restablecer-clave') {
    return { name: 'reset-password', token: params.get('token') ?? '', email: params.get('email') ?? '' }
  }
  if (params.get('correo') === 'verificado') return { name: 'email-verified' }
  return { name: 'home' }
}

const EVENT = 'rifa:navigate'

/**
 * Vuelve a la pantalla principal y deja la dirección limpia (sin el token de la invitación ni el
 * del correo), sin recargar. Conserva `?nube-falsa` en desarrollo.
 */
export function goHome() {
  const params = new URLSearchParams(location.search)
  const keep = new URLSearchParams()
  if (params.has('nube-falsa')) keep.set('nube-falsa', params.get('nube-falsa'))
  const qs = keep.toString().replace(/=$/, '')
  history.replaceState(null, '', qs ? `/?${qs}` : '/')
  dispatchEvent(new Event(EVENT))
}

/** La ruta actual; cambia con atrás/adelante y con `goHome()`. */
export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute())
  useEffect(() => {
    const update = () => setRoute(parseRoute())
    addEventListener('popstate', update)
    addEventListener(EVENT, update)
    return () => {
      removeEventListener('popstate', update)
      removeEventListener(EVENT, update)
    }
  }, [])
  return route
}
