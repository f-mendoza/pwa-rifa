import { useState } from 'react'
import { formatDateTime, formatMoney, plural, saleLabel, sellerName } from '../lib/format.js'
import { permissionsFor } from '../lib/permissions.js'
import { AmountField } from './AmountField.jsx'
import { Dialog } from './Dialog.jsx'
import { ReceiptPicker, ReceiptView } from './Receipt.jsx'

export function PurchaseDialog({
  purchaseId,
  data,
  onClose,
  onOpenTicket,
  onSetAmount,
  onSetReceipt,
  onRemoveReceipt,
  onDownloadReceipt,
  onVoid,
  onError,
}) {
  const purchase = purchaseId != null ? data.purchaseById.get(purchaseId) : null

  return (
    <Dialog open={Boolean(purchase)} onClose={onClose} title={purchase ? `Comprobante ${saleLabel(purchase)}` : 'Comprobante'}>
      {purchase && (
        <PurchaseBody
          key={purchase.id}
          purchase={purchase}
          config={data.config}
          perms={permissionsFor(data)}
          user={data.user}
          onClose={onClose}
          onOpenTicket={onOpenTicket}
          onSetAmount={onSetAmount}
          onSetReceipt={onSetReceipt}
          onRemoveReceipt={onRemoveReceipt}
          onDownloadReceipt={onDownloadReceipt}
          onVoid={onVoid}
          onError={onError}
        />
      )}
    </Dialog>
  )
}

function PurchaseBody({
  purchase,
  config,
  perms,
  user,
  onClose,
  onOpenTicket,
  onSetAmount,
  onSetReceipt,
  onRemoveReceipt,
  onDownloadReceipt,
  onVoid,
  onError,
}) {
  const [amount, setAmount] = useState(purchase.manual ? String(purchase.amount) : '')
  const [confirm, setConfirm] = useState(null)
  const count = purchase.numbers.length

  const saved = purchase.manual ? String(purchase.amount) : ''
  const dirty = amount !== saved

  async function saveAmount(e) {
    e.preventDefault()
    // Escribir el mismo valor que el calculado equivale a no corregirlo.
    const value = amount === '' || Number(amount) === purchase.auto ? null : Number(amount)
    if (await onSetAmount(purchase.id, value)) setAmount(value == null ? '' : String(value))
  }

  return (
    <div className="purchase">
      <div className="purchase-head">
        <div>
          <p className="ticket-name">{purchase.payer}</p>
          <p className="muted">
            {formatDateTime(purchase.createdAt)} · {plural(count, 'número', 'números')}
          </p>
          {perms.cloud && purchase.createdBy && (
            <p className="muted sold-by">Vendió {sellerName(purchase.createdBy, user)}</p>
          )}
        </div>
        <div className="purchase-total">
          <span className="purchase-amount">{formatMoney(purchase.total)}</span>
          {purchase.manual && <span className="badge">Monto corregido</span>}
        </div>
      </div>

      <ul className="chips" aria-label="Números de este comprobante">
        {purchase.numbers.map((n) => (
          <li key={n}>
            <button type="button" className="chip" onClick={() => onOpenTicket(n)}>
              {n}
            </button>
          </li>
        ))}
      </ul>

      {perms.edit && (
        <form className="form amount-form" onSubmit={saveAmount}>
          <AmountField value={amount} onChange={setAmount} auto={purchase.auto} count={count} config={config} />
          {(dirty || purchase.manual) && (
            <div className="form-actions">
              {purchase.manual && !dirty && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAmount('')}>
                  Volver al calculado
                </button>
              )}
              {dirty && (
                <button type="submit" className="btn btn-primary btn-sm">
                  {amount === '' ? `Usar ${formatMoney(purchase.auto)}` : 'Guardar monto'}
                </button>
              )}
            </div>
          )}
        </form>
      )}

      <section className="receipt-section" aria-label="Comprobante">
        <p className="field-label">Comprobante</p>
        {purchase.receipt ? (
          <>
            <ReceiptView
              receipt={purchase.receipt}
              label={`comprobante de ${purchase.payer}`}
              onDownload={onDownloadReceipt && (() => onDownloadReceipt(purchase.id))}
            />
            {!perms.edit ? null : confirm === 'remove' ? (
              <div className="confirm" role="alert">
                <p>¿Quitar el comprobante? La venta y sus números se mantienen.</p>
                <div className="form-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={async () => {
                      await onRemoveReceipt(purchase.id)
                      setConfirm(null)
                    }}
                  >
                    Sí, quitar
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-actions start">
                <ReceiptPicker
                  variant="button"
                  label="Cambiar"
                  onReady={(receipt) => onSetReceipt(purchase.id, receipt)}
                  onError={onError}
                />
                <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => setConfirm('remove')}>
                  Quitar
                </button>
              </div>
            )}
          </>
        ) : perms.edit ? (
          <ReceiptPicker onReady={(receipt) => onSetReceipt(purchase.id, receipt)} onError={onError} />
        ) : (
          <p className="muted">Sin comprobante.</p>
        )}
      </section>

      {perms.canVoid(purchase) && (
        <div className="danger-zone">
          {confirm === 'void' ? (
            <div className="confirm" role="alert">
              <p>
                Se liberan {count === 1 ? 'el número' : 'los números'} <strong>{purchase.numbers.join(', ')}</strong> y se
                borra este comprobante. No se puede deshacer.
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (await onVoid(purchase.id)) onClose()
                  }}
                >
                  Sí, anular
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => setConfirm('void')}>
              Anular venta…
            </button>
          )}
        </div>
      )}
    </div>
  )
}
