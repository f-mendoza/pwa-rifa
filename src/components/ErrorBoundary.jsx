import { Component } from 'react'

/**
 * Último recurso: si algo falla al dibujar (o IndexedDB no está disponible, p. ej. en
 * algunas ventanas privadas), se explica qué pasó en vez de dejar la pantalla en blanco.
 */
export class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const storage = /IndexedDB|MissingAPI|OpenFailed|DatabaseClosed|InvalidState|QuotaExceeded/i.test(
      `${error.name} ${error.message}`,
    )
    return (
      <main className="fatal" role="alert">
        <p className="logo">RIFA</p>
        <h1 className="empty-title">{storage ? 'No se pudo abrir la base de datos' : 'Algo falló al mostrar la app'}</h1>
        <p className="muted">
          {storage
            ? 'El navegador no deja guardar datos. Si estás en una ventana privada o de incógnito, abrí la app en una ventana normal.'
            : 'Tus datos siguen guardados en este teléfono. Recargá para volver a intentar.'}
        </p>
        <p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </p>
        <code>{error.name}: {error.message}</code>
      </main>
    )
  }
}
