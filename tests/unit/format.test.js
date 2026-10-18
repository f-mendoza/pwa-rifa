import { describe, expect, it } from 'vitest'
import {
  availableMessage,
  formatMoney,
  packPhrase,
  plural,
  priceBreakdown,
  priceFor,
  todayStamp,
} from '../../src/lib/format.js'

const promo = { price: 5000, packSize: 2, packPrice: 8000 }
const noPromo = { price: 5000, packSize: 0, packPrice: 0 }

describe('formatMoney', () => {
  it('formatea en pesos con separador de miles argentino', () => {
    expect(formatMoney(13000)).toBe('$13.000')
    expect(formatMoney(1234567)).toBe('$1.234.567')
  })

  it('trata vacío o null como cero', () => {
    expect(formatMoney(null)).toBe('$0')
    expect(formatMoney(undefined)).toBe('$0')
  })
})

describe('priceFor', () => {
  it('aplica la promo por paquetes y cobra el resto suelto', () => {
    expect(priceFor(1, promo)).toBe(5000)
    expect(priceFor(2, promo)).toBe(8000)
    expect(priceFor(3, promo)).toBe(13000)
    expect(priceFor(4, promo)).toBe(16000)
  })

  it('sin promo cobra cada número al precio', () => {
    expect(priceFor(3, noPromo)).toBe(15000)
  })

  it('una promo de 1 número o con precio 0 no cuenta como promo', () => {
    expect(priceFor(3, { price: 100, packSize: 1, packPrice: 50 })).toBe(300)
    expect(priceFor(3, { price: 100, packSize: 2, packPrice: 0 })).toBe(300)
  })

  it('cero números cuestan cero', () => {
    expect(priceFor(0, promo)).toBe(0)
  })
})

describe('priceBreakdown', () => {
  it('explica cómo se llegó al monto', () => {
    expect(priceBreakdown(3, promo)).toBe('1 promo + 1 suelto')
    expect(priceBreakdown(4, promo)).toBe('2 promos')
    expect(priceBreakdown(1, promo)).toBe('1 suelto')
    expect(priceBreakdown(2, noPromo)).toBe('2 números a $5.000')
  })
})

describe('packPhrase', () => {
  it('escribe la cantidad en palabras hasta diez', () => {
    expect(packPhrase(promo)).toBe('(o dos por $8.000)')
    expect(packPhrase({ ...promo, packSize: 12 })).toBe('(o 12 por $8.000)')
    expect(packPhrase(noPromo)).toBe('')
  })
})

describe('plural', () => {
  it('elige singular sólo para 1', () => {
    expect(plural(1, 'número', 'números')).toBe('1 número')
    expect(plural(0, 'número', 'números')).toBe('0 números')
    expect(plural(2, 'número', 'números')).toBe('2 números')
  })
})

describe('availableMessage', () => {
  const config = { title: 'Rifa del club', total: 10, ...promo, drawText: 'Sorteo el 16/11' }

  it('arma el texto para pegar en WhatsApp', () => {
    const text = availableMessage(config, [1, 4, 9])
    expect(text).toBe(
      'RIFA DEL CLUB · Números disponibles (3 de 10)\n\n1, 4, 9\n\n$5.000 (o dos por $8.000)\n\nSorteo el 16/11',
    )
  })

  it('avisa cuando no quedan números y omite precio 0', () => {
    const text = availableMessage({ ...config, price: 0, drawText: '' }, [])
    expect(text).toBe('RIFA DEL CLUB · Números disponibles (0 de 10)\n\n¡No quedan números!')
  })
})

describe('todayStamp', () => {
  it('devuelve AAAA-MM-DD', () => {
    expect(todayStamp()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
