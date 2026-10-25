import { useState } from 'react'
import { formatMoney, plural, saleLabel } from '../lib/format.js'
import { permissionsFor } from '../lib/permissions.js'
import { ContactLinks } from './ContactLinks.jsx'
import { Dialog } from './Dialog.jsx'
import { ReceiptThumb } from './Receipt.jsx'
import { PersonForm } from './PersonForm.jsx'

/** Detalle de un número tomado: ver dueño, editar sus datos, pasarlo a otra persona o liberarlo. */
export function TicketDialog({ number, data, onClose, onOpenTicket, onOpenPurchase, onUpdatePerson, onTransfer, onRelease }) {
  const open = number != null
  const ticket = open ? data.ticketByNumber.get(number) : null
  const person = ticket ? data.peopleById.get(ticket.participantId) : null
  const purchase = ticket ? data.purchaseById.get(ticket.purchaseId) : null

  return (
    <Dialog open={open && Boolean(person)} onClose={onClose} title={`Número ${number ?? ''}`}>
      {person && (
        <TicketBody
          key={number}
          number={number}
          person={person}
          purchase={purchase}
          people={data.people}
          perms={permissionsFor(data)}
          onClose={onClose}
          onOpenTicket={onOpenTicket}
          onOpenPurchase={onOpenPurchase}
          onUpdatePerson={onUpdatePerson}
          onTransfer={onTransfer}
          onRelease={onRelease}
        />
      )}
    </Dialog>
  )
}

function TicketBody({ number, person, purchase, people, perms, onClose, onOpenTicket, onOpenPurchase, onUpdatePerson, onTransfer, onRelease }) {
  const [mode, setMode] = useState('view')
  const others = person.numbers.filter((n) => n !== number)

  if (mode === 'edit') {
    return (
      <PersonForm
        initial={person}
        people={people}
        excludeId={person.id}
        submitLabel="Guardar datos"
        onCancel={() => setMode('view')}
        onSubmit={async (form) => {
          if (await onUpdatePerson(person.id, form)) setMode('view')
        }}
      >
        <p className="form-note">
          Los cambios se aplican a {plural(person.numbers.length, 'su número', 'sus números')}.
        </p>
      </PersonForm>
    )
  }

  if (mode === 'transfer') {
    return (
      <PersonForm
        people={people}
        excludeId={person.id}
        submitLabel={`Pasar el ${number}`}
        onCancel={() => setMode('view')}
        onSubmit={async (form) => {
          if (await onTransfer(number, form)) setMode('view')
        }}
      >
        <p className="form-note">
          El número {number} deja de ser de {person.name} y pasa a la persona que indiques.
        </p>
      </PersonForm>
    )
  }

  return (
    <div className="ticket">
      <div className="ticket-hero">
        <span className="ticket-number">{number}</span>
        <div>
          <p className="ticket-name">{person.name}</p>
          <p className="muted">
            {plural(person.numbers.length, 'número', 'números')}
            {person.referrer && ` · referido por ${person.referrer}`}
          </p>
        </div>
      </div>

      <ContactLinks person={person} />

      {purchase && (
        <button type="button" className="purchase-link" onClick={() => onOpenPurchase(purchase.id)}>
          <ReceiptThumb receipt={purchase.receipt} size="sm" />
          <span>
            <strong>Comprobante {saleLabel(purchase)}</strong>
            <span className="muted">
              {purchase.payer !== person.name && `Pagó ${purchase.payer} · `}
              {formatMoney(purchase.total)} · {purchase.receipt ? 'con comprobante' : 'sin comprobante'}
            </span>
          </span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}

      {others.length > 0 && (
        <div className="chips-block">
          <p className="field-label">También tiene</p>
          <ul className="chips">
            {others.map((n) => (
              <li key={n}>
                <button type="button" className="chip" onClick={() => onOpenTicket(n)}>
                  {n}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'confirm-release' ? (
        <div className="confirm" role="alert">
          <p>
            ¿Liberar el número <strong>{number}</strong>? Vuelve a quedar disponible.
            {purchase?.numbers.length === 1 && ' Era el único número de su comprobante, que también se borra.'}
            {purchase?.manual && purchase.numbers.length > 1 && ' Su comprobante tiene un monto corregido: revisalo después.'}
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setMode('view')}>
              No, dejarlo
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                if (await onRelease(number)) onClose()
              }}
            >
              Sí, liberar
            </button>
          </div>
        </div>
      ) : perms.edit ? (
        <div className="form-actions wrap">
          {perms.canChangeNumber(number) && (
            <>
              <button type="button" className="btn btn-ghost danger-text" onClick={() => setMode('confirm-release')}>
                Liberar número
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setMode('transfer')}>
                Pasar a otra persona
              </button>
            </>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setMode('edit')}>
            Editar datos
          </button>
        </div>
      ) : null}
      {perms.edit && !perms.canChangeNumber(number) && (
        <p className="field-hint">Este número está fuera de tu talonario: no lo podés liberar ni pasar a otra persona.</p>
      )}
    </div>
  )
}
