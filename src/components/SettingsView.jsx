import { useEffect, useRef, useState } from 'react'
import { MAX_TOTAL } from '../db.js'
import { requestPersistence } from '../hooks/usePwa.js'
import { useSession } from '../hooks/useSession.js'
import { plural } from '../lib/format.js'
import { ROLE_HINTS, ROLE_LABELS, deleteKind, permissionsFor } from '../lib/permissions.js'
import { formatRanges } from '../lib/ranges.js'
import { THEMES } from '../lib/themes.js'
import { AccountPanel } from './Account.jsx'
import { ThemeSwatch } from './Swatches.jsx'

// Un campo vacío queda vacío mientras se escribe (si no, borrar "300" dejaba un 0 pegado).
const toInt = (value) => {
  if (value === '') return ''
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : ''
}

export function SettingsView({
  data,
  notify,
  onSaveConfig,
  onSaveAppearance,
  onExport,
  onImportBackup,
  onArchive,
  onDelete,
  onSaveCopy,
  onOpenMembers,
  onOpenAccount,
}) {
  const perms = permissionsFor(data)
  return (
    <div className="settings">
      {perms.cloud && <CloudPanel data={data} perms={perms} onOpenMembers={onOpenMembers} />}
      <ConfigForm key={JSON.stringify(data.config)} config={data.config} onSave={onSaveConfig} readOnly={!perms.config} />
      <AppearancePanel appearance={data.appearance} onChange={onSaveAppearance} />
      <AccountSection notify={notify} onOpenAccount={onOpenAccount} />
      <DataPanel
        data={data}
        perms={perms}
        onExport={onExport}
        onImportBackup={onImportBackup}
        notify={notify}
        onArchive={onArchive}
        onDelete={onDelete}
        onSaveCopy={onSaveCopy}
      />
    </div>
  )
}

