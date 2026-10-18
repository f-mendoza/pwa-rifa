import { saveSharePrefs } from '../db.js'
import { IMAGE_FORMATS, IMAGE_MODES } from '../lib/shareImage.js'
import { canCopyImage } from '../lib/share.js'

function Choice({ label, options, value, onChange }) {
  return (
    <fieldset className="choice">
      <legend className="field-label">{label}</legend>
      <div className="choice-options">
        {Object.entries(options).map(([id, opt]) => (
          <label key={id} className="choice-option">
            <input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)} />
            <span>
              <strong>{opt.label}</strong>
              <small>{opt.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function ShareView({ data, image, onShare, onDownload, onCopyImage, onCopyText }) {
  const { share, available, config } = data
  const { ready } = image
  const { width, height } = IMAGE_FORMATS[share.format] ?? IMAGE_FORMATS.story

  return (
    <section className="panel share" aria-labelledby="share-title">
      <div className="share-controls">
        <h2 id="share-title" className="section-title">
          Imagen para compartir
        </h2>
        <p className="muted">
          Se actualiza sola con cada cambio. {available.length} de {config.total} números disponibles.
        </p>

        <Choice
          label="Qué mostrar"
          options={IMAGE_MODES}
          value={share.mode}
          onChange={(mode) => saveSharePrefs({ ...share, mode })}
        />
        <Choice
          label="Formato"
          options={IMAGE_FORMATS}
          value={share.format}
          onChange={(format) => saveSharePrefs({ ...share, format })}
        />

        <div className="share-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={onShare} disabled={!ready}>
            Compartir imagen
          </button>
          <button type="button" className="btn btn-secondary" onClick={onDownload} disabled={!ready}>
            Descargar PNG
          </button>
          {canCopyImage() && (
            <button type="button" className="btn btn-ghost" onClick={onCopyImage} disabled={!ready}>
              Copiar imagen
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onCopyText}>
            Copiar lista en texto
          </button>
        </div>
        {image.error ? (
          <p className="error">No se pudo generar la imagen: {image.error.message}</p>
        ) : (
          image.url && !ready && <p className="muted">Actualizando la imagen…</p>
        )}
      </div>

      <figure className="preview" style={{ aspectRatio: `${width} / ${height}` }}>
        {image.url ? (
          <img src={image.url} alt={`Vista previa: ${available.length} números disponibles`} />
        ) : (
          <div className="preview-loading">Generando…</div>
        )}
      </figure>
    </section>
  )
}
