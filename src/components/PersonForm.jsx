import { useId, useMemo, useState } from 'react'
import { LIMITS, personKey } from '../db.js'
import { plural } from '../lib/format.js'

/**
 * Formulario de nombre (obligatorio) + teléfono, correo y referido (opcionales).
 * `people` alimenta el autocompletado (nombres y referidos) y avisa si el nombre ya existe.
 */
export function PersonForm({ initial, people, excludeId, submitLabel, onSubmit, onCancel, children, extra, busy: externalBusy }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    referrer: initial?.referrer ?? '',
  })
  const [busy, setBusy] = useState(false)
  const listId = useId()
  const referrerListId = useId()

  // Referidos ya usados, sin repetir aunque estén escritos distinto.
  const referrers = useMemo(() => {
    const byKey = new Map()
    for (const p of people) if (p.referrer && !byKey.has(personKey(p.referrer))) byKey.set(personKey(p.referrer), p.referrer)
    return [...byKey.values()].sort((a, b) => a.localeCompare(b, 'es'))
  }, [people])

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
          maxLength={LIMITS.name}
          enterKeyHint="next"
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
            contacto o el referido vacíos se conserva lo que ya tenía.
          </span>
        )}
      </label>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Teléfono</span>
          <input
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            inputMode="tel"
            autoComplete="off"
            maxLength={LIMITS.phone}
            placeholder="221 555 1234"
          />
        </label>
        <label className="field">
          <span className="field-label">Correo</span>
          <input
            type="email"
            value={form.email}
            onChange={set('email')}
            autoComplete="off"
            autoCapitalize="none"
            maxLength={LIMITS.email}
            placeholder="ana@mail.com"
          />
        </label>
      </div>
      <label className="field">
        <span className="field-label">Referido</span>
        <input
          value={form.referrer}
          onChange={set('referrer')}
          autoComplete="off"
          maxLength={LIMITS.referrer}
          enterKeyHint="done"
          list={referrerListId}
          placeholder="Quién lo sumó, ej: Manu"
        />
        <datalist id={referrerListId}>
          {referrers.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </label>
      {extra}
      <div className="form-actions">
        {onCancel && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancelar
          </button>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || externalBusy || !form.name.trim()}
          aria-busy={busy || undefined}
        >
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