/** Rifa en la nube: tu rol, tu talonario y los miembros. */
function CloudPanel({ data, perms, onOpenMembers }) {
  const lost = perms.status !== 'active'
  return (
    <section className="panel" aria-labelledby="cloud-title">
      <h2 id="cloud-title" className="section-title">
        En la nube
      </h2>
      {lost ? (
        <p className="muted">
          {perms.status === 'deleted'
            ? 'Esta rifa se borró de la nube. Podés guardar una copia local para seguir usándola acá.'
            : 'Ya no tenés acceso a esta rifa en la nube. Podés guardar una copia local para seguir usándola acá.'}
        </p>
      ) : (
        <>
          <p className="muted">
            Esta rifa se sincroniza con las personas que la comparten. Tu rol:{' '}
            <strong>{ROLE_LABELS[perms.role] ?? perms.role}</strong> ({ROLE_HINTS[perms.role]?.toLowerCase()}).
            {perms.role === 'seller' &&
              (perms.ranges ? ` Tu talonario: ${formatRanges(perms.ranges)}.` : ' Podés vender cualquier número.')}
          </p>
          {perms.otherAccount && (
            <p className="form-note">Es de otra cuenta: iniciá sesión con esa cuenta para sincronizarla y modificarla.</p>
          )}
          <div className="form-actions start">
            <button type="button" className="btn btn-secondary" onClick={onOpenMembers} disabled={!data.raffle.remote}>
              {perms.manageMembers ? 'Miembros e invitaciones' : 'Ver miembros'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** La cuenta de la nube: no hace falta para las rifas locales. */
function AccountSection({ notify, onOpenAccount }) {
  const { session, user } = useSession()
  if (!session) return null
  return (
    <section className="panel" aria-labelledby="account-title">
      <h2 id="account-title" className="section-title">
        Cuenta
      </h2>
      {user ? (
        <AccountPanel notify={notify} compact />
      ) : (
        <>
          <p className="muted">
            No hace falta para usar rifas locales. Con una cuenta podés crear rifas en la nube y venderlas entre varias
            personas, cada una desde su teléfono.
          </p>
          <div className="form-actions wrap start">
            <button type="button" className="btn btn-secondary" onClick={() => onOpenAccount('login')}>
              Iniciar sesión
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => onOpenAccount('register')}>
              Crear cuenta
            </button>
          </div>
        </>
      )}
    </section>
  )
}

/** El tema se aplica al tocarlo: el cambio de colores ya es la confirmación. */
function AppearancePanel({ appearance, onChange }) {
  return (
    <section className="panel" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="section-title">
        Apariencia
      </h2>
      <p className="muted">
        Los colores de la app. La imagen para compartir los sigue, salvo que en Imagen le elijas otros.
      </p>
      <fieldset className="choice">
        <legend className="visually-hidden">Tema</legend>
        <div className="theme-options">
          {Object.entries(THEMES).map(([id, theme]) => (
            <label key={id} className="theme-option">
              <input
                type="radio"
                name="theme"
                value={id}
                className="visually-hidden"
                checked={appearance.theme === id}
                onChange={() => onChange({ ...appearance, theme: id })}
              />
              <ThemeSwatch theme={theme} />
              <span className="theme-name">
                <strong>{theme.name}</strong>
                <small>{theme.hint}</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  )
}

function ConfigForm({ config, onSave, readOnly = false }) {
  const [form, setForm] = useState(() => ({ ...config, prizes: [...config.prizes] }))
  const dirty = JSON.stringify(form) !== JSON.stringify(config)

  const set = (field, parse = (v) => v) => (e) => setForm((f) => ({ ...f, [field]: parse(e.target.value) }))
  const setPrize = (i, value) => setForm((f) => ({ ...f, prizes: f.prizes.map((p, j) => (j === i ? value : p)) }))
  const removePrize = (i) => setForm((f) => ({ ...f, prizes: f.prizes.filter((_, j) => j !== i) }))
  const addPrize = () => setForm((f) => ({ ...f, prizes: [...f.prizes, ''] }))

  function handleSubmit(e) {
    e.preventDefault()
    onSave({
      ...form,
      price: form.price === '' ? 0 : form.price,
      packSize: form.packSize === '' ? 0 : form.packSize,
      packPrice: form.packPrice === '' ? 0 : form.packPrice,
      title: form.title.trim(),
      drawText: form.drawText.trim(),
      prizes: form.prizes.map((p) => p.trim()).filter(Boolean),
    })
  }

  return (
    <form className="panel form" onSubmit={handleSubmit} aria-labelledby="config-title">
      <h2 id="config-title" className="section-title">
        La rifa
      </h2>
      {readOnly && <p className="form-note">Sólo quien organiza la rifa puede cambiar estos datos.</p>}
      <fieldset className="plain-group" disabled={readOnly}>
        <legend className="visually-hidden">Datos de la rifa</legend>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Título</span>
            <input value={form.title} onChange={set('title')} maxLength={40} placeholder="Rifa" />
          </label>
          <label className="field">
            <span className="field-label">Cantidad de números</span>
            <input
              type="number"
              min={1}
              max={MAX_TOTAL}
              inputMode="numeric"
              value={form.total}
              onChange={set('total', toInt)}
              required
            />
          </label>
        </div>

        <div className="field-row three">
          <label className="field">
            <span className="field-label">Precio por número</span>
            <input type="number" min={0} step={1} inputMode="numeric" value={form.price} onChange={set('price', toInt)} />
          </label>
          <label className="field">
            <span className="field-label">Promo: cantidad</span>
            <input
              type="number"
              min={0}
              max={10}
              inputMode="numeric"
              value={form.packSize}
              onChange={set('packSize', toInt)}
            />
          </label>
          <label className="field">
            <span className="field-label">Promo: precio</span>
            <input
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={form.packPrice}
              onChange={set('packPrice', toInt)}
            />
          </label>
        </div>
        <p className="field-hint">Para no usar promo, dejá la cantidad o el precio en 0.</p>

        <fieldset className="prizes">
          <legend className="field-label">Premios (en orden)</legend>
          <ol>
            {form.prizes.map((prize, i) => (
              <li key={i} className="prize-row">
                <span className="prize-pos" aria-hidden="true">
                  {i + 1}°
                </span>
                <input
                  value={prize}
                  onChange={(e) => setPrize(i, e.target.value)}
                  aria-label={`Premio ${i + 1}`}
                  maxLength={60}
                />
                <button type="button" className="icon-btn" onClick={() => removePrize(i)} aria-label={`Quitar premio ${i + 1}`}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost btn-sm" onClick={addPrize} disabled={form.prizes.length >= 20}>
            + Agregar premio
          </button>
        </fieldset>

        <label className="field">
          <span className="field-label">Texto del sorteo</span>
          <textarea value={form.drawText} onChange={set('drawText')} rows={2} maxLength={140} />
        </label>
      </fieldset>

      {!readOnly && (
        <div className="form-actions">
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => setForm({ ...config, prizes: [...config.prizes] })}>
              Descartar
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!dirty}>
            Guardar cambios
          </button>
        </div>
      )}
    </form>
  )
}

const DELETE_LABELS = {
  delete: ['Borrar esta rifa…', 'Sí, borrar la rifa'],
  'delete-cloud': ['Borrar esta rifa…', 'Sí, borrar la rifa'],
  leave: ['Salir de la rifa…', 'Sí, salir'],
  remove: ['Quitar del dispositivo…', 'Sí, quitar'],
}

function DataPanel({ data, perms, onExport, onImportBackup, notify, onArchive, onDelete, onSaveCopy }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [persisted, setPersisted] = useState(null)
  const [backup, setBackup] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)
  const canImport = perms.cloud && perms.config && !data.raffle.lastSeq && !data.takenCount &&
    !data.purchases?.length && !data.people?.length
  const name = data.config.title || 'Rifa'
  const archived = Boolean(data.raffle.archivedAt)
  const kind = deleteKind(perms)
  const [askLabel, confirmLabel] = DELETE_LABELS[kind]

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  return (
    <section className="panel" aria-labelledby="data-title">
      <h2 id="data-title" className="section-title">
        Datos
      </h2>
      {perms.cloud ? (
        <p className="muted">
          Esta rifa está en la nube y también guardada en este dispositivo: funciona sin internet y se sincroniza al
          volver la señal. Desde «Mis rifas» podés restaurar un respaldo como una rifa local aparte.
        </p>
      ) : (
        <p className="muted">
          Todo se guarda en este dispositivo, sin internet. Descargá un respaldo de esta rifa de vez en cuando o para
          pasarla a otro teléfono (se restaura desde «Mis rifas», tocando el título).
        </p>
      )}

      <p className="storage-status">
        <span className={`dot ${persisted ? 'ok' : ''}`} aria-hidden="true" />
        {persisted
          ? 'Almacenamiento protegido: el navegador no borrará los datos.'
          : 'El navegador podría borrar los datos si se queda sin espacio.'}
        {persisted === false && (
          <button type="button" className="link-btn" onClick={() => requestPersistence().then(setPersisted)}>
            Proteger
          </button>
        )}
      </p>

      {canImport && (
        <div className="form">
          <p className="field-hint">
            Como organizador, podés cargar un respaldo en esta rifa vacía. Se compartirán sus datos y comprobantes con
            los miembros.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            aria-label="Respaldo para esta rifa en la nube"
            hidden
            onChange={async (e) => {
              const file = e.target.files[0]
              e.target.value = ''
              if (!file) return
              try {
                setBackup({ name: file.name, data: JSON.parse(await file.text()) })
              } catch {
                notify('El archivo no es un respaldo válido', 'error')
              }
            }}
          />
          {backup ? (
            <div className="confirm" role="alert">
              <p>
                ¿Cargar «{backup.name}» en esta rifa? Se usarán la configuración, las ventas y los comprobantes del respaldo.
              </p>
              <div className="form-actions wrap start">
                <button type="button" className="btn btn-ghost" disabled={importing} onClick={() => setBackup(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={importing}
                  onClick={async () => {
                    setImporting(true)
                    try {
                      if (await onImportBackup(backup.data)) setBackup(null)
                    } finally {
                      setImporting(false)
                    }
                  }}
                >
                  {importing ? 'Cargando…' : 'Sí, cargar respaldo'}
                </button>
              </div>
            </div>
          ) : (
            <div className="form-actions start">
              <button type="button" className="btn btn-secondary" onClick={() => fileRef.current.click()}>
                Cargar respaldo en esta rifa…
              </button>
            </div>
          )}
        </div>
      )}

      <div className="form-actions wrap start">
        <button type="button" className="btn btn-secondary" onClick={onExport}>
          Descargar respaldo
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onArchive(!archived)}>
          {archived ? 'Desarchivar rifa' : 'Archivar rifa'}
        </button>
        {perms.cloud && (
          <button type="button" className="btn btn-ghost" onClick={onSaveCopy}>
            Guardar copia local
          </button>
        )}
      </div>
      {archived && <p className="field-hint">Esta rifa está archivada: aparece aparte en «Mis rifas».</p>}

      <div className="danger-zone">
        {confirmDelete ? (
          <div className="confirm" role="alert">
            {kind === 'leave' ? (
              <p>
                ¿Salir de «{name}»? Dejás de verla y se quita de este teléfono. Para volver, te tienen que invitar de
                nuevo.
              </p>
            ) : kind === 'remove' ? (
              <p>
                Se quita «{name}» de este teléfono{perms.otherAccount ? ' (en la nube sigue igual)' : ''}. Si querés
                conservarla, guardá antes una copia local: no se puede deshacer.
              </p>
            ) : (
              <p>
                Se borra «{name}» con {plural(data.people.length, 'participante', 'participantes')},{' '}
                {plural(data.purchases.length, 'comprobante', 'comprobantes')} y{' '}
                {plural(data.takenCount, 'número tomado', 'números tomados')}.
                {kind === 'delete-cloud' && ' Se borra de la nube para todas las personas que la comparten.'} Las demás
                rifas no se tocan. Descargá un respaldo antes: no se puede deshacer.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  if (!(await onDelete())) setConfirmDelete(false)
                }}
              >
                {confirmLabel}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost danger-text" onClick={() => setConfirmDelete(true)}>
            {askLabel}
          </button>
        )}
      </div>
    </section>
  )
}
