import { describe, expect, it } from 'vitest'
import {
  THEMES,
  contrast,
  mix,
  normalizeImageColors,
  resolveImagePalette,
  textOn,
  withAlpha,
} from '../../src/lib/themes.js'

const TOKENS = Object.keys(THEMES.flyer.colors)

// [texto, fondo, mínimo]: 4.5 para texto común, 3 para letra grande o íconos.
const PAIRS = [
  ['ink', 'paper', 4.5],
  ['ink', 'surface', 4.5],
  ['ink-2', 'surface', 4.5],
  ['ink-2', 'wash', 4.5],
  ['ink-2', 'paper', 4.5],
  ['ink-3', 'surface', 4.5],
  ['ink-3', 'surface-2', 4.5],
  ['ink-3', 'taken', 3],
  ['on-accent', 'accent-strong', 4.5],
  ['on-accent', 'accent-deep', 4.5],
  ['accent-strong', 'surface', 4.5],
  ['accent-strong', 'paper', 4.5],
  ['accent-deep', 'accent-wash', 4.5],
  ['accent-deep', 'accent-wash-2', 4.5],
  ['accent-deep', 'surface', 4.5],
  // El logo va alineado a la izquierda de la cabecera: sobre el primer tramo del degradé.
  ['logo', 'grad-1', 3],
  ['logo', 'grad-2', 3],
  ['ink', 'grad-1', 4.5],
  ['ink', 'grad-2', 4.5],
  ['ink', 'grad-3', 4.5],
  ['danger', 'surface', 4.5],
  ['danger', 'danger-wash', 4.5],
  ['on-accent', 'danger', 4.5],
  ['on-inverse', 'danger', 4.5],
  ['warn-ink', 'warn-wash', 4.5],
  ['ink-2', 'note-wash', 4.5],
  ['empty-ink', 'empty-wash', 3],
  ['on-inverse', 'inverse', 4.5],
  ['on-inverse-accent', 'inverse-accent', 4.5],
  ['on-inverse-accent', 'inverse-accent-hover', 4.5],
]

describe.each(Object.entries(THEMES))('tema %s', (id, theme) => {
  it('define todos los tokens con colores válidos', () => {
    expect(Object.keys(theme.colors).sort()).toEqual([...TOKENS].sort())
    for (const value of Object.values(theme.colors)) expect(value).toMatch(/^#[0-9a-f]{6}$/)
    expect(normalizeImageColors(theme.image)).not.toBeNull()
  })

  it.each(PAIRS)('%s sobre %s llega a %s:1', (fg, bg, min) => {
    expect(contrast(theme.colors[fg], theme.colors[bg])).toBeGreaterThanOrEqual(min)
  })

  it('la imagen se lee: números sobre casillas y textos sobre el fondo', () => {
    const { image } = theme
    expect(contrast(image.ink, image.card)).toBeGreaterThanOrEqual(4.5)
    for (const bg of [image.bg1, image.bg2, image.bg3]) expect(contrast(image.ink, bg)).toBeGreaterThanOrEqual(4.5)
    const pill = image.pill ?? image.accent
    expect(contrast(textOn(pill, [image.ink, image.card]), pill)).toBeGreaterThanOrEqual(3)
  })
})

describe('utilidades de color', () => {
  it('contraste WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrast('#777777', '#777777')).toBe(1)
  })

  it('mezcla y transparencia', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(withAlpha('#ff0080', 0.5)).toBe('rgba(255,0,128,0.5)')
  })

  it('texto sobre un color: blanco si alcanza, si no el de más contraste', () => {
    expect(textOn('#c81f8c', ['#2e0f2a'])).toBe('#ffffff')
    expect(textOn('#f5c542', ['#f5f6f8', '#16181c'])).toBe('#16181c')
  })
})

describe('resolveImagePalette', () => {
  const custom = { bg1: '#111111', bg2: '#222222', bg3: '#333333', accent: '#444444', ink: '#ffffff', card: '#000000' }

  it('"Como la app" sigue al tema de la app', () => {
    expect(resolveImagePalette({ palette: 'app' }, 'noche')).toBe(THEMES.noche.image)
  })

  it('un tema elegido para la imagen no depende del de la app', () => {
    expect(resolveImagePalette({ palette: 'menta' }, 'noche')).toBe(THEMES.menta.image)
  })

  it('personalizada usa sus colores; si están dañados cae en el tema de la app', () => {
    expect(resolveImagePalette({ palette: 'custom', colors: custom }, 'flyer')).toEqual(custom)
    expect(resolveImagePalette({ palette: 'custom', colors: { ...custom, ink: 'rojo' } }, 'oceano')).toBe(
      THEMES.oceano.image,
    )
  })

  it('un tema que ya no existe cae en el de la app', () => {
    expect(resolveImagePalette({ palette: 'viejo' }, 'lavanda')).toBe(THEMES.lavanda.image)
  })
})
