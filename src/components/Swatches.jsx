/**
 * Miniaturas que muestran un tema o una paleta con sus propios colores, sin importar
 * el tema que tenga la app en ese momento. Son decorativas: el nombre va al lado.
 */

const gradient = (a, b, c) => `linear-gradient(90deg, ${a}, ${b} 45%, ${c})`

/** Una pantalla de la app en chiquito: cabecera con el degradé, casillas y una elegida. */
export function ThemeSwatch({ theme }) {
  const c = theme.colors
  return (
    <span
      className="theme-swatch"
      aria-hidden="true"
      style={{
        '--sw-head': gradient(c['grad-1'], c['grad-2'], c['grad-3']),
        '--sw-logo': c.logo,
        '--sw-paper': c.paper,
        '--sw-surface': c.surface,
        '--sw-line': c['line-strong'],
        '--sw-accent': c['accent-strong'],
        '--sw-ink': c.ink,
        '--sw-taken': c.taken,
      }}
    >
      <span className="theme-swatch-head">Aa</span>
      <span className="theme-swatch-cells">
        <i />
        <i className="is-taken" />
        <i className="is-selected" />
        <i />
      </span>
    </span>
  )
}

/** La imagen en chiquito: fondo, una banda de premio y una casilla con su número. */
export function ImageSwatch({ palette }) {
  return (
    <span
      className="image-swatch"
      aria-hidden="true"
      style={
        palette && {
          '--sw-bg': gradient(palette.bg1, palette.bg2, palette.bg3),
          '--sw-accent': palette.accent,
          '--sw-card': palette.card,
          '--sw-ink': palette.ink,
        }
      }
    >
      <span className="image-swatch-band" />
      <span className="image-swatch-cell">7</span>
    </span>
  )
}
