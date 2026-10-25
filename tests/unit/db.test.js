import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SHARE,
  LIMITS,
  assignNumbers,
  clearNumbers,
  db,
  exportBackup,
  importBackup,
  normalizeAmount,
  normalizeAppearance,
  normalizeConfig,
  normalizeSharePrefs,
  personKey,
  receiptBlob,
  releaseNumber,
  removeReceipt,
  saveAppearance,
  saveConfig,
  saveSharePrefs,
  setPurchaseAmount,
  setReceipt,
  supportsBlobStorage,
  transferNumber,
  updateParticipant,
  voidPurchase,
} from '../../src/db.js'

beforeEach(async () => {
  await db.delete()
  await db.open()
})

const ana = { name: 'Ana Pérez', phone: '221 555 1234', email: 'ana@mail.com' }
const tickets = () => db.tickets.orderBy('number').toArray()

describe('personKey', () => {
  it('reconoce a la misma persona sin importar mayúsculas, tildes ni espacios', () => {
    expect(personKey('  ANA   pérez ')).toBe(personKey('ana perez'))
  })
})

describe('assignNumbers', () => {
  it('crea persona, comprobante y números en una sola operación', async () => {
    const purchaseId = await assignNumbers([7, 8, 23], ana)
    const rows = await tickets()
    expect(rows.map((t) => t.number)).toEqual([7, 8, 23])
    expect(new Set(rows.map((t) => t.purchaseId))).toEqual(new Set([purchaseId]))
    expect(await db.participants.count()).toBe(1)
    expect((await db.purchases.get(purchaseId)).amount).toBeNull()
  })

  it('nunca vende dos veces el mismo número y no deja nada a medias', async () => {
    await assignNumbers([5], ana)
    await expect(assignNumbers([4, 5], { name: 'Beto' })).rejects.toThrow('Ya están tomados: 5')
    expect((await tickets()).map((t) => t.number)).toEqual([5])
    expect(await db.participants.count()).toBe(1)
    expect(await db.purchases.count()).toBe(1)
  })

  it('suma números a una persona existente aunque el nombre se escriba distinto', async () => {
    await assignNumbers([1], ana)
    await assignNumbers([2], { name: '  ana PEREZ ' })
    expect(await db.participants.count()).toBe(1)
    const person = await db.participants.toCollection().first()
    // El contacto vacío no pisa el que ya tenía.
    expect(person.phone).toBe(ana.phone)
  })

  it('un monto igual al calculado no se guarda como corrección', async () => {
    const id = await assignNumbers([1, 2], ana, { amount: 8000 })
    expect((await db.purchases.get(id)).amount).toBeNull()
    const other = await assignNumbers([3], ana, { amount: 7000 })
    expect((await db.purchases.get(other)).amount).toBe(7000)
  })

  it('rechaza montos inválidos antes de tocar la base', async () => {
    await expect(assignNumbers([1], ana, { amount: -1 })).rejects.toThrow(/entero/)
    await expect(assignNumbers([1], ana, { amount: 12.5 })).rejects.toThrow(/entero/)
    expect(await db.tickets.count()).toBe(0)
  })

  it('valida nombre obligatorio, largos y correo', async () => {
    await expect(assignNumbers([1], { name: '   ' })).rejects.toThrow('El nombre es obligatorio')
    await expect(assignNumbers([1], { name: 'x'.repeat(LIMITS.name + 1) })).rejects.toThrow(/hasta 80/)
    await expect(assignNumbers([1], { name: 'Ana', phone: '1'.repeat(LIMITS.phone + 1) })).rejects.toThrow(
      /teléfono/,
    )
    await expect(assignNumbers([1], { name: 'Ana', email: 'no-es-un-correo' })).rejects.toThrow(/correo/)
    expect(await db.tickets.count()).toBe(0)
  })

  it('guarda quién la refirió y no lo pisa si después viene vacío', async () => {
    await assignNumbers([1], { ...ana, referrer: '  Manu  ' })
    await assignNumbers([2], { name: 'Ana Perez' })
    expect((await db.participants.toCollection().first()).referrer).toBe('Manu')
    await expect(assignNumbers([3], { name: 'Beto', referrer: 'x'.repeat(LIMITS.referrer + 1) })).rejects.toThrow(
      /referido/,
    )
  })

  it('acepta nombres con emoji y caracteres no latinos', async () => {
    await assignNumbers([1], { name: 'María 🎉 李' })
    expect((await db.participants.toCollection().first()).name).toBe('María 🎉 李')
  })
})

