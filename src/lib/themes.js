/**
 * Temas de la app y paletas de la imagen para compartir. Es la única fuente de los colores:
 * `applyTheme` vuelca `colors` como variables CSS en <html> y la imagen usa `image`.
 *
 * Cada tema define todos los tokens (un test controla que no falte ninguno y que los pares
 * de texto/fondo lleguen a WCAG AA). `image` es la paleta reducida de la imagen, la misma
 * que se puede personalizar a mano.
 */

/** Estados (error, aviso, éxito) para temas claros: no dependen del acento. */
const LIGHT_STATUS = {
  danger: '#b42318',
  'danger-wash': '#fdecea',
  'danger-hover': '#8f1c13',
  success: '#17724a',
  warn: '#e0a33a',
  'warn-ink': '#7a5a00',
  'warn-wash': '#fbf3c9',
  'note-wash': '#fbf7cf',
  'note-line': '#ece49a',
  'empty-wash': '#fffbea',
  'empty-line': '#e6cf6a',
  'empty-ink': '#8a6c0a',
}

const DARK_STATUS = {
  danger: '#ff8f85',
  'danger-wash': '#3d1a1d',
  'danger-hover': '#ffb3ab',
  success: '#5fd39b',
  warn: '#f0b44c',
  'warn-ink': '#f5cf7a',
  'warn-wash': '#3a2e12',
  'note-wash': '#2f2a14',
  'note-line': '#5a5020',
  'empty-wash': '#2c2614',
  'empty-line': '#8a7430',
  'empty-ink': '#e8c85a',
}

function lightTheme({ colors, ...rest }) {
  return {
    scheme: 'light',
    ...rest,
    colors: {
      ...LIGHT_STATUS,
      logo: colors['accent-strong'],
      stripe: '#ffffff',
      // Barra de selección y avisos: oscuros sobre la página clara.
      inverse: colors.ink,
      'on-inverse': colors['on-accent'],
      'inverse-accent': colors.accent,
      'on-inverse-accent': colors.ink,
      shadow: colors.ink,
      backdrop: colors.ink,
      ...colors,
    },
  }
}

function darkTheme({ colors, ...rest }) {
  return {
    scheme: 'dark',
    ...rest,
    colors: {
      ...DARK_STATUS,
      logo: colors['accent-strong'],
      // Barra de selección y avisos: claros sobre la página oscura.
      inverse: colors.ink,
      'on-inverse': colors.surface,
      shadow: '#000000',
      backdrop: '#000000',
      ...colors,
    },
  }
}

