import { useCallback, useEffect, useRef, useState } from 'react'
import { createCloudRaffle, createRaffle, importBackup, removeRaffleLocally, saveLocalCopy, setActiveRaffle } from '../db.js'
import { useOnline } from '../hooks/usePwa.js'
import { useRaffleList } from '../hooks/useRaffle.js'
import { useSession } from '../hooks/useSession.js'
import { friendlyError } from '../lib/errors.js'
import { formatDate, formatMoney, plural } from '../lib/format.js'
import { ROLE_LABELS } from '../lib/permissions.js'
import { downloadRaffle } from '../sync/index.js'
import { CloudPrivacyNote } from './Account.jsx'
import { Dialog } from './Dialog.jsx'

/**
 * "Mis rifas": cambiar de rifa, crear una nueva (local o en la nube), restaurar un respaldo como
 * rifa local nueva y bajar las rifas que otras personas compartieron con la cuenta.
 */
export function RafflesDialog({ open, current, run, notify, onClose, onOpenAccount }) {
  return (
    <Dialog open={open} onClose={onClose} title="Mis rifas">
      <RafflesBody current={current} run={run} notify={notify} onClose={onClose} onOpenAccount={onOpenAccount} />
    </Dialog>
  )
}

function RafflesBody({ current, run, notify, onClose, onOpenAccount }) {
  // Sólo se consulta mientras la lista está abierta: recorre los números de todas las rifas.
  const raffles = useRaffleList()
  const { user } = useSession()
  const [creating, setCreating] = useState(false)
  const fileRef = useRef(null)

  async function open(id) {
    if (id === current.raffle.id || (await run(() => setActiveRaffle(id)))) onClose()
  }

  async function restore(file) {
    const ok = await run(
      async () => {
        let parsed
        try {
          parsed = JSON.parse(await file.text())
        } catch {
          throw new Error('El archivo no es un respaldo válido')
        }
        return importBackup(parsed)
      },
      (r) =>
        `Rifa «${r.title || 'Rifa'}» restaurada: ${plural(r.tickets, 'número', 'números')}, ${plural(r.participants, 'persona', 'personas')}, ${plural(r.receipts, 'comprobante adjunto', 'comprobantes adjuntos')}`,
    )
    if (ok) onClose()
  }

  if (!raffles) return null
  const active = raffles.filter((r) => !r.archivedAt)
  const archived = raffles.filter((r) => r.archivedAt)
  const list = (items) => (
    <ul className="raffle-list">
      {items.map((r) => (
        <li key={r.id}>
          <RaffleItem raffle={r} user={user} isCurrent={r.id === current.raffle.id} onOpen={() => open(r.id)} run={run} />
        </li>
      ))}
    </ul>
  )

  return (
    <div className="raffles">
      <AccountLine user={user} onOpenAccount={onOpenAccount} />

      {active.length > 0 ? list(active) : <p className="muted">Todas tus rifas están archivadas.</p>}

      {creating ? (
        <NewRaffleForm
          currentTitle={current.config.title || 'Rifa'}
          user={user}
          onLogin={() => onOpenAccount('login')}
          onCancel={() => setCreating(false)}
          onCreate={async ({ title, copy, where, transport }) => {
            const copyFrom = copy ? current.raffle.id : undefined
            const ok = await run(
              () => (where === 'cloud' ? createCloudRaffle({ title, copyFrom }, transport) : createRaffle({ title, copyFrom })),
              where === 'cloud' ? `Rifa «${title || 'Rifa'}» creada en la nube` : `Rifa «${title || 'Rifa'}» creada`,
            )
            if (ok) onClose()
          }}
        />
      ) : (
        <div className="form-actions wrap start">
          <button type="button" className="btn btn-secondary" onClick={() => setCreating(true)}>
            + Nueva rifa
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current.click()}>
            Restaurar respaldo…
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files[0]
              e.target.value = ''
              if (file) restore(file)
            }}
          />
        </div>
      )}
      <p className="field-hint">Restaurar un respaldo lo agrega como una rifa local más: no reemplaza ninguna.</p>

      {user && <SharedWithMe localIds={new Set(raffles.map((r) => r.id))} notify={notify} onDownloaded={onClose} />}

      {archived.length > 0 && (
        <details className="raffle-archived">
          <summary>
            Archivadas <span className="count">{archived.length}</span>
          </summary>
          {list(archived)}
        </details>
      )}
    </div>
  )
}

