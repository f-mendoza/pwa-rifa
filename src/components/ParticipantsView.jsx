import { useMemo, useState } from 'react'
import { personKey } from '../db.js'
import { usePagination } from '../hooks/usePagination.js'
import { formatMoney, plural } from '../lib/format.js'
import { permissionsFor } from '../lib/permissions.js'
import { ContactLinks } from './ContactLinks.jsx'
import { Pagination } from './Pagination.jsx'

// 9 llena la grilla de 3 columnas sin dejar huecos
const PAGE_SIZE = 9

export function ParticipantsView({ data, onOpenTicket, onEditPerson }) {
  const [query, setQuery] = useState('')
  const canEdit = permissionsFor(data).edit

  const people = useMemo(() => {
    const q = query.trim()
    if (!q) return data.people
    const key = personKey(q)
    return data.people.filter(
      (p) =>
        p.key.includes(key) ||
        (p.referrer && personKey(p.referrer).includes(key)) ||
        p.phone?.includes(q) ||
        p.email?.toLowerCase().includes(q.toLowerCase()) ||
        p.numbers.some((n) => String(n) === q),
    )
  }, [data.people, query])
  const pagination = usePagination(people, PAGE_SIZE, query.trim())

  if (data.people.length === 0) {
    return (
      <section className="panel">
        <div className="empty-state">
          <p className="empty-title">Todavía no hay participantes</p>
          <p className="muted">Elegí números libres en la pestaña Números y asignalos a una persona.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="people-title">
      <div className="toolbar">
        <h2 id="people-title" className="section-title">
          {plural(data.people.length, 'participante', 'participantes')}
        </h2>
        <label className="search">
          <span className="visually-hidden">Buscar participante</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Nombre, referido o número"
          />
        </label>
      </div>

      {people.length === 0 ? (
        <p className="empty">Nadie coincide con «{query}».</p>
      ) : (
        <ul className="people">
          {pagination.items.map((p) => (
            <li key={p.id} className="person">
              <div className="person-head">
                <div>
                  <p className="person-name">{p.name}</p>
                  <p className="muted">
                    {plural(p.numbers.length, 'número', 'números')}
                    {p.amount > 0 && ` · pagó ${formatMoney(p.amount)}`}
                    {p.referrer && ` · referido por ${p.referrer}`}
                  </p>
                </div>
                {canEdit && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onEditPerson(p.id)}>
                    Editar
                  </button>
                )}
              </div>
              <ContactLinks person={p} />
              <ul className="chips" aria-label={`Números de ${p.name}`}>
                {p.numbers.map((n) => (
                  <li key={n}>
                    <button type="button" className="chip" onClick={() => onOpenTicket(n)}>
                      {n}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <Pagination pagination={pagination} label="Páginas de participantes" />
    </section>
  )
}
