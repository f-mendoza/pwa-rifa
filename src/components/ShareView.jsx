import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SHARE, saveSharePrefs } from '../db.js'
import { TEXT_FONTS, TITLE_FONTS, textFont, titleFont } from '../lib/fonts.js'
import { IMAGE_FORMATS, IMAGE_MODES } from '../lib/shareImage.js'
import { permissionsFor } from '../lib/permissions.js'
import { canCopyImage } from '../lib/share.js'
import { IMAGE_COLOR_FIELDS, THEMES, contrast, normalizeImageColors, resolveImagePalette, themeById } from '../lib/themes.js'
import { ImageSwatch } from './Swatches.jsx'

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
  // Quien sólo mira una rifa en la nube comparte la imagen tal como está, sin cambiar su estilo.
  const canEdit = permissionsFor(data).share

  return (
    <section className="panel share" aria-labelledby="share-title">
      <div className="share-controls">
        <h2 id="share-title" className="section-title">
          Imagen para compartir
        </h2>
        <p className="muted">
          Se actualiza sola con cada cambio. {available.length} de {config.total} números disponibles.
        </p>

        <fieldset className="plain-group" disabled={!canEdit}>
          <legend className="visually-hidden">Opciones de la imagen</legend>
          <Choice
            label="Qué mostrar"
            options={IMAGE_MODES}
            value={share.mode}
            onChange={(mode) => saveSharePrefs(data.raffle.id, { ...share, mode })}
          />
          <Choice
            label="Formato"
            options={IMAGE_FORMATS}
            value={share.format}
            onChange={(format) => saveSharePrefs(data.raffle.id, { ...share, format })}
          />
        </fieldset>
        {!canEdit && <p className="field-hint">Sólo podés ver esta rifa: la imagen se comparte con el estilo que eligieron.</p>}

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

      <figure
        className={`preview ${image.url && !ready ? 'is-stale' : ''}`}
        style={{ aspectRatio: `${width} / ${height}` }}
        aria-busy={!ready}
      >
        {image.url ? (
          <img key={image.url} src={image.url} alt={`Vista previa: ${available.length} números disponibles`} />
        ) : (
          <div className="preview-loading">Generando…</div>
        )}
      </figure>

      {canEdit && (
        <ImageStyle raffleId={data.raffle.id} share={share} appTheme={data.appearance.theme} image={image} ratio={`${width} / ${height}`} />
      )}
    </section>
  )
}

/** Colores y letras de la imagen. Plegado: compartir sigue estando a un toque. */
function ImageStyle({ raffleId, share, appTheme, image, ratio }) {
  const palette = resolveImagePalette(share, appTheme)
  const save = (patch) => saveSharePrefs(raffleId, { ...share, ...patch })
  const isDefault =
    share.palette === DEFAULT_SHARE.palette &&
    share.titleFont === DEFAULT_SHARE.titleFont &&
    share.textFont === DEFAULT_SHARE.textFont
  const paletteName =
    share.palette === 'custom' ? 'personalizados' : share.palette === 'app' ? 'como la app' : THEMES[share.palette].name

  return (
    <details className="share-style">
      <summary>
        <span>
          <strong>Colores y letras</strong>
          <small>
            Colores {paletteName} · {titleFont(share.titleFont).label} y {textFont(share.textFont).label}
          </small>
        </span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>

      <div className="share-style-body">
        <div className="share-style-options">
          <fieldset className="choice">
            <legend className="field-label">Colores</legend>
            <div className="palette-options">
              <PaletteOption
                checked={share.palette === 'app'}
                onChange={() => save({ palette: 'app' })}
                palette={themeById(appTheme).image}
                label="Como la app"
                hint={themeById(appTheme).name}
              />
              {Object.entries(THEMES).map(([id, theme]) => (
                <PaletteOption
                  key={id}
                  checked={share.palette === id}
                  onChange={() => save({ palette: id })}
                  palette={theme.image}
                  label={theme.name}
                />
              ))}
              <PaletteOption
                checked={share.palette === 'custom'}
                // Se arranca de los colores que se están viendo: personalizar es retocar lo que hay.
                onChange={() => save({ palette: 'custom', colors: normalizeImageColors(palette) })}
                palette={share.palette === 'custom' ? palette : null}
                label="Personalizar"
                hint="Elegí cada color"
              />
            </div>
          </fieldset>

          {share.palette === 'custom' && (
            <CustomColors colors={palette} onChange={(colors) => save({ colors })} />
          )}

          <FontChoice
            label="Letra de los títulos"
            fonts={TITLE_FONTS}
            value={share.titleFont}
            onChange={(titleFont) => save({ titleFont })}
          />
          <FontChoice
            label="Letra de los textos"
            fonts={TEXT_FONTS}
            value={share.textFont}
            onChange={(textFont) => save({ textFont })}
          />

          {!isDefault && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                save({ palette: DEFAULT_SHARE.palette, titleFont: DEFAULT_SHARE.titleFont, textFont: DEFAULT_SHARE.textFont })
              }
            >
              Volver al diseño original
            </button>
          )}
        </div>

        {/* En el celular la vista previa grande queda arriba: esta acompaña mientras se elige. */}
        {image.url && (
          <img
            className={`share-style-mini ${!image.ready ? 'is-stale' : ''}`}
            src={image.url}
            alt=""
            style={{ aspectRatio: ratio }}
          />
        )}
      </div>
    </details>
  )
}

