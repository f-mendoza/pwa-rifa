import { useEffect, useState } from 'react'
import { db } from '../db.js'
import { useSession } from '../hooks/useSession.js'
import { friendlyError } from '../lib/errors.js'
import { ROLE_LABELS } from '../lib/permissions.js'
import { downloadRaffle } from '../sync/index.js'
import { errorKind } from '../sync/session.js'
import { AccountForms } from './Account.jsx'
import { Dialog } from './Dialog.jsx'

/**
 * Pantalla del link de invitación (`/invitacion/:token`): muestra la rifa, el rol y quién
 * invita; pide iniciar sesión o crear una cuenta si hace falta; acepta, descarga la rifa y la
 * abre. `onClose` limpia la dirección.
 */
export function InvitationDialog({ token, onClose, notify }) {
  return (
    <Dialog open={Boolean(token)} onClose={onClose} title="Invitación">
      {token && <InvitationBody key={token} token={token} onClose={onClose} notify={notify} />}
    </Dialog>
  )
}

function InvitationBody({ token, onClose, notify }) {
  const { session, user } = useSession()
  const [info, setInfo] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('register')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!session) return undefined
    let alive = true
    session
      .request('ver la invitación', (api) => api.getInvitation(token))
      .then((found) => alive && setInfo(found))
      .catch((err) => alive && setLoadError(friendlyError(err)))
    return () => {
      alive = false
    }
  }, [session, token, attempt])

  if (!session) return <p className="muted">La nube no está disponible en esta versión de la app.</p>

  if (loadError) {
    return (
      <div className="invitation">
        <p className="error" role="alert">
          {loadError}
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setLoadError(null)
              setAttempt((n) => n + 1)
            }}
          >
            Reintentar
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Ir a mis rifas
          </button>
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <p className="muted" role="status">
        Buscando la invitación…
      </p>
    )
  }

  const what =
    info.role === 'seller' ? 'para vender números de esta rifa' : 'para ver esta rifa (sin poder hacer cambios)'

  async function accept() {
    setError(null)
    setBusy(true)
    try {
      const local = await db.raffles.get(info.raffleId)
      if (local?.remote?.userId != null && local.remote.userId !== user.id) {
        throw new Error('Esta rifa ya está en este teléfono con otra cuenta. Iniciá sesión con esa cuenta para abrirla.')
      }
      const { raffleId } = await session.request('aceptar la invitación', (api) => api.acceptInvitation(token))
      await downloadRaffle(raffleId, session.transport(), { activate: true })
      notify(`Te sumaste a «${info.raffleTitle || 'Rifa'}»`, 'success')
      onClose()
    } catch (err) {
      setError({ message: friendlyError(err), otherAccount: errorKind(err) === 'forbidden' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="invitation">
      <div className="invitation-head">
        <p className="invitation-title">{info.raffleTitle || 'Rifa'}</p>
        <p>
          {info.invitedBy ? <strong>{info.invitedBy}</strong> : 'Te'} {info.invitedBy ? 'te invitó' : 'invitaron'} {what}.
        </p>
        <span className="badge">{ROLE_LABELS[info.role] ?? info.role}</span>
      </div>

      {info.expired ? (
        <p className="error" role="alert">
          Esta invitación venció. Pedile a quien organiza que te mande otra.
        </p>
      ) : !user ? (
        <AccountForms
          key={mode}
          mode={mode}
          onModeChange={setMode}
          notify={notify}
          intro={
            <p className="muted">
              Para sumarte necesitás una cuenta. {mode === 'register' ? 'Si ya tenés, iniciá sesión.' : ''}
            </p>
          }
        />
      ) : (
        <>
          {info.accepted && (
            <p className="form-note">Esta invitación ya se usó. Si la aceptaste vos, tocá «Abrir la rifa».</p>
          )}
          <p className="muted">
            Vas a entrar como <strong>{user.name}</strong> ({user.email}).
          </p>
          {error && (
            <p className="error" role="alert">
              {error.message}
            </p>
          )}
          <div className="form-actions wrap">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => {
                await session.logout()
                setError(null)
                setMode('login')
              }}
            >
              Usar otra cuenta
            </button>
            <button type="button" className="btn btn-primary" onClick={accept} disabled={busy}>
              {busy ? 'Entrando…' : info.accepted ? 'Abrir la rifa' : 'Aceptar invitación'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
