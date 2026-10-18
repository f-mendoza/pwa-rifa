import { describe, expect, it } from 'vitest'
import { friendlyError } from '../../src/lib/errors.js'

const named = (name, message = 'technical english text') => Object.assign(new Error(message), { name })

describe('friendlyError', () => {
  it('deja pasar los mensajes propios de la app', () => {
    expect(friendlyError(new Error('Ya están tomados: 7'))).toBe('Ya están tomados: 7')
  })

  it('traduce la falta de espacio, aunque venga envuelta por Dexie', () => {
    expect(friendlyError(named('QuotaExceededError'))).toMatch(/sin espacio/)
    expect(friendlyError(Object.assign(named('AbortError'), { inner: named('QuotaExceededError') }))).toMatch(
      /sin espacio/,
    )
  })

  it('traduce permisos y base cerrada', () => {
    expect(friendlyError(named('NotAllowedError'))).toMatch(/permiso/)
    expect(friendlyError(named('DatabaseClosedError'))).toMatch(/datos guardados/)
  })

  it('nunca muestra texto técnico de errores del navegador', () => {
    expect(friendlyError(named('TypeError', 'Cannot read properties of undefined'))).toBe(
      'Algo salió mal. Probá de nuevo.',
    )
    expect(friendlyError(named('DataCloneError'), 'No se pudo compartir')).toBe('No se pudo compartir')
  })

  it('tolera errores vacíos', () => {
    expect(friendlyError(null)).toBe('Algo salió mal. Probá de nuevo.')
    expect(friendlyError(new Error(''))).toBe('Algo salió mal. Probá de nuevo.')
  })
})
