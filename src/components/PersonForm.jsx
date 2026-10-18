import { useId, useState } from 'react'
import { personKey } from '../db.js'
import { plural } from '../lib/format.js'

/**
 * Formulario de nombre (obligatorio) + teléfono y correo (opcionales).
 * `people` alimenta el autocompletado y avisa si el nombre ya existe.
 */
export function PersonForm({ initial, people, excludeId, submitLabel, onSubmit, onCancel, children, extra, busy: externalBusy }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
  })
  const [busy, setBusy] = useState(false)
  const listId = useId()

  const key = personKey(form.name)
  const match = key ? people.find((p) => p.key === key && p.id !== excludeId) : null

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit(form)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      {children}
      <label className="field">
        <span className="field-label">
          Nombre <span className="req">obligatorio</span>
        </span>
        <input
          value={form.name}
          onChange={set('name')}
          required
          autoFocus
          data-autofocus
          autoComplete="off"
          list={listId}
          placeholder="Ej: Ana Pérez"
        />
        <datalist id={listId}>
          {people.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        {match && (
          <span className="field-hint is-match">
            {match.name} ya tiene {plural(match.numbers.length, 'número', 'números')}. Se suman a su lista; si dejás el
            contacto vacío se conserva el que ya tenía.
          </span>
        )}
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Teléfono</span>
          <input type="tel" value={form.phone} onChange={set('phone')} inputMode="tel" autoComplete="off" placeholder="221 555 1234" />
        </label>
        <label className="field">
          <span className="field-label">Correo</span>
          <input type="email" value={form.email} onChange={set('email')} autoComplete="off" placeholder="ana@mail.com" />
        </label>
      </div>
      {extra}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={busy || externalBusy || !form.name.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