export const THEMES = {
  flyer: lightTheme({
    name: 'Flyer',
    hint: 'Limón, rosa y lila',
    colors: {
      'grad-1': '#f7f2a6',
      'grad-2': '#fbc9d6',
      'grad-3': '#f4a8ee',
      accent: '#ee4fbf',
      'accent-strong': '#c81f8c',
      'accent-deep': '#a3166f',
      'accent-wash': '#fde8f5',
      'accent-wash-2': '#fbd6ee',
      'accent-line': '#f7c6e6',
      'inverse-accent-hover': '#f472cc',
      ink: '#2e0f2a',
      'ink-2': '#634560',
      'ink-3': '#7a6077',
      paper: '#fff9f3',
      surface: '#fffdfe',
      'surface-2': '#fffafc',
      wash: '#f7eef3',
      'wash-2': '#faf4f7',
      'wash-hover': '#faf1f6',
      taken: '#f5ecf1',
      'on-accent': '#fffafd',
      line: '#f1dfea',
      'line-strong': '#e3c4d7',
    },
    image: { bg1: '#f7f2a6', bg2: '#fbc9d6', bg3: '#f4a8ee', accent: '#ee4fbf', ink: '#2e0f2a', card: '#ffffff', pill: '#c81f8c' },
  }),

  menta: lightTheme({
    name: 'Menta',
    hint: 'Verde agua y celeste',
    colors: {
      'grad-1': '#e2f7c9',
      'grad-2': '#b8ecdc',
      'grad-3': '#a8daf0',
      accent: '#17a88f',
      'accent-strong': '#0b7565',
      'accent-deep': '#075a4e',
      'accent-wash': '#e1f5ef',
      'accent-wash-2': '#cbeee3',
      'accent-line': '#b9e3d7',
      'inverse-accent-hover': '#3cc2aa',
      ink: '#0c2a27',
      'ink-2': '#3b5753',
      'ink-3': '#536e6a',
      paper: '#f5fbf8',
      surface: '#fdfffe',
      'surface-2': '#f8fcfa',
      wash: '#ebf4f1',
      'wash-2': '#f1f8f5',
      'wash-hover': '#e8f3ef',
      taken: '#e8f1ee',
      'on-accent': '#f7fffc',
      line: '#d6e8e2',
      'line-strong': '#b3d2c8',
    },
    image: { bg1: '#e2f7c9', bg2: '#b8ecdc', bg3: '#a8daf0', accent: '#109a83', ink: '#0c2a27', card: '#ffffff', pill: '#0b7565' },
  }),

  atardecer: lightTheme({
    name: 'Atardecer',
    hint: 'Durazno, coral y naranja',
    colors: {
      'grad-1': '#ffe6a3',
      'grad-2': '#ffc8a2',
      'grad-3': '#ffa9a0',
      accent: '#f2683c',
      'accent-strong': '#bf3f0c',
      'accent-deep': '#933008',
      'accent-wash': '#fff0e6',
      'accent-wash-2': '#ffe0cc',
      'accent-line': '#fbd0b6',
      'inverse-accent-hover': '#f78a63',
      ink: '#2f160b',
      'ink-2': '#654639',
      'ink-3': '#7c5c4f',
      paper: '#fffaf2',
      surface: '#fffdfb',
      'surface-2': '#fffaf6',
      wash: '#f8eee8',
      'wash-2': '#fbf4ef',
      'wash-hover': '#faefe8',
      taken: '#f5ebe4',
      'on-accent': '#fffaf6',
      line: '#f1e0d5',
      'line-strong': '#e5c6b4',
    },
    image: { bg1: '#ffe6a3', bg2: '#ffc8a2', bg3: '#ffa9a0', accent: '#e4572a', ink: '#2f160b', card: '#ffffff', pill: '#bf3f0c' },
  }),

  oceano: lightTheme({
    name: 'Océano',
    hint: 'Celeste, azul y violeta',
    colors: {
      'grad-1': '#d9f3ff',
      'grad-2': '#bfd8ff',
      'grad-3': '#cdc4ff',
      accent: '#3b82f6',
      'accent-strong': '#1d5bcc',
      'accent-deep': '#17479f',
      'accent-wash': '#e7efff',
      'accent-wash-2': '#d4e2ff',
      'accent-line': '#c4d6fa',
      'inverse-accent-hover': '#639cf8',
      ink: '#0e1b33',
      'ink-2': '#42526d',
      'ink-3': '#5a6983',
      paper: '#f6f9ff',
      surface: '#fdfeff',
      'surface-2': '#f8faff',
      wash: '#edf1f8',
      'wash-2': '#f3f6fb',
      'wash-hover': '#ebf0f8',
      taken: '#e9eef6',
      'on-accent': '#f8fbff',
      line: '#dce4f0',
      'line-strong': '#bccbe0',
    },
    image: { bg1: '#d9f3ff', bg2: '#bfd8ff', bg3: '#cdc4ff', accent: '#2f6fe0', ink: '#0e1b33', card: '#ffffff', pill: '#1d5bcc' },
  }),

  lavanda: lightTheme({
    name: 'Lavanda',
    hint: 'Lila, violeta y rosa',
    colors: {
      'grad-1': '#f1e6ff',
      'grad-2': '#ddcbff',
      'grad-3': '#ffcdea',
      accent: '#a36ef7',
      'accent-strong': '#6c32d6',
      'accent-deep': '#5523ad',
      'accent-wash': '#f1e9ff',
      'accent-wash-2': '#e3d5ff',
      'accent-line': '#d9c8fa',
      'inverse-accent-hover': '#b07ff8',
      ink: '#1f1033',
      'ink-2': '#524366',
      'ink-3': '#6a5b7f',
      paper: '#fbf8ff',
      surface: '#fefdff',
      'surface-2': '#fbf9ff',
      wash: '#f2eef8',
      'wash-2': '#f7f4fb',
      'wash-hover': '#f1ecf8',
      taken: '#efeaf5',
      'on-accent': '#fcfaff',
      line: '#e6def1',
      'line-strong': '#cdc0e0',
    },
    image: { bg1: '#f1e6ff', bg2: '#ddcbff', bg3: '#ffcdea', accent: '#8b4cf0', ink: '#1f1033', card: '#ffffff', pill: '#6c32d6' },
  }),

  noche: darkTheme({
    name: 'Noche',
    hint: 'Oscuro, ciruela y fucsia',
    colors: {
      'grad-1': '#2b1840',
      'grad-2': '#41173a',
      'grad-3': '#2a1d4d',
      stripe: '#a070b0',
      accent: '#f05cc4',
      'accent-strong': '#ff8ad8',
      'accent-deep': '#ffb8e8',
      'accent-wash': '#3a1a34',
      'accent-wash-2': '#4a2243',
      'accent-line': '#5c2d54',
      ink: '#f8ecf5',
      'ink-2': '#d6c0d1',
      'ink-3': '#b49cb0',
      paper: '#17101c',
      surface: '#211827',
      'surface-2': '#261c2d',
      wash: '#2e2235',
      'wash-2': '#2a1f31',
      'wash-hover': '#33263b',
      taken: '#1b131f',
      'on-accent': '#2a0b22',
      line: '#3a2c42',
      'line-strong': '#5a4664',
      'inverse-accent': '#c81f8c',
      'on-inverse-accent': '#fffafd',
      'inverse-accent-hover': '#a3166f',
    },
    image: { bg1: '#2b1840', bg2: '#41173a', bg3: '#2a1d4d', accent: '#ff7ad3', ink: '#fbeef7', card: '#1c1224', pill: '#c81f8c' },
  }),

  grafito: darkTheme({
    name: 'Grafito',
    hint: 'Oscuro, gris y ámbar',
    colors: {
      'grad-1': '#22252b',
      'grad-2': '#2b2e35',
      'grad-3': '#3a3426',
      stripe: '#8a8f99',
      accent: '#f5c542',
      'accent-strong': '#ffd45e',
      'accent-deep': '#ffe39a',
      'accent-wash': '#2f2a17',
      'accent-wash-2': '#3b341b',
      'accent-line': '#4d4421',
      ink: '#f2f4f7',
      'ink-2': '#c3c9d2',
      'ink-3': '#9ea6b1',
      paper: '#121417',
      surface: '#1b1e23',
      'surface-2': '#1f2328',
      wash: '#262a31',
      'wash-2': '#22262c',
      'wash-hover': '#2b3038',
      taken: '#16181c',
      'on-accent': '#1d1700',
      line: '#2f343c',
      'line-strong': '#4a515c',
      'inverse-accent': '#8a6400',
      'on-inverse-accent': '#ffffff',
      'inverse-accent-hover': '#6e5000',
    },
    image: { bg1: '#1f2227', bg2: '#2b2e35', bg3: '#3d3626', accent: '#f5c542', ink: '#f5f6f8', card: '#16181c', pill: '#8a6400' },
  }),
}

