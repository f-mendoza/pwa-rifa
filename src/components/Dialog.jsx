import { useEffect, useId, useRef, useState } from 'react'

const CLOSE_MS = 200

/** Hoja modal sobre <dialog> nativo: foco atrapado, Escape y fondo clickeable gratis. */
export function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()
  // Mientras se anima la salida se sigue mostrando lo último que tuvo adentro:
  // el padre suele vaciar el contenido en el mismo render en que cierra.
  const [closing, setClosing] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    setClosing(!open)
  }
  const last = useRef({ title, children })
  // oxlint-disable-next-line react/refs -- caché deliberada del último contenido para la salida
  if (open) last.current = { title, children }

  useEffect(() => {
    const dialog = ref.current
    if (open) {
      if (!dialog.open) {
        dialog.showModal()
        // showModal enfoca el primer botón (la X); preferimos el campo marcado.
        dialog.querySelector('[data-autofocus]')?.focus()
      }
      return
    }
    if (!closing || !dialog.open) return
    let done = false
    const finish = () => {
      if (done) return
      done = true
      dialog.close()
      setClosing(false)
    }
    // animationend del propio diálogo; el timeout cubre "reducir movimiento" y navegadores sin animación.
    const onEnd = (e) => e.target === dialog && finish()
    dialog.addEventListener('animationend', onEnd)
    const timer = setTimeout(finish, CLOSE_MS + 80)
    return () => {
      dialog.removeEventListener('animationend', onEnd)
      clearTimeout(timer)
      finish()
    }
  }, [open, closing])

  const shown = open || closing
  // oxlint-disable-next-line react/refs -- ver arriba
  const content = open ? { title, children } : last.current

  return (
    <dialog
      ref={ref}
      className={`sheet ${closing ? 'is-closing' : ''}`}
      aria-labelledby={titleId}
      // Escape: se cierra con animación desde el estado del padre, no de golpe.
      onCancel={(e) => {
        e.preventDefault()
        if (open) onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
      // Sólo cierra si el toque empezó y terminó en el fondo: arrastrar una selección
      // desde un campo hacia afuera no tiene que cerrar el formulario y perder lo escrito.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current
      }}
      onClick={(e) => {
        if (open && pressedBackdrop.current && e.target === ref.current) onClose()
        pressedBackdrop.current = false
      }}
    >
      {shown && (
        <div className="sheet-body" inert={closing || undefined}>
          <header className="sheet-head">
            <h2 id={titleId}>{content.title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          {content.children}
        </div>
      )}
    </dialog>
  )
}