describe('releaseNumber y voidPurchase', () => {
  it('liberar el último número de un comprobante borra el comprobante y la persona', async () => {
    await assignNumbers([10], ana)
    await releaseNumber(10)
    expect(await db.tickets.count()).toBe(0)
    expect(await db.purchases.count()).toBe(0)
    expect(await db.participants.count()).toBe(0)
  })

  it('liberar uno de varios mantiene el comprobante', async () => {
    await assignNumbers([10, 11], ana)
    await releaseNumber(10)
    expect((await tickets()).map((t) => t.number)).toEqual([11])
    expect(await db.purchases.count()).toBe(1)
  })

  it('liberar un número libre no hace nada', async () => {
    await expect(releaseNumber(99)).resolves.toBeUndefined()
  })

  it('anular una venta libera todos sus números y borra su archivo', async () => {
    const id = await assignNumbers([1, 2, 3], ana)
    await setReceipt(id, { name: 'pago.pdf', type: 'application/pdf', size: 3, blob: new Blob(['abc']), thumb: null })
    await voidPurchase(id)
    expect(await db.tickets.count()).toBe(0)
    expect(await db.receipts.count()).toBe(0)
    expect(await db.participants.count()).toBe(0)
  })
})

describe('transferNumber', () => {
  it('pasa el número a otra persona y el pago queda en el comprobante original', async () => {
    const id = await assignNumbers([5, 6], ana)
    await transferNumber(5, { name: 'Beto' })
    const [t5, t6] = await tickets()
    expect(t5.participantId).not.toBe(t6.participantId)
    expect(t5.purchaseId).toBe(id)
  })

  it('falla con un número libre', async () => {
    await expect(transferNumber(1, { name: 'Beto' })).rejects.toThrow('no está tomado')
  })
})

describe('updateParticipant', () => {
  it('si el nombre nuevo ya existe, unifica a las dos personas', async () => {
    await assignNumbers([1], ana)
    await assignNumbers([2], { name: 'Beto', phone: '999' })
    const beto = await db.participants.where('key').equals(personKey('Beto')).first()
    const finalId = await updateParticipant(beto.id, { name: 'ANA PEREZ', phone: '999' })
    expect(await db.participants.count()).toBe(1)
    expect(new Set((await tickets()).map((t) => t.participantId))).toEqual(new Set([finalId]))
    expect((await db.participants.get(finalId)).phone).toBe('999')
  })

  it('al unificar conserva el referido que había si el nuevo viene vacío', async () => {
    await assignNumbers([1], { ...ana, referrer: 'Manu' })
    await assignNumbers([2], { name: 'Beto' })
    const beto = await db.participants.where('key').equals(personKey('Beto')).first()
    const finalId = await updateParticipant(beto.id, { name: 'Ana Pérez' })
    expect((await db.participants.get(finalId)).referrer).toBe('Manu')
  })

  it('editar puede borrar el referido', async () => {
    await assignNumbers([1], { ...ana, referrer: 'Manu' })
    const { id } = await db.participants.toCollection().first()
    await updateParticipant(id, { ...ana, referrer: '' })
    expect((await db.participants.get(id)).referrer).toBe('')
  })
})

describe('setPurchaseAmount y comprobantes', () => {
  it('corrige el monto y vuelve al calculado con null', async () => {
    const id = await assignNumbers([1], ana)
    await setPurchaseAmount(id, 9000)
    expect((await db.purchases.get(id)).amount).toBe(9000)
    await setPurchaseAmount(id, null)
    expect((await db.purchases.get(id)).amount).toBeNull()
  })

  it('falla si el comprobante ya no existe', async () => {
    await expect(setPurchaseAmount(42, 100)).rejects.toThrow('ya no existe')
    await expect(setReceipt(42, { blob: new Blob(['x']) })).rejects.toThrow('ya no existe')
  })

  it('quitar el archivo deja la venta', async () => {
    const id = await assignNumbers([1], ana)
    await setReceipt(id, { name: 'a.pdf', type: 'application/pdf', size: 1, blob: new Blob(['x']), thumb: null })
    await removeReceipt(id)
    expect(await db.receipts.count()).toBe(0)
    expect(await db.purchases.count()).toBe(1)
  })
})

describe('normalizeAmount', () => {
  it('vacío significa usar el calculado', () => {
    expect(normalizeAmount('')).toBeNull()
    expect(normalizeAmount(null)).toBeNull()
    expect(normalizeAmount('1500')).toBe(1500)
  })
})

