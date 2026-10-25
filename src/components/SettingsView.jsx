import { useEffect, useRef, useState } from 'react'
import { MAX_TOTAL } from '../db.js'
import { requestPersistence } from '../hooks/usePwa.js'
import { THEMES } from '../lib/themes.js'
import { ThemeSwatch } from './Swatches.jsx'

// Un campo vacío queda vacío mientras se escribe (si no, borrar "300" dejaba un 0 pegado).
const toInt = (value) => {
  if (value === '') return ''
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : ''
}

export function SettingsView({ data, onSaveConfig, onSaveAppearance, onExport, onImport, onClear }) {
  return (
    <div className="settings">
      <ConfigForm key={JSON.stringify(data.config)} config={data.config} onSave={onSaveConfig} />
      <AppearancePanel appearance={data.appearance} onChange={onSaveAppearance} />
      <DataPanel data={data} onExport={onExport} onImport={onImport} onClear={onClear} />
    </div>
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

function ConfigForm({ config, onSave }) {
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
    </form>
  )
}

function DataPanel({ data, onExport, onImport, onClear }) {
  const fileRef = useRef(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingImport, setPendingImport] = useState(null)
  const hasData = data.takenCount > 0 || data.purchases.length > 0
  const [persisted, setPersisted] = useState(null)

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  return (
    <section className="panel" aria-labelledby="data-title">
      <h2 id="data-title" className="section-title">
        Datos
      </h2>
      <p className="muted">
        Todo se guarda en este dispositivo, sin internet. Descargá un respaldo de vez en cuando o para pasarlo a otro
        teléfono.
      </p>

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

      <div className="form-actions wrap start">
        <button type="button" className="btn btn-secondary" onClick={onExport}>
          Descargar respaldo
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
            if (!file) return
            // Con datos cargados, restaurar los reemplaza todos: se confirma antes.
            if (hasData) setPendingImport(file)
            else onImport(file)
          }}
        />
      </div>

      {pendingImport && (
        <div className="confirm" role="alert">
          <p>
            Restaurar <strong>{pendingImport.name}</strong> reemplaza todo lo que hay ahora en este teléfono (
            {data.takenCount} números tomados, {data.purchases.length} comprobantes). Si no tenés un respaldo de lo
            actual, descargalo antes.
          </p>
          <div className="form-actions wrap">
            <button type="button" className="btn btn-ghost" onClick={() => setPendingImport(null)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={async () => {
                const file = pendingImport
                setPendingImport(null)
                await onImport(file)
              }}
            >
              Sí, restaurar
            </button>
          </div>
        </div>
      )}

      <div className="danger-zone">
        {confirmClear ? (
          <div className="confirm" role="alert">
            <p>
              Se borran los {data.people.length} participantes y los {data.purchases.length} comprobantes, y se liberan
              los {data.takenCount} números tomados. La configuración se mantiene. Descargá un respaldo antes: no se
              puede deshacer.
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmClear(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={async () => {
                  await onClear()
                  setConfirmClear(false)
                }}
              >
                Sí, borrar todo
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-ghost danger-text"
            onClick={() => setConfirmClear(true)}
            disabled={data.takenCount === 0}
          >
            Empezar una rifa nueva…
          </button>
        )}
      </div>
    </section>
  )
}
