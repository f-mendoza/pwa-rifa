import { cleanPerson, inRanges, normalizeAmount, normalizeConfig, normalizeSharePrefs, personKey } from '../db.js'
import { newId } from '../lib/ids.js'
import { mergeRanges } from '../lib/ranges.js'
import { MAX_OPS_PER_BATCH, SyncError } from './transport.js'

/**
 * Servidor en memoria con la misma semántica que la API (docs/sync-protocolo.md): versiones
 * globales, bajas lógicas, idempotencia por `opId`, unificación de personas con alias, roles y
 * talonarios, `seq` asignado por el servidor y rechazos con mensajes en castellano.
 *
 * Sirve para los tests del motor y para probar la app en desarrollo. Cada persona (y cada
 * teléfono) habla con él a través de su propio transporte: `server.transportFor(user)`.
 *
 *   const server = createFakeServer()
 *   const ana = server.createUser('Ana')
 *   const phone = server.transportFor(ana)
 *   phone.setOnline(false)          // sin conexión
 *   server.expireSessions(ana)      // 401 en el próximo pedido
 *
 * Además de la sincronización tiene cuentas (con contraseña y tokens), miembros e invitaciones,
 * igual que la API: `server.client({ getToken })` da un cliente con la misma interfaz que
 * `createApiClient` (src/sync/api.js), que es lo que usa la app en el modo `/?nube-falsa`.
 */