describe('configuración', () => {
  it('valida el total y recorta textos largos', () => {
    expect(() => normalizeConfig({ total: 0 })).toThrow(/entre 1 y 1000/)
    expect(() => normalizeConfig({ total: 1001 })).toThrow(/entre 1 y 1000/)
    expect(() => normalizeConfig({ price: -5 })).toThrow(/enteros/)
    const config = normalizeConfig({
      title: 'T'.repeat(100),
      drawText: 'd'.repeat(500),
      prizes: [...Array(30)].map((_, i) => `Premio ${i}`).concat(['  ', null]),
    })
    expect(config.title).toHaveLength(40)
    expect(config.drawText).toHaveLength(140)
    expect(config.prizes).toHaveLength(20)
  })

  it('no deja bajar el total por debajo de un número tomado', async () => {
    await assignNumbers([250], ana)
    await expect(saveConfig({ total: 200 })).rejects.toThrow('el número 250 está tomado')
    await saveConfig({ total: 250 })
    expect((await db.settings.get('config')).value.total).toBe(250)
  })

  it('empezar una rifa nueva borra ventas pero mantiene la configuración', async () => {
    await saveConfig({ title: 'Club' })
    await assignNumbers([1, 2], ana)
    await clearNumbers()
    expect(await db.tickets.count()).toBe(0)
    expect(await db.participants.count()).toBe(0)
    expect((await db.settings.get('config')).value.title).toBe('Club')
  })
})

describe('preferencias de la imagen y apariencia', () => {
  const colors = { bg1: '#112233', bg2: '#223344', bg3: '#334455', accent: '#FF0000', ink: '#ffffff', card: '#000000' }

  it('completa lo que falta con los valores por defecto', () => {
    expect(normalizeSharePrefs(undefined)).toEqual(DEFAULT_SHARE)
    // Las preferencias guardadas antes de esta versión sólo tenían modo y formato.
    expect(normalizeSharePrefs({ mode: 'crossed', format: 'post' })).toEqual({ ...DEFAULT_SHARE, mode: 'crossed', format: 'post' })
  })

  it('descarta valores desconocidos y colores inválidos', () => {
    const prefs = normalizeSharePrefs({
      mode: 'otro',
      palette: 'inexistente',
      titleFont: 'Comic Sans',
      textFont: 42,
      colors: { ...colors, card: 'negro' },
    })
    expect(prefs).toEqual(DEFAULT_SHARE)
  })

  it('acepta temas, paleta personalizada y fuentes válidas', () => {
    const prefs = normalizeSharePrefs({ palette: 'custom', colors, titleFont: 'lobster', textFont: 'lora' })
    expect(prefs.palette).toBe('custom')
    expect(prefs.colors.accent).toBe('#ff0000')
    expect(normalizeSharePrefs({ palette: 'menta' }).palette).toBe('menta')
    expect(prefs.titleFont).toBe('lobster')
    expect(prefs.textFont).toBe('lora')
  })

  it('el tema de la app sólo puede ser uno de los conocidos', () => {
    expect(normalizeAppearance({ theme: 'noche' })).toEqual({ theme: 'noche' })
    expect(normalizeAppearance({ theme: 'neón' })).toEqual({ theme: 'flyer' })
    expect(normalizeAppearance(null)).toEqual({ theme: 'flyer' })
  })

  it('se guardan normalizadas', async () => {
    await saveSharePrefs({ ...DEFAULT_SHARE, palette: 'custom', colors, titleFont: 'nada' })
    const saved = (await db.settings.get('share')).value
    expect(saved.titleFont).toBe(DEFAULT_SHARE.titleFont)
    expect(saved.colors.accent).toBe('#ff0000')
    await saveAppearance({ theme: 'grafito', extra: true })
    expect((await db.settings.get('appearance')).value).toEqual({ theme: 'grafito' })
  })

  it('viajan en el respaldo y se validan al restaurar', async () => {
    await saveAppearance({ theme: 'oceano' })
    await saveSharePrefs({ ...DEFAULT_SHARE, palette: 'lavanda', textFont: 'nunito' })
    const backup = await exportBackup()
    const share = backup.settings.find((s) => s.key === 'share')
    share.value.titleFont = 'Papyrus'
    await db.settings.clear()
    await importBackup(backup)
    expect((await db.settings.get('appearance')).value).toEqual({ theme: 'oceano' })
    const restored = (await db.settings.get('share')).value
    expect(restored.palette).toBe('lavanda')
    expect(restored.textFont).toBe('nunito')
    expect(restored.titleFont).toBe(DEFAULT_SHARE.titleFont)
  })
})

