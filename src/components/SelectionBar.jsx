import { formatMoney, plural, priceFor } from '../lib/format.js'

export function SelectionBar({ selected, config, onClear, onAssign }) {
  const numbers = [...selected].sort((a, b) => a - b)
  const visible = selected.size > 0

  return (
    <div className={`selection-bar ${visible ? 'is-visible' : ''}`} aria-hidden={!visible} inert={!visible}>
      <button type="button" className="icon-btn" onClick={onClear} aria-label="Limpiar selección">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className="selection-info">
        <strong>
          {plural(numbers.length, 'número', 'números')} · {formatMoney(priceFor(numbers.length, config))}
        </strong>
        <span className="selection-list">{numbers.join(' · ')}</span>
      </div>
      <button type="button" className="btn btn-primary" onClick={onAssign}>
        Asignar
      </button>
    </div>
  )
}
