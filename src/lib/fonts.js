/**
 * Fuentes que se pueden elegir para la imagen. Todas vienen empaquetadas (src/main.jsx):
 * la imagen se genera sin internet.
 *
 * Títulos: `weight` es el peso con que se dibujan, `upper` si el título va en mayúsculas
 * (las cursivas se leen mal en mayúsculas) y `lineHeight` el interlineado relativo al tamaño.
 * Textos: `soft` es la letra de las frases secundarias (la promo, "Gracias por participar").
 */
export const TITLE_FONTS = {
  'big-shoulders': {
    label: 'Big Shoulders',
    hint: 'Condensada, la del flyer',
    family: '"Big Shoulders Display"',
    weight: 900,
    upper: true,
    lineHeight: 0.86,
  },
  anton: { label: 'Anton', hint: 'Condensada y gruesa', family: 'Anton', weight: 400, upper: true, lineHeight: 1 },
  bebas: { label: 'Bebas Neue', hint: 'Alta y prolija', family: '"Bebas Neue"', weight: 400, upper: true, lineHeight: 0.9 },
  fredoka: { label: 'Fredoka', hint: 'Redondeada y alegre', family: 'Fredoka', weight: 700, upper: true, lineHeight: 0.96 },
  'dm-serif': {
    label: 'DM Serif',
    hint: 'Con serifa, elegante',
    family: '"DM Serif Display"',
    weight: 400,
    upper: false,
    lineHeight: 1,
  },
  lobster: { label: 'Lobster', hint: 'Cursiva festiva', family: 'Lobster', weight: 400, upper: false, lineHeight: 1.08 },
}

export const TEXT_FONTS = {
  outfit: {
    label: 'Outfit',
    hint: 'Moderna, la del flyer',
    family: 'Outfit',
    soft: { family: '"Instrument Serif"', weight: 400 },
  },
  nunito: { label: 'Nunito', hint: 'Redondeada', family: 'Nunito' },
  poppins: { label: 'Poppins', hint: 'Geométrica', family: 'Poppins' },
  lora: { label: 'Lora', hint: 'Con serifa', family: 'Lora' },
  atkinson: { label: 'Atkinson', hint: 'Muy legible', family: '"Atkinson Hyperlegible"' },
}

export const DEFAULT_TITLE_FONT = 'big-shoulders'
export const DEFAULT_TEXT_FONT = 'outfit'

export const titleFont = (id) => TITLE_FONTS[id] ?? TITLE_FONTS[DEFAULT_TITLE_FONT]

export function textFont(id) {
  const font = TEXT_FONTS[id] ?? TEXT_FONTS[DEFAULT_TEXT_FONT]
  return { ...font, soft: font.soft ?? { family: font.family, weight: 400 } }
}
