import { useState } from 'react'
import { formatMoney } from '../lib/format.js'

/** Valor que, cuando cambia (no al montar), entra con una animación corta. */
function Tick({ value }) {
  const [initial] = useState(value)
  const changed = value !== initial
  return (
    <span key={value} className={`tick ${changed ? 'is-changed' : ''}`}>
      {value}
    </span>
  )
}

export function StatsBar({ data }) {
  const { config, available, takenCount, people, revenue, missingReceipts } = data
  // Hacia abajo: con un solo número libre no tiene que decir "100% vendido".
  const pct = config.total ? Math.floor((takenCount / config.total) * 100) : 0

  return (
    <section className="stats" aria-label="Resumen">
      <dl className="stats-grid">
        <div className="stat stat-hero">
          <dt>Disponibles</dt>
          <dd>
            <Tick value={available.length} />
          </dd>
        </div>
        <div className="stat">
          <dt>Tomados</dt>
          <dd>
            <Tick value={takenCount} />
          </dd>
        </div>
        <div className="stat">
          <dt>Participantes</dt>
          <dd>
            <Tick value={people.length} />
          </dd>
        </div>
        <div className="stat stat-revenue">
          <dt>
            Recaudado
            {missingReceipts > 0 && (
              <span className="stat-note">{missingReceipts} sin comprobante</span>
            )}
          </dt>
          <dd className="stat-money">
            <Tick value={formatMoney(revenue)} />
          </dd>
        </div>
      </dl>
      <div className="progress">
        <div
          className="progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={config.total}
          aria-valuenow={takenCount}
          aria-valuetext={`${pct}% vendido`}
          aria-label="Números vendidos"
        >
          <div className="progress-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <span className="progress-label">
          {pct}% vendido · {takenCount} de {config.total}
        </span>
      </div>
    </section>
  )
}
