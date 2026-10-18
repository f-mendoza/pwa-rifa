import { useState } from 'react'
import { formatBytes } from '../lib/receipt.js'
import { plural, priceFor } from '../lib/format.js'
import { AmountField } from './AmountField.jsx'
import { Dialog } from './Dialog.jsx'
import { PersonForm } from './PersonForm.jsx'
import { ReceiptPicker, ReceiptThumb } from './Receipt.jsx'

export function AssignDialog({ open, numbers, data, onClose, onAssign, onError }) {
  return (
    <Dialog open={open} onClose={onClose} title={`Asignar ${plural(numbers.length, 'número', 'números')}`}>
      <AssignForm numbers={numbers} data={data} onClose={onClose} onAssign={onAssign} onError={onError} />
    </Dialog>
  )
}

function AssignForm({ numbers, data, onClose, onAssign, onError }) {
  const [amount, setAmount] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [processing, setProcessing] = useState(false)
  const auto = priceFor(numbers.length, data.config)

  return (
    <PersonForm
      people={data.people}
      submitLabel="Asignar"
      busy={processing}
      onCancel={onClose}
      onSubmit={(person) => onAssign(numbers, person, { amount: amount === '' ? null : Number(amount), receipt })}
      extra={
        <fieldset className="payment-fields">
          <legend className="field-label">Pago</legend>
          <AmountField value={amount} onChange={setAmount} auto={auto} count={numbers.length} config={data.config} />
          <div className="field">
            <span className="field-label">
              Comprobante <span className="optional">opcional</span>
            </span>
            {receipt ? (
              <div className="receipt-chosen">
                <ReceiptThumb receipt={receipt} size="lg" />
                <span className="receipt-chosen-info">
                  <strong>{receipt.name}</strong>
                  <span className="muted">{formatBytes(receipt.size)} · listo para guardar</span>
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReceipt(null)}>
                  Quitar
                </button>
              </div>
            ) : (
              <ReceiptPicker onReady={setReceipt} onError={onError} onBusy={setProcessing} />
            )}
          </div>
        </fieldset>
      }
    >
      <ul className="chips" aria-label="Números a asignar">
        {numbers.map((n) => (
          <li key={n}>
            <span className="chip is-static">{n}</span>
          </li>
        ))}
      </ul>
    </PersonForm>
  )
}
