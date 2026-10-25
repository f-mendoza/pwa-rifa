import { useCallback, useEffect, useId, useState } from 'react'
import { useOnline } from '../hooks/usePwa.js'
import { useSession } from '../hooks/useSession.js'
import { friendlyError } from '../lib/errors.js'
import { formatDate, plural } from '../lib/format.js'
import { ROLE_HINTS, ROLE_LABELS, permissionsFor } from '../lib/permissions.js'
import { invitationLink, invitationMessage } from '../lib/invitations.js'
import { formatRanges, parseRanges, rangeSize } from '../lib/ranges.js'
import { copyText, shareText } from '../lib/share.js'
import { Dialog } from './Dialog.jsx'

/**
 * Miembros de una rifa en la nube. La lista la ven todos los roles; invitar, cambiar roles,
 * asignar talonarios y quitar miembros es sólo de quien organiza. Quien no organiza puede salir.
 */
export function MembersDialog({ open, data, onClose, notify, onLeave, onLogin }) {
  return (
    <Dialog open={open} onClose={onClose} title="Miembros">
      {open && data.raffle.remote && <MembersBody data={data} notify={notify} onLeave={onLeave} onLogin={onLogin} />}
    </Dialog>
  )
}

function MembersBody({ data, notify, onLeave, onLogin }) {
  const { session, user } = useSession()
  const online = useOnline()
  const perms = permissionsFor(data)
  const raffleId = data.raffle.id
  const title = data.config.title || 'Rifa'
  const [members, setMembers] = useState(null)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null)
  const [leaving, setLeaving] = useState(false)
  const canLoad = Boolean(session && user && perms.status === 'active' && !perms.otherAccount)

  const load = useCallback(
    () =>
      session.request('ver los miembros', (api) => api.listMembers(raffleId)).then(
        (found) => {
          setMembers(found)
          setError(null)
        },
        (err) => setError(friendlyError(err)),
      ),
    [session, raffleId],
  )

  useEffect(() => {
    // Primera carga al abrir; si no hay sesión o conexión, se explica abajo.
    if (canLoad && online) load()
  }, [canLoad, online, load])

  function replace(member) {
    setMembers((list) => list.map((m) => (m.userId === member.userId ? member : m)))
  }

  if (!session || !user) {
    return (
      <div className="members">
        <p className="muted">Para ver quiénes participan de esta rifa iniciá sesión con tu cuenta.</p>
        {session && (
          <div className="form-actions start">
            <button type="button" className="btn btn-primary" onClick={onLogin}>
              Iniciar sesión
            </button>
          </div>
        )}
      </div>
    )
  }
  if (!canLoad) {
    return (
      <p className="muted">
        {perms.otherAccount
          ? 'Esta rifa es de otra cuenta: iniciá sesión con esa cuenta para ver sus miembros.'
          : 'Esta rifa ya no está disponible en la nube.'}
      </p>
    )
  }

  return (
    <div className="members">
      {!online && !members && <p className="muted">Sin conexión: para ver los miembros necesitás internet.</p>}
      {error && (
        <div className="notice-inline" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            Reintentar
          </button>
        </div>
      )}
      {online && !members && !error && (
        <p className="muted" role="status">
          Cargando…
        </p>
      )}

      {members && (
        <ul className="member-list" aria-label="Personas en la rifa">
          {members.map((m) => {
            const isMe = m.userId === user.id
            const canEdit = perms.manageMembers && m.role !== 'owner'
            return (
              <li key={m.userId} className="member">
                <div className="member-row">
                  <span className="avatar" aria-hidden="true">
                    {(m.name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="member-main">
                    <strong>
                      {m.name}
                      {isMe && <span className="muted"> (vos)</span>}
                    </strong>
                    <span className="muted member-email">{m.email}</span>
                    <span className="member-meta">
                      <span className="badge">{ROLE_LABELS[m.role] ?? m.role}</span>
                      {m.role === 'seller' && (
                        <span className="muted">
                          {m.ranges?.length
                            ? `Talonario: ${formatRanges(m.ranges)} (${plural(rangeSize(m.ranges), 'número', 'números')})`
                            : 'Sin talonario: puede vender cualquier número'}
                        </span>
                      )}
                    </span>
                  </span>
                  {canEdit && editing !== m.userId && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditing(m.userId)}
                      aria-label={`Editar a ${m.name}`}
                    >
                      Editar
                    </button>
                  )}
                </div>
                {canEdit && editing === m.userId && (
                  <MemberEditor
                    member={m}
                    max={data.config.total}
                    onCancel={() => setEditing(null)}
                    onSave={async (patch) => {
                      try {
                        const updated = await session.request('guardar los cambios', (api) => api.updateMember(raffleId, m.userId, patch))
                        replace(updated)
                        setEditing(null)
                        notify(`Cambios de ${m.name} guardados`, 'success')
                      } catch (err) {
                        notify(friendlyError(err), 'error')
                      }
                    }}
                    onRemove={async () => {
                      try {
                        await session.request('quitar a esa persona', (api) => api.removeMember(raffleId, m.userId))
                        setMembers((list) => list.filter((x) => x.userId !== m.userId))
                        setEditing(null)
                        notify(`${m.name} ya no está en la rifa`, 'success')
                      } catch (err) {
                        notify(friendlyError(err), 'error')
                      }
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}

      {perms.manageMembers && <InviteForm raffleId={raffleId} title={title} notify={notify} />}

      {!perms.owner && (
        <div className="danger-zone">
          {leaving ? (
            <div className="confirm" role="alert">
              <p>
                ¿Salir de «{title}»? Dejás de verla y se quita de este teléfono. Para volver, te tienen que invitar de nuevo.
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setLeaving(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (!(await onLeave())) setLeaving(false)
                  }}
                >
                  Sí, salir
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost danger-text" onClick={() => setLeaving(true)}>
              Salir de la rifa…
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function RoleChoice({ value, onChange, name }) {
  return (
    <fieldset className="choice">
      <legend className="field-label">Rol</legend>
      <div className="choice-options">
        {['seller', 'viewer'].map((role) => (
          <label key={role} className="choice-option">
            <input type="radio" name={name} value={role} checked={value === role} onChange={() => onChange(role)} />
            <span>
              <strong>{ROLE_LABELS[role]}</strong>
              <small>{ROLE_HINTS[role]}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function MemberEditor({ member, max, onSave, onCancel, onRemove }) {
  const name = useId()
  const [role, setRole] = useState(member.role)
  const [text, setText] = useState(formatRanges(member.ranges))
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const parsed = parseRanges(text, { max })

  async function submit(e) {
    e.preventDefault()
    if (role === 'seller' && parsed.error) return
    setBusy(true)
    try {
      await onSave(role === 'seller' ? { role, ranges: parsed.ranges } : { role })
    } finally {
      setBusy(false)
    }
  }

  if (confirm) {
    return (
      <div className="confirm" role="alert">
        <p>
          ¿Quitar a {member.name} de la rifa? Deja de verla y no puede vender más. Lo que ya vendió queda guardado.
        </p>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onRemove()
              } finally {
                setBusy(false)
              }
            }}
          >
            Sí, quitar
          </button>
        </div>
      </div>
    )
  }

  return (
    <form className="form member-editor" onSubmit={submit}>
      <RoleChoice value={role} onChange={setRole} name={name} />
      {role === 'seller' && (
        <label className="field">
          <span className="field-label">Talonario</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Ej: 1-100, 201-250"
            inputMode="text"
            autoComplete="off"
            aria-invalid={Boolean(parsed.error) || undefined}
          />
          {parsed.error ? (
            <span className="field-hint error" role="alert">
              {parsed.error}
            </span>
          ) : (
            <span className="field-hint">
              {parsed.ranges
                ? `Puede vender ${plural(rangeSize(parsed.ranges), 'número', 'números')}: ${formatRanges(parsed.ranges)}.`
                : 'Vacío: puede vender cualquier número.'}
            </span>
          )}
        </label>
      )}
      <div className="form-actions wrap">
        <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirm(true)}>
          Quitar de la rifa
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || (role === 'seller' && Boolean(parsed.error))}>
          Guardar
        </button>
      </div>
    </form>
  )
}

function InviteForm({ raffleId, title, notify }) {
  const { session } = useSession()
  const name = useId()
  const [role, setRole] = useState('seller')
  const [invitation, setInvitation] = useState(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      const created = await session.request('crear la invitación', (api) => api.createInvitation(raffleId, { role }))
      setInvitation({ ...created, link: invitationLink(created.token) })
    } catch (err) {
      notify(friendlyError(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const message = invitation && invitationMessage(title, invitation.role, invitation.link)

  return (
    <section className="invite" aria-labelledby={`${name}-title`}>
      <h3 id={`${name}-title`} className="field-label invite-title">
        Invitar a alguien
      </h3>
      <RoleChoice
        value={role}
        name={name}
        onChange={(next) => {
          setRole(next)
          setInvitation(null)
        }}
      />
      {invitation ? (
        <div className="invite-link">
          <label className="field">
            <span className="field-label">Link de invitación ({ROLE_LABELS[invitation.role].toLowerCase()})</span>
            <input readOnly value={invitation.link} onFocus={(e) => e.target.select()} />
            <span className="field-hint">
              Sirve para una sola persona y vence el {formatDate(invitation.expiresAt)}.
            </span>
          </label>
          <div className="form-actions wrap start">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={async () => {
                try {
                  await copyText(invitation.link)
                  notify('Link copiado', 'success')
                } catch {
                  notify('No se pudo copiar. Mantené apretado el link para copiarlo.', 'error')
                }
              }}
            >
              Copiar link
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await shareText(message, { title: `Rifa «${title}»` })
                } catch (err) {
                  notify(friendlyError(err), 'error')
                }
              }}
            >
              Compartir por WhatsApp
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={create} disabled={busy}>
            Crear otro link
          </button>
        </div>
      ) : (
        <div className="form-actions start">
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? 'Creando…' : 'Crear link de invitación'}
          </button>
        </div>
      )}
    </section>
  )
}
