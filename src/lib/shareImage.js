import { canvasToBlob } from './canvas.js'
import { textFont, titleFont } from './fonts.js'
import { formatMoney, packPhrase } from './format.js'
import { THEMES, mix, textOn, withAlpha } from './themes.js'

export const IMAGE_FORMATS = {
  story: { width: 1080, height: 1920, label: 'Historia', hint: '9:16' },
  post: { width: 1080, height: 1350, label: 'Publicación', hint: '4:5' },
}

export const IMAGE_MODES = {
  available: { label: 'Sólo disponibles', hint: 'Oculta los tomados' },
  crossed: { label: 'Grilla completa', hint: 'Tacha los tomados' },
}

const loaded = new Map()

/** Carga (una vez) los pesos que usa la imagen: el canvas no espera a las fuentes por su cuenta. */
function ensureFonts(type) {
  const specs = [
    `${type.title.weight} 100px ${type.title.family}`,
    ...[600, 700, 800].map((w) => `${w} 40px ${type.text.family}`),
    `${type.text.soft.weight} 40px ${type.text.soft.family}`,
  ]
  return Promise.all(
    specs.map((spec) => {
      if (!loaded.has(spec)) loaded.set(spec, document.fonts.load(spec).catch(() => {}))
      return loaded.get(spec)
    }),
  )
}

/** Todos los colores de la imagen salen de los seis de la paleta. */
function paletteColors(palette) {
  const pill = palette.pill ?? mix(palette.accent, palette.ink, 0.2)
  return {
    ...palette,
    pill,
    onAccent: textOn(palette.accent, [palette.ink, palette.card]),
    onPill: textOn(pill, [palette.ink, palette.card]),
  }
}

/** Generador pseudoaleatorio con semilla: la misma rifa siempre produce la misma imagen. */
function seeded(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function setFont(ctx, weight, size, family) {
  ctx.font = `${weight} ${size}px ${family}`
}

function wrap(ctx, text, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

/** Busca el tamaño más grande en el que el texto entra en `maxLines` líneas de `maxWidth`. */
function fitWrapped(ctx, text, { maxWidth, maxSize, minSize, maxLines, weight, family }) {
  for (let size = maxSize; size > minSize; size -= 2) {
    setFont(ctx, weight, size, family)
    const lines = wrap(ctx, text, maxWidth)
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) {
      return { size, lines }
    }
  }
  setFont(ctx, weight, minSize, family)
  return { size: minSize, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) }
}

function drawBackground(ctx, w, h, color) {
  const base = ctx.createLinearGradient(0, 0, w, 0)
  base.addColorStop(0, color.bg1)
  base.addColorStop(0.42, color.bg2)
  base.addColorStop(1, color.bg3)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)

  // Rayas verticales irregulares, como el fondo del flyer original.
  const rnd = seeded(20251116)
  for (let x = 0; x < w; ) {
    const stripe = 4 + rnd() * 36
    if (rnd() > 0.3) {
      ctx.fillStyle = withAlpha(color.card, (0.05 + rnd() * 0.22).toFixed(3))
      ctx.fillRect(x, 0, stripe, h)
    }
    if (rnd() > 0.85) {
      ctx.fillStyle = withAlpha(color.accent, 0.06)
      ctx.fillRect(x + stripe, 0, 3, h)
    }
    x += stripe + rnd() * 20
  }
}