function PaletteOption({ checked, onChange, palette, label, hint }) {
  return (
    <label className="palette-option">
      <input type="radio" name="palette" className="visually-hidden" checked={checked} onChange={onChange} />
      <ImageSwatch palette={palette} />
      <span className="palette-name">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  )
}

function FontChoice({ label, fonts, value, onChange }) {
  return (
    <fieldset className="choice">
      <legend className="field-label">{label}</legend>
      <div className="font-options">
        {Object.entries(fonts).map(([id, font]) => (
          <label key={id} className="choice-option font-option">
            <input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)} />
            <span>
              <strong style={{ fontFamily: font.family, fontWeight: font.weight ?? 600 }}>{font.label}</strong>
              <small>{font.hint}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Avisos en lenguaje llano cuando una combinación se va a leer mal en el teléfono de quien la recibe. */
function colorWarnings(c) {
  const warnings = []
  if (contrast(c.ink, c.card) < 4.5) warnings.push('Los números se leen mal sobre las casillas.')
  if (Math.min(contrast(c.ink, c.bg1), contrast(c.ink, c.bg2), contrast(c.ink, c.bg3)) < 3) {
    warnings.push('Los textos se leen mal sobre el fondo.')
  }
  if (contrast(c.accent, c.bg1) < 2) warnings.push('El título casi no se distingue del fondo.')
  return warnings
}

/**
 * Los selectores de color disparan un cambio por cada movimiento: se muestra al instante
 * y se guarda un rato después, para no redibujar la imagen decenas de veces por segundo.
 */
function CustomColors({ colors, onChange }) {
  const [draft, setDraft] = useState(() => normalizeImageColors(colors))
  const pending = useRef(null)
  const timer = useRef(null)
  // El guardado diferido usa siempre el último `onChange` (que trae las preferencias al día).
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(
    () => () => {
      // Si se cierra justo después de elegir, el último color no se pierde.
      clearTimeout(timer.current)
      if (pending.current) onChangeRef.current(pending.current)
    },
    [],
  )

  const set = (field, value) => {
    const next = { ...draft, [field]: value }
    setDraft(next)
    pending.current = next
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      pending.current = null
      onChangeRef.current(next)
    }, 250)
  }

  const warnings = colorWarnings(draft)

  return (
    <fieldset className="choice custom-colors">
      <legend className="field-label">Tus colores</legend>
      <div className="color-fields">
        {Object.entries(IMAGE_COLOR_FIELDS).map(([field, label]) => (
          <label key={field} className="color-field">
            <input type="color" value={draft[field]} onChange={(e) => set(field, e.target.value)} />
            <span>
              {label}
              <small>{draft[field].toUpperCase()}</small>
            </span>
          </label>
        ))}
      </div>
      {warnings.length > 0 && (
        <ul className="color-warnings" role="status">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
