const money = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 })

export function formatMoney(value) {
  return `$${money.format(value || 0)}`
}

const WORDS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez']

function hasPack({ packSize, packPrice }) {
  return packSize > 1 && packPrice > 0
}

/** "(o dos por $8.000)" */
export function packPhrase(config) {
  if (!hasPack(config)) return ''
  return `(o ${WORDS[config.packSize] ?? config.packSize} por ${formatMoney(config.packPrice)})`
}

/** Precio calculado de N números de un mismo comprobante, aplicando la promo configurada. */
export function priceFor(count, config) {
  if (!hasPack(config)) return count * config.price
  const packs = Math.floor(count / config.packSize)
  return packs * config.packPrice + (count % config.packSize) * config.price
}

/** Cómo se llegó al monto calculado: "2 promos + 1 suelto". */
export function priceBreakdown(count, config) {
  if (!hasPack(config)) return `${plural(count, 'número', 'números')} a ${formatMoney(config.price)}`
  const packs = Math.floor(count / config.packSize)
  const singles = count % config.packSize
  const parts = []
  if (packs) parts.push(plural(packs, 'promo', 'promos'))
  if (singles) parts.push(plural(singles, 'suelto', 'sueltos'))
  return parts.join(' + ') || 'sin números'
}

const dateTime = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatDateTime(timestamp) {
  return dateTime.format(timestamp)
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

export function todayStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Mensaje de texto plano con los disponibles, para pegar en WhatsApp junto a la imagen. */
export function availableMessage(config, available) {
  const title = (config.title || 'Rifa').toUpperCase()
  const lines = [`${title} · Números disponibles (${available.length} de ${config.total})`]
  lines.push(available.length ? available.join(', ') : '¡No quedan números!')
  if (config.price > 0) lines.push(`${formatMoney(config.price)} ${packPhrase(config)}`.trim())
  if (config.drawText) lines.push(config.drawText)
  return lines.join('\n\n')
}
