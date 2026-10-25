import { useMemo, useState } from 'react'
import { personKey } from '../db.js'
import { usePagination } from '../hooks/usePagination.js'
import { formatDateTime, formatMoney, plural, saleLabel, sellerName } from '../lib/format.js'
import { Pagination } from './Pagination.jsx'
import { ReceiptThumb } from './Receipt.jsx'

const PAGE_SIZE = 10

const FILTERS = [
  { id: 'all', label: 'Todos' },
  { id: 'missing', label: 'Sin comprobante' },
  { id: 'manual', label: 'Monto corregido' },
]

export function PaymentsView({ data, onOpenPurchase }) {
  const { purchases, revenue, missingReceipts } = data
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')

  const manualCount = purchases.filter((p) => p.manual).length
  const counts = { all: purchases.length, missing: missingReceipts, manual: manualCount }

  const list = useMemo(() => {
    const q = query.trim()
    const numeric = /^\d+$/.test(q)
    const key = personKey(q)
    return purchases.filter((p) => {
      if (filter === 'missing' && p.receipt) return false
      if (filter === 'manual' && !p.manual) return false
      if (!q) return true
      if (numeric) return p.numbers.includes(Number(q)) || String(p.seq) === q
      return personKey(p.payer).includes(key)
    })
  }, [purchases, filter, query])
  const pagination = usePagination(list, PAGE_SIZE, `${filter}|${query.trim()}`)

  if (purchases.length === 0) {
    return (
      <section className="panel">
        <div className="empty-state">
          <p className="empty-title">Todavía no hay comprobantes</p>
          <p className="muted">Cada vez que asignás números se crea un comprobante con su monto.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="panel" aria-labelledby="payments-title">
      <div className="payments-summary">
        <div>
          <h2 id="payments-title" className="section-title">
            Comprobantes
          </h2>
          <p className="muted">
            {plural(purchases.length, 'venta', 'ventas')} · {formatMoney(revenue)} recaudado
          </p>
        </div>
        {missingReceipts > 0 && (
          <p className="badge warn">{missingReceipts} sin comprobante</p>
        )}
      </div>

      <div className="toolbar">
        <div className="segmented" role="radiogroup" aria-label="Filtrar comprobantes">
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
          <span className="visually-hidden">Buscar comprobante</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nombre o número" />
        </label>
      </div>

      {list.length === 0 ? (
        <p className="empty">Ningún comprobante coincide.</p>
      ) : (
        <ul className="payments">
          {pagination.items.map((p) => (
            <li key={p.id}>
              <button type="button" className="payment" onClick={() => onOpenPurchase(p.id)}>
                <ReceiptThumb receipt={p.receipt} />
                {!p.receipt && <span className="visually-hidden">Sin comprobante.</span>}
                <span className="payment-main">
                  <span className="payment-name">{p.payer}</span>
                  <span className="muted">
                    {saleLabel(p)} · {formatDateTime(p.createdAt)}
                    {data.raffle?.remote && p.createdBy && ` · vendió ${sellerName(p.createdBy, data.user)}`}
                  </span>
                  <span className="payment-numbers">
                    {plural(p.numbers.length, 'número', 'números')}: {p.numbers.join(' · ')}
                  </span>
                </span>
                <span className="payment-side">
                  <span className="payment-amount">{formatMoney(p.total)}</span>
                  {p.manual && p.total !== p.auto && <s className="muted">{formatMoney(p.auto)}</s>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Pagination pagination={pagination} label="Páginas de comprobantes" />
    </section>
  )
}