export const DEFAULT_THEME = 'flyer'

export const themeById = (id) => THEMES[id] ?? THEMES[DEFAULT_THEME]

/** Colores que se pueden elegir a mano para la imagen, en el orden en que se muestran. */
export const IMAGE_COLOR_FIELDS = {
  bg1: 'Fondo, izquierda',
  bg2: 'Fondo, centro',
  bg3: 'Fondo, derecha',
  accent: 'Título y premios',
  ink: 'Textos y números',
  card: 'Casillas',
}

const HEX = /^#[0-9a-f]{6}$/i

export const isHexColor = (value) => typeof value === 'string' && HEX.test(value)

/** Deja una paleta personalizada válida o devuelve null si le falta o le sobra algo. */
export function normalizeImageColors(colors) {
  if (!colors || typeof colors !== 'object') return null
  const clean = {}
  for (const key of Object.keys(IMAGE_COLOR_FIELDS)) {
    if (!isHexColor(colors[key])) return null
    clean[key] = colors[key].toLowerCase()
  }
  return clean
}

/**
 * La paleta con la que se dibuja la imagen: la del tema de la app, la de otro tema
 * o la personalizada (si no hay una válida guardada, la del tema de la app).
 */
export function resolveImagePalette(share, appTheme) {
  if (share.palette === 'custom') {
    const custom = normalizeImageColors(share.colors)
    if (custom) return custom
  }
  return themeById(THEMES[share.palette] ? share.palette : appTheme).image
}

// ---------- Utilidades de color ----------

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (channels) => `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`

/** `hex` con transparencia, para el canvas. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = rgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

/** Mezcla dos colores: `amount` 0 es `a`, 1 es `b`. */
export function mix(a, b, amount) {
  const [ra, ga, ba] = rgb(a)
  const [rb, gb, bb] = rgb(b)
  return toHex([ra + (rb - ra) * amount, ga + (gb - ga) * amount, ba + (bb - ba) * amount])
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Relación de contraste WCAG entre dos colores (de 1 a 21). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Color de texto para letra grande sobre `bg`: blanco si alcanza 3:1 (como las bandas del
 * flyer original); si no, el candidato con más contraste.
 */
export function textOn(bg, candidates) {
  if (contrast(bg, '#ffffff') >= 3) return '#ffffff'
  return candidates.reduce((best, c) => (contrast(bg, c) > contrast(bg, best) ? c : best), '#ffffff')
}

// ---------- Aplicar el tema a la página ----------

const STORAGE_KEY = 'rifa-theme'

/** El último tema usado, para pintar la app con sus colores antes de leer la base. */
export function cachedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(id) {
  const theme = themeById(id)
  const root = document.documentElement
  for (const [token, value] of Object.entries(theme.colors)) root.style.setProperty(`--${token}`, value)
  root.style.colorScheme = theme.scheme
  root.dataset.theme = THEMES[id] ? id : DEFAULT_THEME
  // La barra del navegador y de la PWA instalada acompañan el tema.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors['grad-2'])
  try {
    localStorage.setItem(STORAGE_KEY, root.dataset.theme)
  } catch {
    // Sin almacenamiento (ventana privada): sólo se pierde el pintado inmediato al abrir.
  }
}
