import { describe, expect, it } from 'vitest'
import { newId } from '../../src/lib/ids.js'
import { deleteKind, permissionsFor } from '../../src/lib/permissions.js'
import { formatRanges, mergeRanges, parseRanges, rangeSize } from '../../src/lib/ranges.js'
import { invitationLink, invitationMessage } from '../../src/lib/invitations.js'

describe('talonarios', () => {
  it('lee rangos como los escribe una persona', () => {
    expect(parseRanges('1-100, 201-250')).toEqual({ ranges: [[1, 100], [201, 250]], error: null })
    expect(parseRanges(' 7 ; 9,10 – 12 ')).toEqual({ ranges: [[7, 7], [9, 12]], error: null })
    expect(parseRanges('1 a 50')).toEqual({ ranges: [[1, 50]], error: null })
  })

  it('vacío es "sin talonario"', () => {
    expect(parseRanges('')).toEqual({ ranges: null, error: null })
    expect(parseRanges('   ')).toEqual({ ranges: null, error: null })
  })

  it('ordena y une los que se pisan o se tocan', () => {
    expect(parseRanges('50-60, 1-10, 5-20, 21-22').ranges).toEqual([[1, 22], [50, 60]])
    expect(mergeRanges([[5, 10], [1, 6], [11, 12]])).toEqual([[1, 12]])
  })

  it('explica lo que está mal', () => {
    expect(parseRanges('1-x').error).toMatch(/No entiendo «1-x»/)
    expect(parseRanges('20-10').error).toMatch(/el primer número tiene que ser el menor/)
    expect(parseRanges('0-5').error).toMatch(/empiezan en 1/)
    expect(parseRanges('1-120', { max: 100 }).error).toBe('La rifa tiene 100 números: «1-120» se pasa.')
    expect(parseRanges('1-120', { max: 100 }).ranges).toBeNull()
  })

  it('los muestra y los cuenta', () => {
    expect(formatRanges([[1, 100], [7, 7]])).toBe('1-100, 7')
    expect(formatRanges(null)).toBe('')
    expect(rangeSize([[1, 100], [201, 250]])).toBe(150)
    expect(rangeSize(null)).toBeNull()
    expect(parseRanges(formatRanges([[1, 100], [201, 250]])).ranges).toEqual([[1, 100], [201, 250]])
  })
})

describe('permissionsFor', () => {
  const data = (remote, sync = {}) => ({ raffle: { remote }, sync: remote ? { otherAccount: false, ...sync } : null })
  const sale = (id) => ({ createdBy: { id, name: 'X' } })

  it('una rifa local permite todo', () => {
    const p = permissionsFor(data(null))
    expect(p).toMatchObject({ cloud: false, sell: true, edit: true, config: true, readOnly: false, manageMembers: false })
    expect(p.canSellNumber(999)).toBe(true)
    expect(p.canVoid(sale(1))).toBe(true)
    expect(deleteKind(p)).toBe('delete')
  })

  it('owner: todo, incluidos los miembros', () => {
    const p = permissionsFor(data({ role: 'owner', userId: 1, status: 'active' }))
    expect(p).toMatchObject({ cloud: true, sell: true, config: true, manageMembers: true, owner: true })
    expect(p.canVoid(sale(2))).toBe(true)
    expect(deleteKind(p)).toBe('delete-cloud')
  })

  it('seller: vende dentro de su talonario, sin configuración, anula sólo sus ventas', () => {
    const p = permissionsFor(data({ role: 'seller', userId: 2, ranges: [[1, 10]], status: 'active' }))
    expect(p).toMatchObject({ sell: true, edit: true, share: true, config: false, manageMembers: false, owner: false })
    expect(p.canSellNumber(5)).toBe(true)
    expect(p.canSellNumber(11)).toBe(false)
    expect(p.canChangeNumber(11)).toBe(false)
    expect(p.canVoid(sale(2))).toBe(true)
    expect(p.canVoid(sale(3))).toBe(false)
    expect(deleteKind(p)).toBe('leave')
  })

  it('viewer: sólo lectura', () => {
    const p = permissionsFor(data({ role: 'viewer', userId: 3, status: 'active' }))
    expect(p).toMatchObject({ readOnly: true, sell: false, edit: false, share: false, config: false })
    expect(p.canSellNumber(1)).toBe(false)
    expect(p.canVoid(sale(3))).toBe(false)
  })

  it('borrada, sin acceso o de otra cuenta: sólo lectura y "quitar del dispositivo"', () => {
    for (const p of [
      permissionsFor(data({ role: 'owner', userId: 1, status: 'deleted' })),
      permissionsFor(data({ role: 'seller', userId: 1, status: 'revoked' })),
      permissionsFor(data({ role: 'owner', userId: 1, status: 'active' }, { otherAccount: true })),
    ]) {
      expect(p).toMatchObject({ readOnly: true, sell: false, config: false, manageMembers: false })
      expect(deleteKind(p)).toBe('remove')
    }
  })
})

describe('invitaciones', () => {
  it('arma el link y el mensaje para compartir', () => {
    expect(invitationLink('abc', 'https://rifa.example.com')).toBe('https://rifa.example.com/invitacion/abc')
    expect(invitationMessage('Club', 'seller', 'L')).toBe('Te invito a la rifa «Club» para vender números. Entrá desde este link (sirve para una sola persona): L')
    expect(invitationMessage('Club', 'viewer', 'L')).toMatch(/para que veas cómo va/)
  })
})

describe('newId', () => {
  it('genera UUIDv7 que crecen aunque sean del mismo milisegundo', () => {
    const ids = Array.from({ length: 500 }, () => newId())
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect([...ids].sort()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
