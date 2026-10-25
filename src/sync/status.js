import { plural } from '../lib/format.js'

/**
 * Qué decirle a la persona sobre la sincronización de la rifa abierta (sólo rifas en la nube).
 * `tone`: ok | pending | offline | warn | error.
 * @param {{ status: string, pending: number, needsLogin: boolean, otherAccount?: boolean }} sync lo que da `useRaffle().sync`
 */
export function describeSyncState(sync, { online = true } = {}) {
  const unsent = sync.pending > 0 ? plural(sync.pending, 'cambio sin enviar', 'cambios sin enviar') : null
  if (sync.status === 'deleted') return { tone: 'error', label: 'Esta rifa se borró de la nube', detail: null }
  if (sync.status === 'revoked') return { tone: 'error', label: 'Ya no tenés acceso a esta rifa', detail: null }
  if (sync.otherAccount) {
    return { tone: 'warn', label: 'Esta rifa es de otra cuenta', detail: unsent ?? 'iniciá sesión con esa cuenta para sincronizarla' }
  }
  if (sync.needsLogin) return { tone: 'warn', label: 'Iniciá sesión para sincronizar', detail: unsent }
  if (!online) return { tone: 'offline', label: 'Sin conexión', detail: unsent }
  if (unsent) return { tone: 'pending', label: unsent, detail: null }
  return { tone: 'ok', label: 'Sincronizado', detail: null }
}

const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)
const ofNumbers = (numbers = []) => (numbers.length === 1 ? `del número ${numbers[0]}` : `de los números ${andList(numbers)}`)

/** Qué cambio de este teléfono no se pudo guardar, en palabras (el porqué lo da el servidor en `message`). */
export function describeConflict(conflict) {
  const p = conflict.payload ?? {}
  switch (conflict.type) {
    case 'numbers.assign':
      return `Venta ${ofNumbers(p.numbers)} a ${p.person?.name ?? 'una persona'}`
    case 'number.release':
      return `Liberar el número ${p.number}`
    case 'number.transfer':
      return `Pasar el número ${p.number} a ${p.person?.name ?? 'otra persona'}`
    case 'sale.void':
      return 'Anular una venta'
    case 'sale.setAmount':
      return 'Corregir el monto de una venta'
    case 'person.update':
      return `Editar los datos de ${p.data?.name ?? 'una persona'}`
    case 'raffle.updateConfig':
      return 'Cambiar la configuración de la rifa'
    case 'raffle.updateShare':
      return 'Cambiar el estilo de la imagen'
    case 'receipt.set':
      return 'Adjuntar un comprobante'
    case 'receipt.remove':
      return 'Quitar un comprobante'
    case 'receipt.upload':
      return `Subir el comprobante${p.name ? ` «${p.name}»` : ''}`
    default:
      return 'Un cambio'
  }
}