function drawHeader(ctx, config, w, compact, { color, type }) {
  const margin = 64
  const top = compact ? 56 : 76
  const prizes = config.prizes.filter(Boolean)
  const leftW = prizes.length ? 420 : w - margin * 2

  // Título: se ubica por lo que mide de verdad la letra elegida (cada fuente tiene otra altura).
  const title = type.title.upper ? (config.title || 'Rifa').toUpperCase() : config.title || 'Rifa'
  const t = fitWrapped(ctx, title, {
    maxWidth: leftW,
    maxSize: compact ? 240 : 300,
    minSize: 64,
    maxLines: 3,
    weight: type.title.weight,
    family: type.title.family,
  })
  ctx.fillStyle = color.accent
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  const titleLine = t.size * type.title.lineHeight
  let y = top + ctx.measureText(t.lines[0]).actualBoundingBoxAscent
  t.lines.forEach((line, i) => ctx.fillText(line, margin - 6, y + i * titleLine))
  y += (t.lines.length - 1) * titleLine
  // Las cursivas y minúsculas bajan de la línea: lo que sigue arranca debajo de las colas.
  y += ctx.measureText(t.lines.at(-1)).actualBoundingBoxDescent

  // Precio
  if (config.price > 0) {
    y += compact ? 112 : 150
    const price = fitWrapped(ctx, formatMoney(config.price), {
      maxWidth: leftW,
      maxSize: compact ? 88 : 108,
      minSize: 40,
      maxLines: 1,
      weight: 800,
      family: type.text.family,
    })
    ctx.fillStyle = color.accent
    ctx.fillText(price.lines[0], margin, y)

    const pack = packPhrase(config)
    if (pack) {
      y += compact ? 52 : 64
      const p = fitWrapped(ctx, pack, {
        maxWidth: leftW,
        maxSize: compact ? 42 : 50,
        minSize: 24,
        maxLines: 1,
        weight: type.text.soft.weight,
        family: type.text.soft.family,
      })
      ctx.fillStyle = color.ink
      ctx.fillText(p.lines[0], margin + 4, y)
    }
  }
  let bottom = y + 16

  // Premios: bandas rosas que sangran hacia el borde derecho.
  if (prizes.length) {
    const x0 = margin + leftW + 36
    const gap = compact ? 12 : 16
    const areaH = compact ? 440 : 600
    const bandH = Math.min(compact ? 104 : 128, (areaH - gap * (prizes.length - 1)) / prizes.length)
    const twoLine = bandH >= 74

    prizes.forEach((prize, i) => {
      const by = top + i * (bandH + gap)
      const bx = x0 + (i % 2 ? 26 : 0)
      const textX = bx + 26
      const textW = w - margin - textX + 30

      ctx.fillStyle = color.accent
      ctx.fillRect(bx, by, w - bx, bandH)
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.fillRect(bx, by, w - bx, 3)

      ctx.fillStyle = color.onAccent
      const label = `${i + 1}° PREMIO`
      if (twoLine) {
        const pad = bandH * 0.16
        const labelSize = Math.round(Math.min(24, Math.max(16, bandH * 0.2)))
        setFont(ctx, 700, labelSize, type.text.family)
        ctx.letterSpacing = '3px'
        ctx.globalAlpha = 0.85
        ctx.fillText(label, textX, by + pad + labelSize * 0.8)
        ctx.globalAlpha = 1
        ctx.letterSpacing = '0px'

        const nameTop = by + pad + labelSize + 6
        const nameH = bandH - pad * 2 - labelSize - 6
        // Una línea grande si entra; dos líneas sólo cuando así la letra queda más grande.
        const fit = (lines) =>
          fitWrapped(ctx, prize.toUpperCase(), {
            maxWidth: textW,
            maxSize: Math.min(46, Math.floor(nameH / (lines === 2 ? 2.1 : 1.05))),
            minSize: 16,
            maxLines: lines,
            weight: 600,
            family: type.text.family,
          })
        const single = fit(1)
        const double = nameH >= 44 ? fit(2) : single
        const n = double.size > single.size ? double : single
        setFont(ctx, 600, n.size, type.text.family)
        const lh = n.size * 1.05
        const blockH = lh * n.lines.length
        const startY = nameTop + (nameH - blockH) / 2 + n.size * 0.82
        n.lines.forEach((line, li) => ctx.fillText(line, textX, startY + li * lh))
      } else {
        const n = fitWrapped(ctx, `${i + 1}° ${prize.toUpperCase()}`, {
          maxWidth: textW,
          maxSize: Math.floor(bandH * 0.5),
          minSize: 14,
          maxLines: 1,
          weight: 600,
          family: type.text.family,
        })
        ctx.fillText(n.lines[0], textX, by + bandH / 2 + n.size * 0.36)
      }
    })
    bottom = Math.max(bottom, top + prizes.length * (bandH + gap) - gap)
  }
  return bottom
}

function drawFooter(ctx, config, w, h, compact, { color, type }) {
  const margin = 64
  const bottomPad = compact ? 52 : 72
  if (!config.drawText) return h - bottomPad
  const f = fitWrapped(ctx, config.drawText, {
    maxWidth: w - margin * 2,
    maxSize: compact ? 36 : 42,
    minSize: 20,
    maxLines: 2,
    weight: 600,
    family: type.text.family,
  })
  const lh = f.size * 1.2
  const top = h - bottomPad - lh * f.lines.length
  ctx.fillStyle = color.ink
  ctx.textAlign = 'center'
  f.lines.forEach((line, i) => ctx.fillText(line, w / 2, top + f.size * 0.9 + i * lh))
  ctx.textAlign = 'left'
  return top
}

