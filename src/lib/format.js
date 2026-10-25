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

const date = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })

export function formatDate(timestamp) {
  return date.format(timestamp)
}

/** Número de comprobante para mostrar: en una rifa en la nube es provisorio hasta que lo confirma el servidor. */
export function saleLabel(sale) {
  return `#${sale.seq}${sale.provisional ? ' (provisorio)' : ''}`
}

export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

export function todayStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** "Club Atenas 2026" → "club-atenas-2026", para nombres de archivo. */
export function slug(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

/** "rifa-respaldo-club-atenas-2026-10-25.json". Con el título por defecto no se repite "rifa". */
export function exportFileName(kind, title, extension) {
  const name = slug(title)
  return ['rifa', kind, name !== 'rifa' && name, todayStamp()].filter(Boolean).join('-') + `.${extension}`
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

/**
 * Quién hizo una venta de una rifa en la nube: «vos» si fue la cuenta de este teléfono.
 * @param {{ id: number, name: string }|null} createdBy
 * @param {{ id: number }|null} [user] la cuenta con sesión
 */
export function sellerName(createdBy, user) {
  if (!createdBy) return ''
  if (user && createdBy.id === user.id) return 'vos'
  return createdBy.name || 'otra persona'
}
