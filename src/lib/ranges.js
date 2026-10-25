/**
 * Talonarios: los números que puede vender una persona en una rifa en la nube.
 * Se guardan como `[[1, 100], [201, 250]]` (o `null` = sin talonario, puede vender cualquiera)
 * y se escriben como «1-100, 201-250».
 */

/** Ordena y une los rangos que se pisan o se tocan: `[[5,10],[1,6],[11,12]]` → `[[1,12]]`. */
export function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  for (const [from, to] of sorted) {
    const last = merged.at(-1)
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to)
    else merged.push([from, to])
  }
  return merged
}

/**
 * Lee lo que escribió la persona. Acepta «1-100, 201-250», números sueltos («7, 9»), espacios,
 * punto y coma y guiones largos. Vacío = sin talonario.
 * @param {string} text
 * @param {{ max?: number }} options `max`: el total de números de la rifa
 * @returns {{ ranges: Array<[number, number]>|null, error: string|null }}
 */
export function parseRanges(text, { max = 1000 } = {}) {
  const clean = String(text ?? '').trim()
  if (!clean) return { ranges: null, error: null }
  const parts = clean
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const ranges = []
  for (const part of parts) {
    const match = /^(\d+)\s*(?:[-–—]|a|al)\s*(\d+)$/i.exec(part) ?? /^(\d+)$/.exec(part)
    if (!match) return { ranges: null, error: `No entiendo «${part}». Escribí rangos como 1-100, 201-250.` }
    const from = Number(match[1])
    const to = Number(match[2] ?? match[1])
    if (from < 1 || to < 1) return { ranges: null, error: 'Los números empiezan en 1.' }
    if (from > to) return { ranges: null, error: `En «${part}» el primer número tiene que ser el menor.` }
    if (to > max) return { ranges: null, error: `La rifa tiene ${max} números: «${part}» se pasa.` }
    ranges.push([from, to])
  }
  return { ranges: mergeRanges(ranges), error: null }
}

/** `[[1,100],[201,250]]` → «1-100, 201-250» (y `[[7,7]]` → «7»). Sin talonario, vacío. */
export function formatRanges(ranges) {
  if (!ranges?.length) return ''
  return ranges.map(([from, to]) => (from === to ? String(from) : `${from}-${to}`)).join(', ')
}

/** Cuántos números entran en el talonario (`null` si no tiene). */
export function rangeSize(ranges) {
  if (!ranges) return null
  return ranges.reduce((sum, [from, to]) => sum + (to - from + 1), 0)
}