describe('respaldo', () => {
  it('exporta e importa sin perder nada', async () => {
    await saveConfig({ title: 'Club', total: 50 })
    const id = await assignNumbers([3, 4], { ...ana, referrer: 'Manu' }, { amount: 7000 })
    await assignNumbers([9], { name: 'Beto' })
    const backup = JSON.parse(JSON.stringify(await exportBackup()))

    await clearNumbers()
    const result = await importBackup(backup)
    expect(result).toEqual({ participants: 2, tickets: 3, receipts: 0 })
    expect((await tickets()).map((t) => t.number)).toEqual([3, 4, 9])
    expect((await db.purchases.get(id)).amount).toBe(7000)
    expect((await db.settings.get('config')).value.title).toBe('Club')
    const people = await db.participants.orderBy('id').toArray()
    expect(people.map((p) => p.referrer)).toEqual(['Manu', ''])
  })

  it('rechaza archivos de otra app o rotos sin tocar los datos actuales', async () => {
    await assignNumbers([1], ana)
    await expect(importBackup({ app: 'otra' })).rejects.toThrow('no es un archivo de esta app')
    await expect(importBackup({ app: 'rifa', schema: 99 })).rejects.toThrow('versión 99')
    await expect(
      importBackup({ app: 'rifa', schema: 2, participants: [], tickets: [{ number: 1, participantId: 5 }], settings: [], purchases: [] }),
    ).rejects.toThrow('no tiene dueño')
    expect(await db.tickets.count()).toBe(1)
  })

  it('rechaza números repetidos o fuera del total', async () => {
    const base = {
      app: 'rifa',
      schema: 2,
      participants: [{ id: 1, name: 'Ana' }],
      purchases: [{ id: 1, participantId: 1, amount: null }],
      settings: [{ key: 'config', value: { total: 10 } }],
    }
    const t = (number) => ({ number, participantId: 1, purchaseId: 1 })
    await expect(importBackup({ ...base, tickets: [t(1), t(1)] })).rejects.toThrow('repetidos')
    await expect(importBackup({ ...base, tickets: [t(11)] })).rejects.toThrow('supera el total')
  })

  it('acepta respaldos viejos con datos más largos que los límites actuales, recortándolos', async () => {
    const backup = {
      app: 'rifa',
      schema: 2,
      participants: [{ id: 1, name: 'N'.repeat(200), email: 'a@b' }],
      purchases: [{ id: 1, participantId: 1, amount: null }],
      tickets: [{ number: 1, participantId: 1, purchaseId: 1 }],
      settings: [],
    }
    await importBackup(backup)
    const person = await db.participants.get(1)
    expect(person.name).toHaveLength(LIMITS.name)
    expect(person.email).toBe('a@b')
    // Los respaldos de antes del referido lo traen vacío.
    expect(person.referrer).toBe('')
  })

  it('migra respaldos del formato 1 (sin comprobantes)', async () => {
    const backup = {
      app: 'rifa',
      schema: 1,
      participants: [{ id: 1, name: 'Ana' }],
      tickets: [
        { number: 1, participantId: 1, createdAt: 100 },
        { number: 2, participantId: 1, createdAt: 100 },
        { number: 3, participantId: 1, createdAt: 200 },
      ],
      settings: [],
    }
    await importBackup(backup)
    expect(await db.purchases.count()).toBe(2)
  })
})

describe('comprobantes guardados como bytes (Safari en modo privado)', () => {
  it('detecta si IndexedDB acepta Blobs', async () => {
    await expect(supportsBlobStorage()).resolves.toBe(true)
  })

  it('un comprobante guardado como bytes se lee como archivo y viaja en el respaldo', async () => {
    const id = await assignNumbers([1], ana)
    const bytes = new TextEncoder().encode('%PDF-1.4').buffer
    await db.receipts.put({ purchaseId: id, name: 'pago.pdf', type: 'application/pdf', size: 8, buffer: bytes, thumb: null })

    const stored = await db.receipts.get(id)
    const blob = receiptBlob(stored)
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe('%PDF-1.4')

    const backup = await exportBackup()
    expect(backup.receipts[0].data).toMatch(/^data:application\/pdf;base64,/)
    expect(backup.receipts[0]).not.toHaveProperty('buffer')
  })
})
