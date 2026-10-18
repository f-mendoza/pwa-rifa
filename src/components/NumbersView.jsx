import { useMemo, useState } from 'react'
import { personKey } from '../db.js'

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'available', label: 'Disponibles' },
  { id: 'taken', label: 'Tomados' },
]

export function NumbersView({ data, selected, onToggle, onOpenTicket }) {
  const { config, ticketByNumber, peopleById, available, takenCount } = data
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const counts = { all: config.total, available: available.length, taken: takenCount }

  const numbers = useMemo(() => {
    const q = query.trim()
    const numeric = /^\d+$/.test(q)
    const nameKey = numeric ? '' : personKey(q)
    const list = []
    for (let n = 1; n <= config.total; n++) {
      const ticket = ticketByNumber.get(n)
      if (filter === 'available' && ticket) continue
      if (filter === 'taken' && !ticket) continue
      if (numeric && !String(n).includes(q)) continue
      if (nameKey && !(ticket && peopleById.get(ticket.participantId)?.key.includes(nameKey))) continue
      list.push(n)
    }
    return list
  }, [config.total, ticketByNumber, peopleById, filter, query])

  return (
    <section className="panel" aria-labelledby="numbers-title">
      <div className="toolbar">
        <h2 id="numbers-title" className="visually-hidden">
          Números
        </h2>
        <div className="segmented" role="radiogroup" aria-label="Filtrar números">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={filter === f.id}
              className="segmented-item"
              onClick={() => setFilter(f.id)}
            >
              {f.label} <span className="count">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <span className="visually-hidden">Buscar por número o nombre</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Número o nombre" />
        </label>
      </div>

      <p className="hint">
        Tocá los números libres para elegirlos y asignarlos juntos. Tocá uno tomado para ver quién lo tiene.
      </p>

      {numbers.length === 0 ? (
        <p className="empty">Ningún número coincide con la búsqueda.</p>
      ) : (
        <ol className="number-grid">
          {numbers.map((n) => {
            const ticket = ticketByNumber.get(n)
            const person = ticket && peopleById.get(ticket.participantId)
            const isSelected = selected.has(n)
            return (
              <li key={n}>
                <button
                  type="button"
                  className={`cell ${ticket ? 'is-taken' : ''} ${isSelected ? 'is-selected' : ''}`}
                  aria-pressed={ticket ? undefined : isSelected}
                  aria-label={ticket ? `Número ${n}, tomado por ${person?.name ?? 'alguien'}` : `Número ${n}, disponible`}
                  title={person?.name}
                  onClick={() => (ticket ? onOpenTicket(n) : onToggle(n))}
                >
                  {n}
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <ul className="legend" aria-label="Referencias">
        <li>
          <span className="swatch" /> Disponible
        </li>
        <li>
          <span className="swatch is-selected" /> Elegido
        </li>
        <li>
          <span className="swatch is-taken" /> Tomado
        </li>
      </ul>
    </section>
  )
}
