import { describe, expect, it } from 'vitest'
import { describeConflict, describeSyncState } from '../../src/sync/status.js'
import { SyncError, syncErrorKind } from '../../src/sync/transport.js'
import { friendlyError } from '../../src/lib/errors.js'

const base = { status: 'active', pending: 0, needsLogin: false, conflicts: [] }

describe('describeSyncState', () => {
  it('sincronizado, cambios sin enviar, sin conexión e inicio de sesión', () => {
    expect(describeSyncState(base)).toMatchObject({ tone: 'ok', label: 'Sincronizado' })
    expect(describeSyncState({ ...base, pending: 1 })).toMatchObject({ tone: 'pending', label: '1 cambio sin enviar' })
    expect(describeSyncState({ ...base, pending: 3 }, { online: false })).toMatchObject({
      tone: 'offline',
      label: 'Sin conexión',
      detail: '3 cambios sin enviar',
    })
    expect(describeSyncState({ ...base, needsLogin: true }, { online: false })).toMatchObject({
      tone: 'warn',
      label: 'Iniciá sesión para sincronizar',
    })
  })

  it('rifa borrada o sin acceso manda sobre todo lo demás', () => {
    expect(describeSyncState({ ...base, status: 'deleted', needsLogin: true }).label).toBe('Esta rifa se borró de la nube')
    expect(describeSyncState({ ...base, status: 'revoked' }).label).toBe('Ya no tenés acceso a esta rifa')
  })
})

describe('describeConflict', () => {
  it('dice qué cambio de este teléfono no se pudo guardar', () => {
    expect(describeConflict({ type: 'numbers.assign', payload: { numbers: [7], person: { name: 'Ana' } } })).toBe(
      'Venta del número 7 a Ana',
    )
    expect(describeConflict({ type: 'numbers.assign', payload: { numbers: [7, 8], person: { name: 'Ana' } } })).toBe(
      'Venta de los números 7 y 8 a Ana',
    )
    expect(describeConflict({ type: 'raffle.updateConfig', payload: {} })).toBe('Cambiar la configuración de la rifa')
    expect(describeConflict({ type: 'receipt.upload', payload: { name: 'a.jpg' } })).toBe('Subir el comprobante «a.jpg»')
    expect(describeConflict({ type: 'otra.cosa' })).toBe('Un cambio')
  })
})

describe('SyncError', () => {
  it('el tipo sale del código HTTP y trae un mensaje en castellano', () => {
    expect([401, 403, 404, 410, 422, 500, 503].map(syncErrorKind)).toEqual(['auth', 'forbidden', 'gone', 'gone', 'client', 'server', 'server'])
    const err = new SyncError('network')
    expect(err.retryable).toBe(true)
    expect(friendlyError(err)).toMatch(/Sin conexión con el servidor/)
    expect(friendlyError(new SyncError('client', 'El archivo es muy pesado'))).toBe('El archivo es muy pesado')
  })
})