/** Quién tiene la sesión (o cómo iniciarla). La cuenta sólo hace falta para las rifas en la nube. */
function AccountLine({ user, onOpenAccount }) {
  const { session } = useSession()
  if (!session) return null
  if (user) {
    return (
      <div className="account-line">
        <span className="muted">
          Cuenta: <strong>{user.name}</strong>
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenAccount('account')}>
          Ver cuenta
        </button>
      </div>
    )
  }
  return (
    <div className="account-line">
      <span className="muted">Sin cuenta: tus rifas locales no la necesitan.</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenAccount('login')}>
        Iniciar sesión
      </button>
    </div>
  )
}

function statusLabel(raffle, user) {
  const remote = raffle.remote
  if (!remote) return null
  if (remote.status === 'deleted') return 'Se borró de la nube'
  if (remote.status === 'revoked') return 'Ya no tenés acceso'
  if (user && remote.userId != null && remote.userId !== user.id) return 'De otra cuenta'
  return null
}

function RaffleItem({ raffle, user, isCurrent, onOpen, run }) {
  const remote = raffle.remote
  const status = statusLabel(raffle, user)
  const lost = remote && (remote.status === 'deleted' || remote.status === 'revoked')
  const [confirm, setConfirm] = useState(false)
  const name = raffle.title || 'Rifa'
  return (
    <div className="raffle-entry">
      <button
        type="button"
        className={`raffle-item ${isCurrent ? 'is-current' : ''}`}
        onClick={onOpen}
        aria-current={isCurrent || undefined}
      >
        <span className="raffle-item-main">
          <span className="raffle-item-name">{name}</span>
          <span className="raffle-item-stats">
            {raffle.taken} de {raffle.total} vendidos · {formatMoney(raffle.revenue)}
          </span>
          <span className="raffle-item-tags">
            {remote ? (
              <span className="badge is-cloud">
                <CloudIcon />
                En la nube{remote.role && remote.role !== 'owner' ? ` · ${ROLE_LABELS[remote.role]}` : ''}
              </span>
            ) : (
              <span className="badge is-local">Local</span>
            )}
            {status && <span className="badge warn">{status}</span>}
            <span className="muted">Creada el {formatDate(raffle.createdAt)}</span>
          </span>
        </span>
        {isCurrent && <span className="badge">Abierta</span>}
      </button>
      {lost && (
        <div className="raffle-lost">
          {confirm ? (
            <div className="confirm" role="alert">
              <p>
                ¿Quitar «{name}» de este teléfono? Se borran sus datos de acá y no se puede deshacer. Si querés conservarla,
                guardá antes una copia local.
              </p>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirm(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (!(await run(() => removeRaffleLocally(raffle.id), `Rifa «${name}» quitada del dispositivo`))) setConfirm(false)
                  }}
                >
                  Sí, quitar
                </button>
              </div>
            </div>
          ) : (
            <div className="form-actions wrap start">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() =>
                  run(
                    () => saveLocalCopy(raffle.id, { title: name }),
                    (r) =>
                      r.missingFiles
                        ? `Copia local guardada (${plural(r.missingFiles, 'comprobante quedó', 'comprobantes quedaron')} afuera porque nunca se descargaron)`
                        : 'Copia local guardada',
                  )
                }
              >
                Guardar copia local
              </button>
              <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => setConfirm(true)}>
                Quitar del dispositivo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon-cloud">
      <path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z" />
    </svg>
  )
}

/** Las rifas en la nube de la cuenta que todavía no están en este teléfono. */
function SharedWithMe({ localIds, notify, onDownloaded }) {
  const { session } = useSession()
  const online = useOnline()
  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = useCallback(
    () =>
      session.request('ver tus rifas en la nube', (api) => api.listRaffles()).then(
        (found) => {
          setList(found)
          setError(null)
        },
        (err) => setError(friendlyError(err)),
      ),
    [session],
  )

  useEffect(() => {
    if (online) load()
  }, [online, load])

  const missing = (list ?? []).filter((r) => !r.deleted && !localIds.has(r.id))
  if (!error && missing.length === 0) return null

  return (
    <section className="shared" aria-labelledby="shared-title">
      <h3 id="shared-title" className="field-label">
        Compartidas conmigo
      </h3>
      {error ? (
        <div className="notice-inline" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={load}>
            Reintentar
          </button>
        </div>
      ) : (
        <ul className="raffle-list">
          {missing.map((r) => (
            <li key={r.id} className="shared-item">
              <span className="raffle-item-main">
                <span className="raffle-item-name">{r.title || 'Rifa'}</span>
                <span className="muted">
                  {r.role === 'owner' ? 'Tuya' : `De ${r.ownerName || 'otra persona'}`} · {ROLE_LABELS[r.role] ?? r.role}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy === r.id}
                aria-label={`Descargar ${r.title || 'Rifa'}`}
                onClick={async () => {
                  setBusy(r.id)
                  try {
                    await downloadRaffle(r.id, session.transport(), { activate: true })
                    notify(`Rifa «${r.title || 'Rifa'}» descargada`, 'success')
                    onDownloaded()
                  } catch (err) {
                    notify(friendlyError(err), 'error')
                  } finally {
                    setBusy(null)
                  }
                }}
              >
                {busy === r.id ? 'Descargando…' : 'Descargar'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function NewRaffleForm({ currentTitle, user, onLogin, onCancel, onCreate }) {
  const { session } = useSession()
  const online = useOnline()
  const [title, setTitle] = useState('')
  const [copy, setCopy] = useState(true)
  const [where, setWhere] = useState('local')
  const [busy, setBusy] = useState(false)
  const cloud = where === 'cloud'
  const blocked = cloud && (!user || !online)

  return (
    <form
      className="form raffle-new"
      onSubmit={async (e) => {
        e.preventDefault()
        if (blocked) return
        setBusy(true)
        await onCreate({ title: title.trim(), copy, where, transport: cloud ? session?.transport() : null })
        setBusy(false)
      }}
    >
      <label className="field">
        <span className="field-label">Nombre de la rifa nueva</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={40} placeholder="Rifa" required data-autofocus autoFocus />
      </label>
      {session && (
        <fieldset className="choice">
          <legend className="field-label">Dónde se guarda</legend>
          <div className="choice-options">
            <label className="choice-option">
              <input type="radio" name="raffle-where" value="local" checked={!cloud} onChange={() => setWhere('local')} />
              <span>
                <strong>Local</strong>
                <small>Sólo en este teléfono. Funciona sin cuenta y sin internet.</small>
              </span>
            </label>
            <label className="choice-option">
              <input type="radio" name="raffle-where" value="cloud" checked={cloud} onChange={() => setWhere('cloud')} />
              <span>
                <strong>En la nube</strong>
                <small>Para venderla entre varias personas. Necesita cuenta e internet.</small>
              </span>
            </label>
          </div>
        </fieldset>
      )}
      {cloud && (
        <>
          <p className="form-note">
            No se puede cambiar después: una rifa local no pasa a la nube ni una de la nube pasa a ser local (sí podés
            guardar una copia local).
          </p>
          {!user ? (
            <div className="notice-inline">
              <p>Para crear una rifa en la nube iniciá sesión o creá una cuenta.</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={onLogin}>
                Iniciar sesión
              </button>
            </div>
          ) : (
            !online && <p className="error">Sin conexión: para crear una rifa en la nube necesitás internet.</p>
          )}
          <CloudPrivacyNote />
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
        <span>
          Copiar precios, premios e imagen de «{currentTitle}»
          <small>Sin sus ventas ni participantes.</small>
        </span>
      </label>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || blocked}>
          {busy && cloud ? 'Creando…' : 'Crear rifa'}
        </button>
      </div>
    </form>
  )
}