/** Elige columnas para que las celdas sean lo más grandes posible dentro del área. */
function fitGrid(count, areaW, areaH, { ratio, gap, maxCell, columns }) {
  const candidates = columns ?? Array.from({ length: count }, (_, i) => i + 1)
  let best = null
  for (const cols of candidates) {
    const rows = Math.ceil(count / cols)
    const byWidth = (areaW - gap * (cols - 1)) / cols
    const byHeight = (areaH - gap * (rows - 1)) / rows / ratio
    // Nunca negativo: si el área no alcanza, la grilla desborda en vez de romper roundRect.
    const cell = Math.max(1, Math.min(byWidth, byHeight, maxCell))
    // Ante un empate (celdas topeadas por maxCell) se prefieren más columnas: filas, no una torre.
    if (!best || cell >= best.cell - 0.5) best = { cols, rows, cell }
  }
  return { ...best, cellH: best.cell * ratio }
}

function drawCross(ctx, x, y, cw, ch, rnd, ink) {
  const j = () => (rnd() - 0.5) * cw * 0.14
  ctx.save()
  ctx.strokeStyle = ink
  ctx.lineWidth = Math.max(2.5, cw * 0.075)
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x + cw * 0.2 + j(), y + ch * 0.08 + j())
  ctx.quadraticCurveTo(x + cw / 2 + j(), y + ch / 2 + j(), x + cw * 0.8 + j(), y + ch * 0.92 + j())
  ctx.moveTo(x + cw * 0.78 + j(), y + ch * 0.1 + j())
  ctx.quadraticCurveTo(x + cw / 2 + j(), y + ch / 2 + j(), x + cw * 0.22 + j(), y + ch * 0.9 + j())
  ctx.stroke()
  ctx.restore()
}

const GRID_COLUMNS = [10, 15, 20, 25, 30, 40, 50]

