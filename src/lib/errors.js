/**
 * Convierte cualquier error en un mensaje para mostrar. Los errores propios de la app
 * (`Error` común, con texto en castellano) pasan tal cual; los del navegador o de
 * IndexedDB traen nombre propio y texto técnico en inglés, así que se traducen.
 */
export function friendlyError(err, fallback = 'Algo salió mal. Probá de nuevo.') {
  if (!err) return fallback
  const name = err.name || err.inner?.name
  if (name === 'QuotaExceededError' || err.inner?.name === 'QuotaExceededError') {
    return 'El teléfono se quedó sin espacio para guardar. Liberá espacio o quitá comprobantes viejos.'
  }
  if (name === 'NotAllowedError') return 'El navegador no dio permiso para hacerlo. Probá de nuevo tocando el botón.'
  if (name === 'ConstraintError') return 'Ese dato ya existe. Recargá la app y probá de nuevo.'
  if (name === 'InvalidStateError' || name === 'DatabaseClosedError') {
    return 'No se pudo acceder a los datos guardados. Cerrá y volvé a abrir la app.'
  }
  if (name && name !== 'Error') return fallback
  return err.message || fallback
}
