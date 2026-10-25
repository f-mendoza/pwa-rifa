import { inRanges } from '../db.js'

/**
 * Qué puede hacer la persona en la rifa abierta, para ocultar o deshabilitar en la UI lo que su
 * rol no permite (el servidor valida igual). Una rifa local permite todo.
 *
 * | Rol      | Puede                                                                          |
 * |----------|--------------------------------------------------------------------------------|
 * | owner    | todo: configuración, borrar la rifa, miembros                                  |
 * | seller   | vender, liberar y pasar números de su talonario, anular sus ventas, comprobantes |
 * | viewer   | sólo mirar                                                                     |
 *
 * Una rifa en la nube borrada, sin acceso o de otra cuenta queda de sólo lectura.
 * @param {{ raffle: { remote: object|null }, sync: object|null }} data lo que da `useRaffle()`
 */
export function permissionsFor(data) {
  const remote = data?.raffle?.remote
  if (!remote) return LOCAL
  const status = remote.status ?? 'active'
  const otherAccount = Boolean(data.sync?.otherAccount)
  const active = status === 'active' && !otherAccount
  const role = remote.role ?? 'viewer'
  const writer = active && (role === 'owner' || role === 'seller')
  const ranges = role === 'seller' ? (remote.ranges ?? null) : null
  return {
    cloud: true,
    role,
    status,
    otherAccount,
    ranges,
    readOnly: !writer,
    /** Vender números libres (dentro del talonario, ver `canSellNumber`). */
    sell: writer,
    /** Editar personas, montos y comprobantes; liberar o pasar números. */
    edit: writer,
    /** Cambiar el estilo de la imagen. */
    share: writer,
    /** Cambiar la configuración de la rifa. */
    config: active && role === 'owner',
    /** Invitar, cambiar roles, talonarios y quitar miembros. */
    manageMembers: active && role === 'owner',
    /** Borrar la rifa de la nube (si no, sale de ella). */
    owner: role === 'owner',
    canSellNumber: (n) => writer && inRanges(ranges, n),
    /** Liberar o pasar a otra persona un número vendido. */
    canChangeNumber: (n) => writer && inRanges(ranges, n),
    canVoid: (purchase) => writer && (role === 'owner' || (purchase?.createdBy?.id != null && purchase.createdBy.id === remote.userId)),
  }
}

const yes = () => true

const LOCAL = Object.freeze({
  cloud: false,
  role: null,
  status: 'active',
  otherAccount: false,
  ranges: null,
  readOnly: false,
  sell: true,
  edit: true,
  share: true,
  config: true,
  manageMembers: false,
  owner: true,
  canSellNumber: yes,
  canChangeNumber: yes,
  canVoid: yes,
})

export const ROLE_LABELS = {
  owner: 'Organiza',
  seller: 'Vende',
  viewer: 'Sólo mira',
}

export const ROLE_HINTS = {
  owner: 'Puede cambiar todo e invitar',
  seller: 'Puede vender y cobrar',
  viewer: 'Puede ver la rifa, sin cambiar nada',
}

/**
 * Qué hace "borrar" según la rifa: una local se borra (`delete`); una en la nube se borra para
 * todos si es de quien organiza (`delete-cloud`) o se sale de ella (`leave`); una borrada, sin
 * acceso o de otra cuenta sólo se quita de este teléfono (`remove`).
 * @param {ReturnType<typeof permissionsFor>} perms
 */
export function deleteKind(perms) {
  if (!perms.cloud) return 'delete'
  if (perms.status !== 'active' || perms.otherAccount) return 'remove'
  return perms.owner ? 'delete-cloud' : 'leave'
}