function drawNumbers(ctx, area, { total, taken, available, mode, compact, color, type }) {
  const crossed = mode === 'crossed'
  const numbers = crossed ? Array.from({ length: total }, (_, i) => i + 1) : available
  const pad = compact ? 24 : 32
  const headH = compact ? 50 : 64
  const headGap = compact ? 18 : 24
  const gap = numbers.length > 500 ? 4 : numbers.length > 150 ? 8 : 12

  const innerW = area.w - pad * 2
  const maxGridH = area.h - pad * 2 - headH - headGap

  let grid = null
  if (numbers.length) {
    grid = fitGrid(numbers.length, innerW, maxGridH, {
      ratio: 0.68,
      gap,
      maxCell: 150,
      // En la grilla completa se respetan filas redondas para que se lea como el talonario;
      // las de 30 a 50 hacen falta para que 500-1000 números no queden en una torre ilegible.
      columns: crossed && numbers.length >= 10 ? GRID_COLUMNS.filter((c) => c <= numbers.length) : undefined,
    })
  }
  const gridH = grid ? grid.rows * grid.cellH + (grid.rows - 1) * gap : (compact ? 220 : 320)
  const panelH = pad * 2 + headH + headGap + gridH
  const panelY = area.y + Math.max(0, (area.h - panelH) / 2)

  ctx.fillStyle = withAlpha(color.card, 0.52)
  ctx.strokeStyle = withAlpha(color.card, 0.95)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.roundRect(area.x, panelY, area.w, panelH, 30)
  ctx.fill()
  ctx.stroke()

  // Encabezado del panel
  const headY = panelY + pad
  const headMid = headY + headH / 2
  const labelSize = compact ? 26 : 32
  setFont(ctx, 700, labelSize, type.text.family)
  ctx.letterSpacing = '4px'
  ctx.fillStyle = color.ink
  ctx.fillText(crossed ? 'NÚMEROS' : 'NÚMEROS DISPONIBLES', area.x + pad, headMid + labelSize * 0.36)
  ctx.letterSpacing = '0px'

  const pillText = crossed ? `Quedan ${available.length}` : `${available.length} de ${total}`
  const pillSize = compact ? 26 : 30
  setFont(ctx, 700, pillSize, type.text.family)
  const pillW = ctx.measureText(pillText).width + pillSize * 1.4
  const pillX = area.x + area.w - pad - pillW
  ctx.fillStyle = color.pill
  ctx.beginPath()
  ctx.roundRect(pillX, headY, pillW, headH, headH / 2)
  ctx.fill()
  ctx.fillStyle = color.onPill
  ctx.textAlign = 'center'
  ctx.fillText(pillText, pillX + pillW / 2, headMid + pillSize * 0.36)

  const gridTop = headY + headH + headGap

  if (!grid) {
    const soldOut = type.title.upper ? '¡AGOTADOS!' : '¡Agotados!'
    fitWrapped(ctx, soldOut, {
      maxWidth: innerW,
      maxSize: compact ? 120 : 160,
      minSize: 48,
      maxLines: 1,
      weight: type.title.weight,
      family: type.title.family,
    })
    ctx.fillStyle = color.accent
    ctx.fillText(soldOut, area.x + area.w / 2, gridTop + gridH * 0.55)
    setFont(ctx, type.text.soft.weight, compact ? 40 : 48, type.text.soft.family)
    ctx.fillStyle = color.ink
    ctx.fillText('Gracias por participar', area.x + area.w / 2, gridTop + gridH * 0.55 + (compact ? 70 : 90))
    ctx.textAlign = 'left'
    return
  }

  const { cols, cell, cellH } = grid
  const gridW = cols * cell + (cols - 1) * gap
  const gridX = area.x + pad + (innerW - gridW) / 2
  // El número más ancho posible (p. ej. "888") tiene que entrar en la casilla con la letra elegida.
  setFont(ctx, 600, 100, type.text.family)
  const widest = ctx.measureText('8'.repeat(String(total).length)).width / 100
  const numSize = Math.min(cellH * 0.56, (cell * 0.84) / widest)
  const rnd = seeded(total * 31 + taken.size)

  numbers.forEach((n, i) => {
    const x = gridX + (i % cols) * (cell + gap)
    const y = gridTop + Math.floor(i / cols) * (cellH + gap)
    const isTaken = taken.has(n)

    ctx.fillStyle = withAlpha(color.card, isTaken ? 0.35 : 0.92)
    ctx.strokeStyle = isTaken ? withAlpha(color.ink, 0.08) : withAlpha(color.accent, 0.38)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.roundRect(x, y, cell, cellH, Math.min(18, cell * 0.16))
    ctx.fill()
    ctx.stroke()

    setFont(ctx, 600, Math.round(numSize), type.text.family)
    ctx.fillStyle = isTaken ? withAlpha(color.ink, 0.3) : color.ink
    ctx.fillText(String(n), x + cell / 2, y + cellH / 2 + numSize * 0.36)

    if (isTaken) drawCross(ctx, x, y, cell, cellH, rnd, color.ink)
  })
  ctx.textAlign = 'left'
}

/**
 * Dibuja el flyer de la rifa y devuelve un PNG.
 * @param {{
 *   config: object, available: number[], mode: 'available'|'crossed', format: 'story'|'post',
 *   palette?: object, titleFont?: string, textFont?: string,
 * }} opts `palette` es una paleta de imagen (ver lib/themes.js); las fuentes, ids de lib/fonts.js.
 */
export async function renderRaffleImage({ config, available, mode, format, palette, titleFont: title, textFont: text }) {
  const style = {
    color: paletteColors(palette ?? THEMES.flyer.image),
    type: { title: titleFont(title), text: textFont(text) },
  }
  await ensureFonts(style.type)
  const { width, height } = IMAGE_FORMATS[format] ?? IMAGE_FORMATS.story
  const compact = height < 1600

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  const availableSet = new Set(available)
  const taken = new Set()
  for (let n = 1; n <= config.total; n++) if (!availableSet.has(n)) taken.add(n)

  drawBackground(ctx, width, height, style.color)
  const headerBottom = drawHeader(ctx, config, width, compact, style)
  const footerTop = drawFooter(ctx, config, width, height, compact, style)
  const gapY = compact ? 32 : 48
  drawNumbers(
    ctx,
    { x: 52, y: headerBottom + gapY, w: width - 104, h: footerTop - headerBottom - gapY * 2 },
    { total: config.total, taken, available, mode, compact, ...style },
  )

  return canvasToBlob(canvas, 'image/png')
}
