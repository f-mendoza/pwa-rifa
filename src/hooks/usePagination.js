import { useState } from 'react'

/**
 * Pagina una lista en memoria. Vuelve a la primera página cuando cambia `resetKey`
 * (búsqueda o filtro) y se acomoda si la lista se achica, por ejemplo al borrar.
 */
export function usePagination(items, pageSize, resetKey) {
  const [state, setState] = useState({ page: 1, resetKey })
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const requested = state.resetKey === resetKey ? state.page : 1
  const page = Math.min(requested, pageCount)
  const start = (page - 1) * pageSize

  return {
    page,
    pageCount,
    pageSize,
    total: items.length,
    items: items.slice(start, start + pageSize),
    setPage: (next) => setState({ page: next, resetKey }),
  }
}
