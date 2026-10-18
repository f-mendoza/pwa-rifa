import { useEffect, useId, useRef } from 'react'

/** Hoja modal sobre <dialog> nativo: foco atrapado, Escape y fondo clickeable gratis. */
export function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null)
  const pressedBackdrop = useRef(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (open && !dialog.open) {
      dialog.showModal()
      // showModal enfoca el primer botón (la X); preferimos el campo marcado.
      dialog.querySelector('[data-autofocus]')?.focus()
    } else if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      // Sólo cierra si el toque empezó y terminó en el fondo: arrastrar una selección
      // desde un campo hacia afuera no tiene que cerrar el formulario y perder lo escrito.
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === ref.current
      }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === ref.current) onClose()
        pressedBackdrop.current = false
      }}
    >
      {open && (
        <div className="sheet-body">
          <header className="sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  )
}
