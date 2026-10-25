import { useState } from 'react'
import { useOnline } from '../hooks/usePwa.js'
import { formatDateTime } from '../lib/format.js'
import { describeConflict, describeSyncState } from '../sync/status.js'
import { Dialog } from './Dialog.jsx'

const ICONS = {
  ok: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  pending: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  offline: <path d="M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4.2-2.4M12 20h.01M19 13a10 10 0 0 0-2.2-1.6M2 9.5a15 15 0 0 1 4.3-2.7M22 9.5A15 15 0 0 0 10.6 5.6" />,
  warn: <path d="M12 8v5M12 16.5v.5M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.5" />
    </>
  ),
}

/**
 * Estado de sincronización de la rifa abierta. Sólo se muestra en rifas en la nube: en una rifa
 * local `sync` es null y no aparece nada. Ofrece lo que corresponde a cada estado: iniciar sesión,
 * ver los miembros, o (si se borró o se perdió el acceso) guardar una copia local o quitarla.
 */
export function SyncStatus({ sync, onDismissConflicts, onLogin, onOpenMembers, onSaveCopy, onRemove }) {
  const online = useOnline()
  const [open, setOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!sync) return null
  const state = describeSyncState(sync, { online })
  const conflicts = sync.conflicts
  const lost = sync.status === 'deleted' || sync.status === 'revoked'

  return (
    <div className="sync-bar">
      <p className={`sync-state is-${state.tone}`} role="status">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {ICONS[state.tone]}
        </svg>
        <span>
          {state.label}
          {state.detail && <span className="sync-detail"> · {state.detail}</span>}
        </span>
      </p>
      {sync.needsLogin && !sync.otherAccount && !lost && onLogin && (
        <button type="button" className="btn btn-primary btn-sm" onClick={onLogin}>
          Iniciar sesión
        </button>
      )}
      {!lost && onOpenMembers && (
        <button type="button" className="btn btn-ghost btn-sm sync-members" onClick={onOpenMembers} aria-haspopup="dialog">
          Miembros
        </button>
      )}
      {lost && onSaveCopy && (
        <div className="sync-lost">
          {confirmRemove ? (
            <div className="confirm" role="alert">
              <p>¿Quitarla de este teléfono? Se borran sus datos de acá y no se puede deshacer.</p>
              <div className="form-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={async () => {
                    if (!(await onRemove())) setConfirmRemove(false)
                  }}
                >
                  Sí, quitar
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="muted">Podés guardar una copia local para seguir usándola en este teléfono.</p>
              <div className="form-actions wrap start">
                <button type="button" className="btn btn-secondary btn-sm" onClick={onSaveCopy}>
                  Guardar copia local
                </button>
                <button type="button" className="btn btn-ghost btn-sm danger-text" onClick={() => setConfirmRemove(true)}>
                  Quitar del dispositivo
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {conflicts.length > 0 && (
        <button type="button" className="sync-conflicts" onClick={() => setOpen(true)} aria-haspopup="dialog">
          Hay conflictos
          <span className="count">{conflicts.length}</span>
        </button>
      )}

      <Dialog open={open && conflicts.length > 0} onClose={() => setOpen(false)} title="Conflictos">
        <div className="conflicts">
          <p className="muted">
            Estos cambios hechos en este teléfono no se pudieron guardar en la nube y se deshicieron acá. Lo que ves en la
            rifa ya es lo que quedó guardado.
          </p>
          <ul className="conflict-list">
            {conflicts.map((c) => (
              <li key={c.id} className="conflict">
                <strong>{describeConflict(c)}</strong>
                <span>{c.message}</span>
                <small className="muted">{formatDateTime(c.createdAt)}</small>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                if (await onDismissConflicts()) setOpen(false)
              }}
            >
              Entendido
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
