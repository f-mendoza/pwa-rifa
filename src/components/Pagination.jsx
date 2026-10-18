import { useRef } from 'react'

export function Pagination({ pagination, label }) {
  const { page, pageCount, pageSize, total, setPage } = pagination
  const ref = useRef(null)

  if (pageCount <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  // Los controles quedan al pie: si el inicio de la sección ya no se ve, volvemos a él
  const go = (next) => {
    setPage(next)
    const panel = ref.current?.closest('.panel')
    if (panel && panel.getBoundingClientRect().top < 0) panel.scrollIntoView({ block: 'start' })
  }

  return (
    <nav ref={ref} className="pagination" aria-label={label}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => go(page - 1)}
        disabled={page === 1}
        aria-label="Página anterior"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        <span className="pagination-word">Anterior</span>
      </button>
      <p className="pagination-status" aria-live="polite">
        <span>
          {from}–{to} de {total}
        </span>
        <span className="muted">
          Página {page} de {pageCount}
        </span>
      </p>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => go(page + 1)}
        disabled={page === pageCount}
        aria-label="Página siguiente"
      >
        <span className="pagination-word">Siguiente</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </nav>
  )
}