export function createFakeServer({ now = () => Date.now() } = {}) {
  let version = 0
  let lastUserId = 0
  const users = new Map()
  const raffles = new Map()
  /** token de sesión → id de la cuenta. */
  const tokens = new Map()
  /** token de invitación → invitación. */
  const invitations = new Map()
  /** correo → token para cambiar la contraseña. */
  const resetTokens = new Map()
  /** opId → resultado guardado (idempotencia). */
  const operations = new Map()

  /**
   * Una versión por operación: todas las filas que toca comparten la misma, y una operación que
   * no cambia nada no consume versión (se pide recién al primer cambio).
   */
  let mutationVersion = null
  const nextVersion = () => (mutationVersion ??= ++version)
  function mutation(fn) {
    mutationVersion = null
    try {
      return fn()
    } finally {
      mutationVersion = null
    }
  }
  const clone = (value) => (value === undefined ? undefined : structuredClone(value))
  const live = (row) => Boolean(row) && !row.deleted

  // ---------- Filas ----------

  function touch(raffle, row) {
    row.version = nextVersion()
    raffle.maxVersion = row.version
    return row
  }

  function touchRaffle(raffle) {
    raffle.version = nextVersion()
    raffle.maxVersion = raffle.version
  }

  const strip = ({ version: _v, ...row }) => clone(row)

  function raffleOut(raffle) {
    const { id, config, share, lastSeq, createdAt, ownerId, deleted } = raffle
    return clone({ id, config, share, lastSeq, createdAt, ownerId, deleted })
  }

  function rowsOf(raffle) {
    return {
      people: [...raffle.people.values()],
      sales: [...raffle.sales.values()],
      numbers: [...raffle.numbers.values()],
      receipts: [...raffle.receipts.values()],
    }
  }

  function snapshotOf(raffle, member) {
    const rows = rowsOf(raffle)
    const alive = (list) => list.filter(live).map(strip)
    return {
      raffle: raffleOut(raffle),
      people: alive(rows.people),
      sales: alive(rows.sales),
      numbers: alive(rows.numbers),
      receipts: alive(rows.receipts),
      role: member.role,
      ranges: clone(member.ranges),
      version: raffle.maxVersion,
    }
  }

  function changesOf(raffle, member, since) {
    const rows = rowsOf(raffle)
    const newer = (list) => list.filter((row) => row.version > since).map(strip)
    return {
      raffle: raffle.version > since ? raffleOut(raffle) : null,
      people: newer(rows.people),
      sales: newer(rows.sales),
      numbers: newer(rows.numbers),
      receipts: newer(rows.receipts),
      aliases: raffle.aliases.filter((a) => a.version > since).map(({ entity, from, to }) => ({ entity, from, to })),
      role: member.role,
      ranges: clone(member.ranges),
      version: raffle.maxVersion,
    }
  }

  // ---------- Personas ----------

  function resolvePerson(raffle, id) {
    const seen = new Set()
    while (raffle.aliasMap.has(id) && !seen.has(id)) {
      seen.add(id)
      id = raffle.aliasMap.get(id)
    }
    return id
  }

  function addAlias(raffle, from, to) {
    if (!from || from === to) return
    raffle.aliasMap.set(from, to)
    const alias = { entity: 'person', from, to, version: nextVersion() }
    raffle.aliases.push(alias)
    raffle.maxVersion = alias.version
  }

  const findByKey = (raffle, key) => [...raffle.people.values()].find((p) => live(p) && p.key === key)

  /** Completa sólo los datos de contacto vacíos de una persona que ya existía. */
  function fillEmpty(raffle, person, data) {
    let changed = false
    for (const field of ['phone', 'email', 'referrer']) {
      if (!person[field] && data[field]) {
        person[field] = data[field]
        changed = true
      }
    }
    if (changed) touch(raffle, person)
  }

  /** ¿El id de persona ya existe en otra rifa? (Los ids los genera el cliente: no se pueden mezclar.) */
  const personElsewhere = (raffle, id) =>
    [...raffles.values()].some((r) => r !== raffle && r.people.has(id))

  /**
   * Persona de `numbers.assign` / `number.transfer` (ver "Notas de implementación" de api/README.md):
   * se resuelve el id por los alias y se busca por nombre entre las vivas.
   */
  function upsertPerson(raffle, rawId, data) {
    const id = rawId ? resolvePerson(raffle, rawId) : null
    const key = personKey(data.name)
    const existing = findByKey(raffle, key)
    const byId = id ? raffle.people.get(id) : null
    if (existing) {
      fillEmpty(raffle, existing, data)
      // Alias salvo que el id sea otra persona viva de la rifa (ahí no se toca a nadie).
      if (id && id !== existing.id && !live(byId)) addAlias(raffle, id, existing.id)
      return existing.id
    }
    if (live(byId)) {
      // La renombraron desde otro teléfono: se usa tal cual, completando sus contactos.
      fillEmpty(raffle, byId, data)
      return byId.id
    }
    const personId = id || newId()
    // Si estaba borrada, se reactiva con los datos nuevos.
    const row = byId ?? { id: personId, createdAt: now() }
    Object.assign(row, { name: data.name, key, phone: data.phone, email: data.email, referrer: data.referrer, deleted: false })
    raffle.people.set(personId, touch(raffle, row))
    return personId
  }

  function dropIfOrphan(raffle, personId) {
    const person = raffle.people.get(personId)
    if (!live(person)) return
    const owns = [...raffle.numbers.values()].some((n) => live(n) && n.participantId === personId)
    const pays = [...raffle.sales.values()].some((s) => live(s) && s.participantId === personId)
    if (!owns && !pays) {
      person.deleted = true
      touch(raffle, person)
    }
  }

  function deleteReceipt(raffle, saleId) {
    const receipt = raffle.receipts.get(saleId)
    raffle.files.delete(saleId)
    if (!live(receipt)) return
    receipt.deleted = true
    touch(raffle, receipt)
  }

  function deleteSale(raffle, sale) {
    sale.deleted = true
    touch(raffle, sale)
    deleteReceipt(raffle, sale.id)
  }


  // ---------- Operaciones ----------

  class Rejection extends Error {
    constructor(reason, message) {
      super(message)
      this.reason = reason
    }
  }
  const reject = (reason, message) => {
    throw new Rejection(reason, message)
  }

  function validPerson(person) {
    try {
      return cleanPerson(person)
    } catch (err) {
      return reject('invalid', err.message)
    }
  }

  function checkPersonId(raffle, person) {
    if (person?.id && personElsewhere(raffle, person.id)) reject('invalid', 'La persona no es válida')
  }

  function validNumber(n) {
    if (!Number.isInteger(n)) reject('invalid', 'El número no es válido')
    return n
  }

  /** "7", "7 y 8", "7, 8 y 9". */
  const andList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`)

  function listNumbers(numbers) {
    return numbers.length === 1 ? `El número ${numbers[0]}` : `Los números ${andList(numbers)}`
  }

  function checkRanges(member, numbers) {
    if (member.role !== 'seller') return
    const outside = numbers.filter((n) => !inRanges(member.ranges, n))
    if (outside.length) {
      reject('outside_ranges', `${listNumbers(outside)} ${outside.length === 1 ? 'está' : 'están'} fuera de tu talonario`)
    }
  }

  const liveSale = (raffle, saleId) => (live(raffle.sales.get(saleId)) ? raffle.sales.get(saleId) : null)

  const handlers = {
    'numbers.assign'({ raffle, user, member, payload, opCreatedAt }) {
      const { saleId, numbers } = payload
      const saleTaken = [...raffles.values()].some((r) => r.sales.has(saleId))
      if (typeof saleId !== 'string' || !saleId || saleTaken) reject('invalid', 'La venta no es válida')
      if (!Array.isArray(numbers) || !numbers.length || !numbers.every(Number.isInteger)) {
        reject('invalid', 'Faltan los números de la venta')
      }
      if (new Set(numbers).size !== numbers.length) reject('invalid', 'Hay números repetidos en la venta')
      const data = validPerson(payload.person)
      checkPersonId(raffle, payload.person)
      let amount
      try {
        amount = normalizeAmount(payload.amount)
      } catch (err) {
        reject('invalid', err.message)
      }
      const outOfRange = numbers.filter((n) => n < 1 || n > raffle.config.total)
      if (outOfRange.length) {
        reject(
          'out_of_range',
          `${listNumbers(outOfRange)} no ${outOfRange.length === 1 ? 'existe' : 'existen'}: la rifa va del 1 al ${raffle.config.total}`,
        )
      }
      checkRanges(member, numbers)
      const taken = numbers.filter((n) => live(raffle.numbers.get(n)))
      const buyer = (n) => raffle.people.get(raffle.numbers.get(n).participantId)?.name ?? 'otra persona'
      if (taken.length === 1) {
        const seller = raffle.numbers.get(taken[0]).createdBy?.name ?? 'otra persona'
        reject('number_taken', `El número ${taken[0]} ya lo había vendido ${seller} a ${buyer(taken[0])} desde otro teléfono`)
      }
      if (taken.length > 1) {
        reject(
          'number_taken',
          `Los números ${andList(taken)} ya estaban vendidos desde otro teléfono (${andList(taken.map((n) => `el ${n} a ${buyer(n)}`))})`,
        )
      }

      const participantId = upsertPerson(raffle, payload.person.id, data)
      raffle.lastSeq += 1
      touchRaffle(raffle)
      const createdAt = Number(payload.createdAt) || Number(opCreatedAt) || now()
      const createdBy = { id: user.id, name: user.name }
      const sale = { id: saleId, seq: raffle.lastSeq, participantId, amount, createdAt, createdBy, deleted: false }
      raffle.sales.set(saleId, touch(raffle, sale))
      for (const number of numbers) {
        // Un número liberado y vuelto a vender reactiva su fila.
        const row = raffle.numbers.get(number) ?? { number }
        Object.assign(row, { participantId, saleId, createdAt, createdBy, deleted: false })
        raffle.numbers.set(number, touch(raffle, row))
      }
      return { seq: sale.seq, participantId }
    },

    'number.release'({ raffle, member, payload }) {
      const number = validNumber(payload.number)
      checkRanges(member, [number])
      const row = raffle.numbers.get(number)
      if (!live(row)) return null
      row.deleted = true
      touch(raffle, row)
      const sale = liveSale(raffle, row.saleId)
      if (sale && ![...raffle.numbers.values()].some((n) => live(n) && n.saleId === sale.id)) {
        deleteSale(raffle, sale)
        dropIfOrphan(raffle, sale.participantId)
      }
      dropIfOrphan(raffle, row.participantId)
      return null
    },

    'number.transfer'({ raffle, member, payload }) {
      const number = validNumber(payload.number)
      checkRanges(member, [number])
      const row = raffle.numbers.get(number)
      if (!live(row)) reject('number_not_taken', `El número ${number} ya no está vendido: lo liberaron desde otro teléfono`)
      const data = validPerson(payload.person)
      checkPersonId(raffle, payload.person)
      const participantId = upsertPerson(raffle, payload.person.id, data)
      if (participantId !== row.participantId) {
        const previous = row.participantId
        row.participantId = participantId
        touch(raffle, row)
        dropIfOrphan(raffle, previous)
      }
      return { participantId }
    },

    'sale.void'({ raffle, user, member, payload }) {
      const sale = liveSale(raffle, payload.saleId)
      if (!sale) return null
      if (member.role === 'seller' && sale.createdBy?.id !== user.id) {
        reject('not_yours', `Sólo podés anular las ventas que hiciste vos. La venta #${sale.seq} la hizo ${sale.createdBy?.name ?? 'otra persona'}.`)
      }
      const owners = new Set([sale.participantId])
      for (const row of raffle.numbers.values()) {
        if (live(row) && row.saleId === sale.id) {
          row.deleted = true
          touch(raffle, row)
          owners.add(row.participantId)
        }
      }
      deleteSale(raffle, sale)
      for (const id of owners) dropIfOrphan(raffle, id)
      return null
    },

    'sale.setAmount'({ raffle, payload }) {
      const sale = liveSale(raffle, payload.saleId)
      if (!sale) reject('sale_not_found', 'La venta ya no existe: la anularon desde otro teléfono')
      let amount
      try {
        amount = normalizeAmount(payload.amount)
      } catch (err) {
        reject('invalid', err.message)
      }
      if (amount !== sale.amount) {
        sale.amount = amount
        touch(raffle, sale)
      }
      return null
    },

    'person.update'({ raffle, payload }) {
      const personId = resolvePerson(raffle, payload.personId)
      const person = raffle.people.get(personId)
      if (!live(person)) reject('person_not_found', 'La persona ya no está en la rifa: la quitaron desde otro teléfono')
      const data = validPerson(payload.data)
      const key = personKey(data.name)
      const clash = findByKey(raffle, key)
      if (clash && clash.id !== personId) {
        // Se unifican: todo pasa a la otra persona, que completa sus datos vacíos.
        for (const list of [raffle.numbers.values(), raffle.sales.values()]) {
          for (const row of list) {
            if (live(row) && row.participantId === personId) {
              row.participantId = clash.id
              touch(raffle, row)
            }
          }
        }
        for (const field of ['phone', 'email', 'referrer']) if (!clash[field] && data[field]) clash[field] = data[field]
        touch(raffle, clash)
        person.deleted = true
        touch(raffle, person)
        addAlias(raffle, personId, clash.id)
        return { personId: clash.id }
      }
      Object.assign(person, { name: data.name, key, phone: data.phone, email: data.email, referrer: data.referrer })
      touch(raffle, person)
      return { personId }
    },

    'raffle.updateConfig'({ raffle, member, payload }) {
      if (member.role !== 'owner') reject('forbidden', 'Sólo quien organiza la rifa puede cambiar la configuración')
      let config
      try {
        config = normalizeConfig(payload.config)
      } catch (err) {
        reject('invalid', err.message)
      }
      const highest = Math.max(0, ...[...raffle.numbers.values()].filter(live).map((n) => n.number))
      if (highest > config.total) {
        reject('total_below_sold', `No podés bajar el total a ${config.total}: el número ${highest} está vendido`)
      }
      raffle.config = config
      touchRaffle(raffle)
      return null
    },

    'raffle.updateShare'({ raffle, payload }) {
      if (!payload.share || typeof payload.share !== 'object') reject('invalid', 'El estilo de la imagen no es válido')
      raffle.share = normalizeSharePrefs(payload.share)
      touchRaffle(raffle)
      return null
    },

    'receipt.set'({ raffle, payload }) {
      const sale = liveSale(raffle, payload.saleId)
      if (!sale) reject('sale_not_found', 'La venta ya no existe: la anularon desde otro teléfono')
      const meta = payload.meta ?? {}
      const row = raffle.receipts.get(sale.id) ?? { saleId: sale.id }
      Object.assign(row, {
        name: String(meta.name ?? ''),
        type: String(meta.type ?? 'application/octet-stream'),
        size: Number(meta.size) || 0,
        thumb: typeof meta.thumb === 'string' ? meta.thumb : null,
        addedAt: Number(meta.addedAt) || now(),
        hasFile: false,
        deleted: false,
      })
      raffle.files.delete(sale.id)
      raffle.receipts.set(sale.id, touch(raffle, row))
      return null
    },

    'receipt.remove'({ raffle, payload }) {
      deleteReceipt(raffle, payload.saleId)
      return null
    },
  }

  function applyOp(raffle, user, op) {
    const saved = operations.get(op.opId)
    if (saved && (saved.raffleId !== raffle.id || saved.userId !== user.id)) {
      // Un opId de otra rifa u otra cuenta: se rechaza y el rechazo no se guarda.
      return { opId: op.opId, status: 'rejected', reason: 'invalid', message: 'La operación no es válida' }
    }
    if (saved) {
      const { raffleId: _r, userId: _u, type: _t, ...response } = saved
      return clone(response)
    }
    const member = raffle.members.get(user.id)
    let outcome
    if (!Object.hasOwn(handlers, op.type)) {
      outcome = { status: 'rejected', reason: 'unknown_type', message: 'El servidor no conoce este tipo de cambio. Actualizá la app.' }
    } else if (member.role === 'viewer') {
      outcome = { status: 'rejected', reason: 'forbidden', message: 'Sólo podés ver esta rifa: no podés hacer cambios' }
    } else {
      try {
        // Cada handler valida todo antes de tocar nada: un rechazo no deja cambios a medias.
        const result = mutation(() => handlers[op.type]({ raffle, user, member, payload: op.payload ?? {}, opCreatedAt: op.createdAt }))
        outcome = { status: 'accepted', ...(result && { result }) }
      } catch (err) {
        if (!(err instanceof Rejection)) throw err
        outcome = { status: 'rejected', reason: err.reason, message: err.message }
      }
    }
    const response = { opId: op.opId, ...outcome }
    operations.set(op.opId, { ...response, raffleId: raffle.id, userId: user.id, type: op.type })
    return clone(response)
  }

  // ---------- Acceso ----------

  function access(user, raffleId) {
    const raffle = raffles.get(raffleId)
    if (!raffle) throw new SyncError('gone', 'La rifa no existe', { status: 404 })
    // Quien no es miembro recibe 403 aunque la rifa esté borrada: no se entera de nada.
    const member = raffle.members.get(user.id)
    if (!member) throw new SyncError('forbidden', 'No tenés acceso a esta rifa', { status: 403 })
    if (raffle.deleted) throw new SyncError('gone', 'La rifa se borró', { status: 410 })
    return { raffle, member }
  }

  function writer(user, raffleId) {
    const found = access(user, raffleId)
    if (found.member.role === 'viewer') throw new SyncError('forbidden', 'Sólo podés ver esta rifa', { status: 403 })
    return found
  }

  function manager(user, raffleId) {
    const found = access(user, raffleId)
    if (found.member.role !== 'owner') {
      throw new SyncError('forbidden', 'Sólo quien organiza la rifa puede hacer esto', { status: 403 })
    }
    return found
  }

  // ---------- Cuentas ----------

  const invalid = (message, field = 'email') => new SyncError('client', message, { status: 422, details: { [field]: [message] } })
  const userOut = (user) => ({ id: user.id, name: user.name, email: user.email, emailVerifiedAt: user.emailVerifiedAt ?? null })
  const findByEmail = (email) => [...users.values()].find((u) => u.email === String(email ?? '').trim().toLowerCase())

  function issueToken(user) {
    const token = `${user.id}|${newId()}`
    tokens.set(token, user.id)
    return { token, user: userOut(user) }
  }

  function checkPassword(password, confirmation) {
    if (typeof password !== 'string' || password.length < 8) {
      throw invalid('La contraseña tiene que tener al menos 8 caracteres.', 'password')
    }
    if (password !== confirmation) throw invalid('Las contraseñas no coinciden.', 'password')
  }

  /** Lo que se hace sin sesión (registrarse, iniciar sesión, recuperar la contraseña, ver una invitación). */
  const publicApi = {
    register(data = {}) {
      const name = String(data.name ?? '').trim()
      const email = String(data.email ?? '').trim().toLowerCase()
      if (!name) throw invalid('Falta el nombre.', 'name')
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw invalid('El correo no parece válido.')
      if (findByEmail(email)) throw invalid('Ya hay una cuenta con ese correo.')
      checkPassword(data.password, data.passwordConfirmation)
      const user = server.createUser(name, email, data.password)
      return issueToken(users.get(user.id))
    },

    login(data = {}) {
      const user = findByEmail(data.email)
      if (!user || user.password !== data.password) throw invalid('El correo o la contraseña no son correctos.')
      user.sessionValid = true
      return issueToken(user)
    },

    forgotPassword(email) {
      const user = findByEmail(email)
      if (user) resetTokens.set(user.email, newId())
      return { message: 'Si hay una cuenta con ese correo, te mandamos un link para elegir una contraseña nueva.' }
    },

    resetPassword(data = {}) {
      const user = findByEmail(data.email)
      if (!user || !data.token || resetTokens.get(user.email) !== data.token) {
        throw invalid('El link para cambiar la contraseña no es válido o ya venció. Pedí uno nuevo.')
      }
      checkPassword(data.password, data.passwordConfirmation)
      user.password = data.password
      resetTokens.delete(user.email)
      for (const [token, id] of tokens) if (id === user.id) tokens.delete(token)
      return { message: 'Listo, cambiaste tu contraseña.' }
    },

    getInvitation(token) {
      const invitation = invitations.get(token)
      const raffle = invitation && raffles.get(invitation.raffleId)
      if (!raffle || raffle.deleted) throw new SyncError('gone', 'La invitación no existe o la rifa ya no está.', { status: 404 })
      return {
        raffleId: raffle.id,
        raffleTitle: raffle.config.title,
        role: invitation.role,
        invitedBy: users.get(invitation.invitedBy)?.name ?? null,
        expired: invitation.expiresAt <= now(),
        accepted: invitation.acceptedBy != null,
      }
    },
  }

  // ---------- Transporte (lo que vería la app por HTTP) ----------

  const api = {
    createRaffle(user, body) {
      let config
      try {
        config = normalizeConfig(body?.config)
      } catch (err) {
        throw new SyncError('client', err.message, { status: 422 })
      }
      const raffle = {
        id: newId(),
        ownerId: user.id,
        config,
        share: normalizeSharePrefs(body?.share),
        lastSeq: 0,
        createdAt: now(),
        deleted: false,
        version: 0,
        maxVersion: 0,
        members: new Map([[user.id, { role: 'owner', ranges: null, archivedAt: null }]]),
        people: new Map(),
        sales: new Map(),
        numbers: new Map(),
        receipts: new Map(),
        files: new Map(),
        aliases: [],
        aliasMap: new Map(),
      }
      mutation(() => touchRaffle(raffle))
      raffles.set(raffle.id, raffle)
      return snapshotOf(raffle, raffle.members.get(user.id))
    },

    listRaffles(user) {
      return [...raffles.values()]
        .filter((r) => !r.deleted && r.members.has(user.id))
        .map((r) => {
          const member = r.members.get(user.id)
          return {
            id: r.id,
            title: r.config.title,
            role: member.role,
            archivedAt: member.archivedAt,
            ownerName: users.get(r.ownerId)?.name ?? '',
            version: r.maxVersion,
            deleted: false,
          }
        })
    },

    getSnapshot(user, raffleId) {
      const { raffle, member } = access(user, raffleId)
      return snapshotOf(raffle, member)
    },

    pullChanges(user, raffleId, since) {
      const { raffle, member } = access(user, raffleId)
      return changesOf(raffle, member, Number(since) || 0)
    },

    pushOps(user, raffleId, ops) {
      const { raffle } = access(user, raffleId)
      if (!Array.isArray(ops)) throw new SyncError('client', 'Faltan las operaciones', { status: 422 })
      if (ops.length > MAX_OPS_PER_BATCH) {
        throw new SyncError('client', `Se pueden enviar hasta ${MAX_OPS_PER_BATCH} cambios por vez`, { status: 422 })
      }
      // En orden; un rechazo no corta el lote.
      const results = ops.map((op) => applyOp(raffle, user, op))
      return { results, version: raffle.maxVersion }
    },

    deleteRaffle(user, raffleId) {
      const { raffle, member } = access(user, raffleId)
      if (member.role !== 'owner') throw new SyncError('forbidden', 'Sólo quien organiza la rifa puede borrarla', { status: 403 })
      raffle.deleted = true
      mutation(() => touchRaffle(raffle))
    },

    leaveRaffle(user, raffleId) {
      const { raffle, member } = access(user, raffleId)
      if (member.role === 'owner') {
        throw new SyncError('client', 'Quien organiza la rifa no puede salir: puede borrarla', { status: 422 })
      }
      raffle.members.delete(user.id)
    },

    async uploadReceipt(user, raffleId, saleId, file, meta = {}) {
      const { raffle } = writer(user, raffleId)
      const sale = liveSale(raffle, saleId)
      if (!sale) throw new SyncError('client', 'La venta ya no existe', { status: 422 })
      if (!(file instanceof Blob)) throw new SyncError('client', 'Falta el archivo', { status: 422 })
      if (file.size > 10 * 1024 * 1024) throw new SyncError('client', 'El archivo es muy pesado (máximo 10 MB)', { status: 422 })
      const type = file.type || meta.type || ''
      if (!type.startsWith('image/') && type !== 'application/pdf') {
        throw new SyncError('client', 'El comprobante tiene que ser una imagen o un PDF', { status: 422 })
      }
      const row = raffle.receipts.get(saleId) ?? { saleId }
      Object.assign(row, {
        name: String(meta.name ?? ''),
        type,
        size: file.size,
        thumb: typeof meta.thumb === 'string' ? meta.thumb : null,
        addedAt: Number(meta.addedAt) || now(),
        hasFile: true,
        deleted: false,
      })
      raffle.files.set(saleId, file)
      raffle.receipts.set(saleId, mutation(() => touch(raffle, row)))
      return strip(row)
    },

    downloadReceipt(user, raffleId, saleId) {
      const { raffle } = access(user, raffleId)
      const receipt = raffle.receipts.get(saleId)
      const file = raffle.files.get(saleId)
      if (!live(receipt) || !file) throw new SyncError('client', 'El archivo de este comprobante todavía no se subió', { status: 404 })
      return file
    },
  }

  Object.assign(api, {
    // ---------- Cuenta con sesión ----------
    me(user) {
      return userOut(user)
    },

    logout(user, token) {
      tokens.delete(token)
    },

    resendVerification(user) {
      return { message: user.emailVerifiedAt ? 'Tu correo ya está verificado.' : 'Te mandamos otro correo para verificar tu cuenta.' }
    },

    // ---------- Miembros ----------
    listMembers(user, raffleId) {
      const { raffle } = access(user, raffleId)
      return [...raffle.members.entries()]
        .map(([userId, m]) => {
          const u = users.get(userId)
          return { userId, name: u?.name ?? '', email: u?.email ?? '', role: m.role, ranges: clone(m.ranges) }
        })
        .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name, 'es'))
    },

    updateMember(user, raffleId, userId, patch = {}) {
      const { raffle } = manager(user, raffleId)
      const target = raffle.members.get(Number(userId))
      if (!target) throw new SyncError('gone', 'Esa persona no es miembro de la rifa.', { status: 404 })
      const role = patch.role ?? target.role
      if (!['owner', 'seller', 'viewer'].includes(role)) throw invalid('El rol no es válido.', 'role')
      if (target.role === 'owner' && role !== 'owner') throw invalid('No podés quitarte el rol de dueño de la rifa.', 'role')
      if (target.role !== 'owner' && role === 'owner') throw invalid('La rifa tiene un solo dueño: elegí vendedor o lector.', 'role')
      let ranges = target.ranges
      if (Object.hasOwn(patch, 'ranges')) ranges = validRanges(patch.ranges)
      target.role = role
      target.ranges = role === 'seller' ? ranges : null
      const u = users.get(Number(userId))
      return { userId: Number(userId), name: u?.name ?? '', email: u?.email ?? '', role: target.role, ranges: clone(target.ranges) }
    },

    removeMember(user, raffleId, userId) {
      const self = userId === 'me' || Number(userId) === user.id
      const { raffle } = self ? access(user, raffleId) : manager(user, raffleId)
      const id = self ? user.id : Number(userId)
      const target = raffle.members.get(id)
      if (!target) throw new SyncError('gone', 'Esa persona no es miembro de la rifa.', { status: 404 })
      if (target.role === 'owner') {
        throw new SyncError(
          'client',
          self
            ? 'Sos quien organiza la rifa: no podés salir. Si ya no la necesitás, podés borrarla.'
            : 'No se puede quitar a quien organiza la rifa.',
          { status: 422 },
        )
      }
      raffle.members.delete(id)
    },

    // ---------- Invitaciones ----------
    createInvitation(user, raffleId, data = {}) {
      const { raffle } = manager(user, raffleId)
      if (!['seller', 'viewer'].includes(data.role)) throw invalid('El rol no es válido.', 'role')
      const token = newId().replaceAll('-', '')
      const expiresAt = now() + 7 * 24 * 60 * 60 * 1000
      invitations.set(token, {
        raffleId: raffle.id,
        role: data.role,
        email: data.email ? String(data.email).trim().toLowerCase() : null,
        invitedBy: user.id,
        expiresAt,
        acceptedBy: null,
      })
      return { token, role: data.role, expiresAt }
    },

    acceptInvitation(user, token) {
      const info = publicApi.getInvitation(token)
      const invitation = invitations.get(token)
      const raffle = raffles.get(invitation.raffleId)
      const current = raffle.members.get(user.id)
      if (current) return { raffleId: raffle.id, role: current.role }
      if (invitation.acceptedBy != null) {
        throw new SyncError('client', 'Esta invitación ya la usó otra persona. Pedile a quien organiza que te mande otra.', { status: 422 })
      }
      if (info.expired) throw new SyncError('client', 'Esta invitación venció. Pedile a quien organiza que te mande otra.', { status: 422 })
      if (invitation.email && invitation.email !== user.email) {
        throw new SyncError('forbidden', 'Esta invitación es para otra cuenta de correo.', { status: 403 })
      }
      raffle.members.set(user.id, { role: invitation.role, ranges: null, archivedAt: null })
      invitation.acceptedBy = user.id
      return { raffleId: raffle.id, role: invitation.role }
    },
  })

  function validRanges(ranges) {
    if (ranges == null) return null
    const ok =
      Array.isArray(ranges) &&
      ranges.length <= 100 &&
      ranges.every((r) => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000) && r[0] <= r[1])
    if (!ok) throw invalid('Cada rango del talonario tiene que ir de un número a otro mayor o igual, entre 1 y 1000', 'ranges')
    return mergeRanges(ranges.map(([a, b]) => [a, b]))
  }

  const SYNC_METHODS = [
    'createRaffle',
    'listRaffles',
    'getSnapshot',
    'pullChanges',
    'pushOps',
    'deleteRaffle',
    'leaveRaffle',
    'uploadReceipt',
    'downloadReceipt',
  ]
  const ACCOUNT_METHODS = ['me', 'resendVerification', 'listMembers', 'updateMember', 'removeMember', 'createInvitation', 'acceptInvitation']

  /**
   * Arma los métodos de un transporte: copia lo que entra y sale (como el JSON real), nunca
   * responde en el mismo tick, y se puede dejar sin conexión o hacer fallar el próximo pedido.
   * `resolveUser()` da la cuenta del pedido (o falla con 401).
   */
  function connection(resolveUser) {
    let online = true
    const failures = []
    const calls = []
    async function gate(method) {
      calls.push(method)
      await Promise.resolve()
      if (!online) throw new SyncError('network', 'Sin conexión')
      if (failures.length) {
        const kind = failures.shift()
        throw new SyncError(kind, undefined, { status: kind === 'server' ? 503 : null })
      }
    }
    const out = (output) => (output instanceof Blob ? output : clone(output))
    const input = (args) => args.map((a) => (a instanceof Blob ? a : clone(a)))
    const authed = (method) => async (...args) => {
      await gate(method)
      const user = resolveUser()
      return out(await api[method](user, ...input(args)))
    }
    const open = (method) => async (...args) => {
      await gate(method)
      return out(await publicApi[method](...input(args)))
    }
    return {
      calls,
      authed,
      open,
      get online() {
        return online
      },
      setOnline(value) {
        online = value
      },
      /** El próximo pedido (o los próximos `times`) falla con ese tipo de error. */
      failNext(kind, times = 1) {
        for (let i = 0; i < times; i++) failures.push(kind)
      },
    }
  }

  const sessionError = () => new SyncError('auth', 'Tu sesión venció', { status: 401 })

  const server = {
    /** Una cuenta nueva (con sesión válida). */
    createUser(name = `Persona ${lastUserId + 1}`, email, password = 'secreto123') {
      const user = {
        id: ++lastUserId,
        name,
        email: (email ?? `persona${lastUserId}@example.com`).toLowerCase(),
        password,
        emailVerifiedAt: null,
        sessionValid: true,
      }
      users.set(user.id, user)
      return user
    },

    /** Inicia sesión sin contraseña (para los tests y el modo de desarrollo): `{ token, user }`. */
    tokenFor(user) {
      return issueToken(users.get(user.id))
    },

    /** Marca el correo como verificado (lo que en la API hace el link del correo). */
    verifyEmail(user) {
      users.get(user.id).emailVerifiedAt = now()
    },

    /** El último token para cambiar la contraseña que se "mandó por correo". */
    resetTokenFor(email) {
      return resetTokens.get(String(email).toLowerCase()) ?? null
    },

    /** Invitación vencida (para probar el error). */
    expireInvitation(token) {
      invitations.get(token).expiresAt = now() - 1
    },

    /** Suma a alguien a una rifa (lo que en la API hace aceptar una invitación). */
    addMember(raffleId, user, role = 'seller', ranges = null) {
      raffles.get(raffleId).members.set(user.id, { role, ranges, archivedAt: null })
    },

    setMember(raffleId, user, { role, ranges } = {}) {
      const member = raffles.get(raffleId).members.get(user.id)
      if (role !== undefined) member.role = role
      if (ranges !== undefined) member.ranges = ranges
    },

    removeMember(raffleId, user) {
      raffles.get(raffleId).members.delete(user.id)
    },

    /** El rol de alguien en una rifa (o `null` si no es miembro). */
    roleOf(raffleId, user) {
      return raffles.get(raffleId)?.members.get(user.id)?.role ?? null
    },

    /** Invalida los tokens de la persona: el próximo pedido responde 401. */
    expireSessions(user) {
      users.get(user.id).sessionValid = false
    },

    restoreSessions(user) {
      users.get(user.id).sessionValid = true
    },

    /** Estado interno de una rifa, para inspeccionarlo en los tests. */
    inspect(raffleId) {
      const raffle = raffles.get(raffleId)
      if (!raffle) return null
      const alive = (map) => [...map.values()].filter(live).map(strip)
      return {
        raffle: raffleOut(raffle),
        people: alive(raffle.people),
        sales: alive(raffle.sales),
        numbers: alive(raffle.numbers).sort((a, b) => a.number - b.number),
        receipts: alive(raffle.receipts),
        aliases: raffle.aliases.map(({ entity, from, to }) => ({ entity, from, to })),
        version: raffle.maxVersion,
      }
    },

    /** Cuántas operaciones distintas se aplicaron (para comprobar la idempotencia). */
    get operationCount() {
      return operations.size
    },

    get version() {
      return version
    },

    /**
     * El transporte de una persona en un teléfono. Copia todo lo que entra y sale (como el JSON
     * real) y se puede dejar sin conexión o hacer fallar el próximo pedido.
     * @returns {import('./transport.js').Transport & { setOnline(online: boolean): void, failNext(kind: string, times?: number): void, calls: string[], user: object }}
     */
    transportFor(user) {
      const conn = connection(() => {
        const current = users.get(user.id)
        if (!current?.sessionValid) throw sessionError()
        return current
      })
      const transport = {
        user,
        calls: conn.calls,
        get online() {
          return conn.online
        },
        setOnline: conn.setOnline,
        failNext: conn.failNext,
      }
      for (const method of SYNC_METHODS) transport[method] = conn.authed(method)
      return transport
    },

    /**
     * Un cliente con la misma interfaz que `createApiClient` (sincronización, cuentas, miembros e
     * invitaciones). La sesión sale de `getToken()`, como en el cliente HTTP.
     * @param {{ getToken?: () => string|null|undefined }} options
     */
    client({ getToken = () => null } = {}) {
      const conn = connection(() => {
        const token = getToken()
        const current = token != null ? users.get(tokens.get(token)) : null
        if (!current?.sessionValid) throw sessionError()
        return current
      })
      const client = {
        calls: conn.calls,
        get online() {
          return conn.online
        },
        setOnline: conn.setOnline,
        failNext: conn.failNext,
        register: conn.open('register'),
        login: conn.open('login'),
        forgotPassword: conn.open('forgotPassword'),
        resetPassword: conn.open('resetPassword'),
        getInvitation: conn.open('getInvitation'),
        logout: async () => {
          await conn.authed('logout')(getToken())
        },
      }
      for (const method of [...SYNC_METHODS, ...ACCOUNT_METHODS]) client[method] = conn.authed(method)
      return client
    },
  }
  return server
}
