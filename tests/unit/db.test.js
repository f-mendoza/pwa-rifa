import Dexie from 'dexie'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONFIG,
  DEFAULT_SHARE,
  LIMITS,
  archiveRaffle,
  assignNumbers,
  createRaffle,
  db,
  deleteRaffle,
  ensureRaffle,
  fallbackRaffle,
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

const activeRaffle = async () => (await db.settings.get('activeRaffle'))?.value
const raffleRow = (id) => db.raffles.get(id)

/** La rifa que crea la base al instalarse. */
let raffle

beforeEach(async () => {
  await db.delete()
  await db.open()
  raffle = await activeRaffle()
})

const ana = { name: 'Ana Pérez', phone: '221 555 1234', email: 'ana@mail.com' }
const tickets = (id = raffle) => db.numbers.where('raffleId').equals(id).sortBy('number')

describe('personKey', () => {
  it('reconoce a la misma persona sin importar mayúsculas, tildes ni espacios', () => {
    expect(personKey('  ANA   pérez ')).toBe(personKey('ana perez'))
  })
})

describe('assignNumbers', () => {
  it('crea persona, comprobante y números en una sola operación', async () => {
    const purchaseId = await assignNumbers(raffle, [7, 8, 23], ana)
    const rows = await tickets()
    expect(rows.map((t) => t.number)).toEqual([7, 8, 23])
    expect(new Set(rows.map((t) => t.purchaseId))).toEqual(new Set([purchaseId]))
    expect(await db.people.count()).toBe(1)
    expect((await db.sales.get(purchaseId)).amount).toBeNull()
  })

  it('nunca vende dos veces el mismo número y no deja nada a medias', async () => {
    await assignNumbers(raffle, [5], ana)
    await expect(assignNumbers(raffle, [4, 5], { name: 'Beto' })).rejects.toThrow('Ya están tomados: 5')
    expect((await tickets()).map((t) => t.number)).toEqual([5])
    expect(await db.people.count()).toBe(1)
    expect(await db.sales.count()).toBe(1)
  })

  it('suma números a una persona existente aunque el nombre se escriba distinto', async () => {
    await assignNumbers(raffle, [1], ana)
    await assignNumbers(raffle, [2], { name: '  ana PEREZ ' })
    expect(await db.people.count()).toBe(1)
    const person = await db.people.toCollection().first()
    // El contacto vacío no pisa el que ya tenía.
    expect(person.phone).toBe(ana.phone)
  })

  it('un monto igual al calculado no se guarda como corrección', async () => {
    const id = await assignNumbers(raffle, [1, 2], ana, { amount: 8000 })
    expect((await db.sales.get(id)).amount).toBeNull()
    const other = await assignNumbers(raffle, [3], ana, { amount: 7000 })
    expect((await db.sales.get(other)).amount).toBe(7000)
  })

  it('rechaza montos inválidos antes de tocar la base', async () => {
    await expect(assignNumbers(raffle, [1], ana, { amount: -1 })).rejects.toThrow(/entero/)
    await expect(assignNumbers(raffle, [1], ana, { amount: 12.5 })).rejects.toThrow(/entero/)
    expect(await db.numbers.count()).toBe(0)
  })

  it('valida nombre obligatorio, largos y correo', async () => {
    await expect(assignNumbers(raffle, [1], { name: '   ' })).rejects.toThrow('El nombre es obligatorio')
    await expect(assignNumbers(raffle, [1], { name: 'x'.repeat(LIMITS.name + 1) })).rejects.toThrow(/hasta 80/)
    await expect(assignNumbers(raffle, [1], { name: 'Ana', phone: '1'.repeat(LIMITS.phone + 1) })).rejects.toThrow(
      /teléfono/,
    )
    await expect(assignNumbers(raffle, [1], { name: 'Ana', email: 'no-es-un-correo' })).rejects.toThrow(/correo/)
    expect(await db.numbers.count()).toBe(0)
  })

  it('guarda quién la refirió y no lo pisa si después viene vacío', async () => {
    await assignNumbers(raffle, [1], { ...ana, referrer: '  Manu  ' })
    await assignNumbers(raffle, [2], { name: 'Ana Perez' })
    expect((await db.people.toCollection().first()).referrer).toBe('Manu')
    await expect(assignNumbers(raffle, [3], { name: 'Beto', referrer: 'x'.repeat(LIMITS.referrer + 1) })).rejects.toThrow(
      /referido/,
    )
  })

  it('acepta nombres con emoji y caracteres no latinos', async () => {
    await assignNumbers(raffle, [1], { name: 'María 🎉 李' })
    expect((await db.people.toCollection().first()).name).toBe('María 🎉 李')
  })
})

describe('releaseNumber y voidPurchase', () => {
  it('liberar el último número de un comprobante borra el comprobante y la persona', async () => {
    await assignNumbers(raffle, [10], ana)
    await releaseNumber(raffle, 10)
    expect(await db.numbers.count()).toBe(0)
    expect(await db.sales.count()).toBe(0)
    expect(await db.people.count()).toBe(0)
  })

  it('liberar uno de varios mantiene el comprobante', async () => {
    await assignNumbers(raffle, [10, 11], ana)
    await releaseNumber(raffle, 10)
    expect((await tickets()).map((t) => t.number)).toEqual([11])
    expect(await db.sales.count()).toBe(1)
  })

  it('liberar un número libre no hace nada', async () => {
    await expect(releaseNumber(raffle, 99)).resolves.toBeUndefined()
  })

  it('anular una venta libera todos sus números y borra su archivo', async () => {
    const id = await assignNumbers(raffle, [1, 2, 3], ana)
    await setReceipt(id, { name: 'pago.pdf', type: 'application/pdf', size: 3, blob: new Blob(['abc']), thumb: null })
    await voidPurchase(id)
    expect(await db.numbers.count()).toBe(0)
    expect(await db.receipts.count()).toBe(0)
    expect(await db.people.count()).toBe(0)
  })
})

describe('transferNumber', () => {
  it('pasa el número a otra persona y el pago queda en el comprobante original', async () => {
    const id = await assignNumbers(raffle, [5, 6], ana)
    await transferNumber(raffle, 5, { name: 'Beto' })
    const [t5, t6] = await tickets()
    expect(t5.participantId).not.toBe(t6.participantId)
    expect(t5.purchaseId).toBe(id)
  })

  it('falla con un número libre', async () => {
    await expect(transferNumber(raffle, 1, { name: 'Beto' })).rejects.toThrow('no está tomado')
  })
})

describe('updateParticipant', () => {
  it('si el nombre nuevo ya existe, unifica a las dos personas', async () => {
    await assignNumbers(raffle, [1], ana)
    await assignNumbers(raffle, [2], { name: 'Beto', phone: '999' })
    const beto = await db.people.where('[raffleId+key]').equals([raffle, personKey('Beto')]).first()
    const finalId = await updateParticipant(beto.id, { name: 'ANA PEREZ', phone: '999' })
    expect(await db.people.count()).toBe(1)
    expect(new Set((await tickets()).map((t) => t.participantId))).toEqual(new Set([finalId]))
    expect((await db.people.get(finalId)).phone).toBe('999')
  })

  it('al unificar conserva el referido que había si el nuevo viene vacío', async () => {
    await assignNumbers(raffle, [1], { ...ana, referrer: 'Manu' })
    await assignNumbers(raffle, [2], { name: 'Beto' })
    const beto = await db.people.where('[raffleId+key]').equals([raffle, personKey('Beto')]).first()
    const finalId = await updateParticipant(beto.id, { name: 'Ana Pérez' })
    expect((await db.people.get(finalId)).referrer).toBe('Manu')
  })

  it('editar puede borrar el referido', async () => {
    await assignNumbers(raffle, [1], { ...ana, referrer: 'Manu' })
    const { id } = await db.people.toCollection().first()
    await updateParticipant(id, { ...ana, referrer: '' })
    expect((await db.people.get(id)).referrer).toBe('')
  })
})

describe('setPurchaseAmount y comprobantes', () => {
  it('corrige el monto y vuelve al calculado con null', async () => {
    const id = await assignNumbers(raffle, [1], ana)
    await setPurchaseAmount(id, 9000)
    expect((await db.sales.get(id)).amount).toBe(9000)
    await setPurchaseAmount(id, null)
    expect((await db.sales.get(id)).amount).toBeNull()
  })

  it('falla si el comprobante ya no existe', async () => {
    await expect(setPurchaseAmount(42, 100)).rejects.toThrow('ya no existe')
    await expect(setReceipt(42, { blob: new Blob(['x']) })).rejects.toThrow('ya no existe')
  })

  it('quitar el archivo deja la venta', async () => {
    const id = await assignNumbers(raffle, [1], ana)
    await setReceipt(id, { name: 'a.pdf', type: 'application/pdf', size: 1, blob: new Blob(['x']), thumb: null })
    await removeReceipt(id)
    expect(await db.receipts.count()).toBe(0)
    expect(await db.sales.count()).toBe(1)
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
    await assignNumbers(raffle, [250], ana)
    await expect(saveConfig(raffle, { total: 200 })).rejects.toThrow('el número 250 está tomado')
    await saveConfig(raffle, { total: 250 })
    expect((await raffleRow(raffle)).config.total).toBe(250)
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
    await saveSharePrefs(raffle, { ...DEFAULT_SHARE, palette: 'custom', colors, titleFont: 'nada' })
    const saved = (await raffleRow(raffle)).share
    expect(saved.titleFont).toBe(DEFAULT_SHARE.titleFont)
    expect(saved.colors.accent).toBe('#ff0000')
    await saveAppearance({ theme: 'grafito', extra: true })
    expect((await db.settings.get('appearance')).value).toEqual({ theme: 'grafito' })
  })

  it('las de la imagen viajan en el respaldo y se validan al restaurar; el tema es del dispositivo', async () => {
    await saveAppearance({ theme: 'oceano' })
    await saveSharePrefs(raffle, { ...DEFAULT_SHARE, palette: 'lavanda', textFont: 'nunito' })
    const backup = await exportBackup(raffle)
    expect(backup).not.toHaveProperty('settings')
    backup.raffle.share.titleFont = 'Papyrus'
    await saveAppearance({ theme: 'grafito' })
    const { raffleId } = await importBackup(backup)
    expect((await db.settings.get('appearance')).value).toEqual({ theme: 'grafito' })
    const restored = (await raffleRow(raffleId)).share
    expect(restored.palette).toBe('lavanda')
    expect(restored.textFont).toBe('nunito')
    expect(restored.titleFont).toBe(DEFAULT_SHARE.titleFont)
  })
})

describe('respaldo', () => {
  it('exporta e importa sin perder nada', async () => {
    await saveConfig(raffle, { title: 'Club', total: 50 })
    const id = await assignNumbers(raffle, [3, 4], { ...ana, referrer: 'Manu' }, { amount: 7000 })
    await assignNumbers(raffle, [9], { name: 'Beto' })
    const backup = JSON.parse(JSON.stringify(await exportBackup(raffle)))
    expect(backup.schema).toBe(3)

    const result = await importBackup(backup)
    expect(result).toEqual({ raffleId: expect.any(String), title: 'Club', participants: 2, tickets: 3, receipts: 0 })
    const copy = result.raffleId
    expect(copy).not.toBe(raffle)
    expect(await activeRaffle()).toBe(copy)
    expect((await tickets(copy)).map((t) => t.number)).toEqual([3, 4, 9])
    const [sale] = await db.sales.where('raffleId').equals(copy).filter((s) => s.amount !== null).toArray()
    expect(sale.amount).toBe(7000)
    expect(sale.id).not.toBe(id)
    expect((await raffleRow(copy)).config).toMatchObject({ title: 'Club', total: 50 })
    const people = await db.people.where('raffleId').equals(copy).sortBy('name')
    expect(people.map((p) => p.referrer)).toEqual(['Manu', ''])
    // La rifa original queda como estaba.
    expect((await tickets()).map((t) => t.number)).toEqual([3, 4, 9])
    expect(await db.people.count()).toBe(4)
  })

  it('rechaza archivos de otra app o rotos sin tocar los datos actuales', async () => {
    await assignNumbers(raffle, [1], ana)
    await expect(importBackup({ app: 'otra' })).rejects.toThrow('no es un archivo de esta app')
    await expect(importBackup({ app: 'rifa', schema: 99 })).rejects.toThrow('versión 99')
    await expect(
      importBackup({ app: 'rifa', schema: 2, participants: [], tickets: [{ number: 1, participantId: 5 }], settings: [], purchases: [] }),
    ).rejects.toThrow('no tiene dueño')
    expect(await db.numbers.count()).toBe(1)
    expect(await db.raffles.count()).toBe(1)
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
    const { raffleId } = await importBackup(backup)
    const person = await db.people.where('raffleId').equals(raffleId).first()
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
    await assignNumbers(raffle, [1], ana)
    const { raffleId } = await importBackup(backup)
    expect(await db.sales.where('raffleId').equals(raffleId).count()).toBe(2)
    expect(await db.sales.where('raffleId').equals(raffle).count()).toBe(1)
  })

  it('un respaldo del formato 2 trae su configuración e ignora el tema', async () => {
    const { raffleId } = await importBackup({
      app: 'rifa',
      schema: 2,
      participants: [{ id: 1, name: 'Ana' }],
      purchases: [{ id: 7, participantId: 1, amount: 900 }],
      tickets: [{ number: 4, participantId: 1, purchaseId: 7 }],
      settings: [
        { key: 'config', value: { title: 'Vieja', total: 40 } },
        { key: 'share', value: { format: 'post' } },
        { key: 'appearance', value: { theme: 'noche' } },
      ],
    })
    const imported = await raffleRow(raffleId)
    expect(imported.config).toMatchObject({ title: 'Vieja', total: 40 })
    expect(imported.share.format).toBe('post')
    expect(await db.settings.get('appearance')).toBeUndefined()
    const [ticket] = await tickets(raffleId)
    expect((await db.sales.get(ticket.purchaseId)).amount).toBe(900)
  })
})

describe('comprobantes guardados como bytes (Safari en modo privado)', () => {
  it('detecta si IndexedDB acepta Blobs', async () => {
    await expect(supportsBlobStorage()).resolves.toBe(true)
  })

  it('un comprobante guardado como bytes se lee como archivo y viaja en el respaldo', async () => {
    const id = await assignNumbers(raffle, [1], ana)
    const bytes = new TextEncoder().encode('%PDF-1.4').buffer
    await db.receipts.put({ purchaseId: id, raffleId: raffle, name: 'pago.pdf', type: 'application/pdf', size: 8, buffer: bytes, thumb: null })

    const stored = await db.receipts.get(id)
    const blob = receiptBlob(stored)
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe('%PDF-1.4')

    const backup = await exportBackup(raffle)
    expect(backup.receipts[0].data).toMatch(/^data:application\/pdf;base64,/)
    expect(backup.receipts[0]).not.toHaveProperty('buffer')
  })
})

describe('varias rifas', () => {
  it('la instalación arranca con una rifa abierta', async () => {
    expect(await db.raffles.count()).toBe(1)
    expect((await raffleRow(raffle)).config).toEqual(DEFAULT_CONFIG)
  })

  it('cada rifa tiene sus números, sus personas y su configuración', async () => {
    const other = await createRaffle({ title: 'Club' })
    await assignNumbers(raffle, [5], ana)
    await assignNumbers(other, [5], { ...ana, phone: '' })
    expect((await tickets(other)).map((t) => t.number)).toEqual([5])
    // La misma persona en dos rifas son dos filas: editar una no toca la otra.
    const people = await db.people.toArray()
    expect(people).toHaveLength(2)
    expect(new Set(people.map((p) => p.raffleId))).toEqual(new Set([raffle, other]))

    await releaseNumber(other, 5)
    expect((await tickets()).map((t) => t.number)).toEqual([5])
    await expect(saveConfig(raffle, { total: 3 })).rejects.toThrow('el número 5 está tomado')
    await saveConfig(other, { total: 3 })
    expect((await raffleRow(raffle)).config.total).toBe(300)
  })

  it('unificar personas sólo mira la misma rifa', async () => {
    const other = await createRaffle()
    await assignNumbers(raffle, [1], ana)
    await assignNumbers(other, [1], { name: 'Beto' })
    const beto = await db.people.where('raffleId').equals(other).first()
    await updateParticipant(beto.id, { name: 'Ana Pérez' })
    expect(await db.people.count()).toBe(2)
  })

  it('crear copiando otra rifa usa su configuración e imagen, sin las ventas, y la abre', async () => {
    await saveConfig(raffle, { title: 'Club', total: 80, prizes: ['Bici'] })
    await saveSharePrefs(raffle, { ...DEFAULT_SHARE, palette: 'menta' })
    await assignNumbers(raffle, [1], ana)
    const copy = await createRaffle({ title: 'Club 2', copyFrom: raffle })
    const row = await raffleRow(copy)
    expect(row.config).toMatchObject({ title: 'Club 2', total: 80, prizes: ['Bici'] })
    expect(row.share.palette).toBe('menta')
    expect(row.archivedAt).toBeNull()
    expect(await tickets(copy)).toEqual([])
    expect(await activeRaffle()).toBe(copy)
  })

  it('una rifa de cero no hereda premios ni texto del sorteo', async () => {
    const id = await createRaffle({ title: 'Nueva' })
    expect((await raffleRow(id)).config).toMatchObject({ title: 'Nueva', prizes: [], drawText: '' })
  })

  it('archivar sólo marca la rifa', async () => {
    await archiveRaffle(raffle)
    expect((await raffleRow(raffle)).archivedAt).toEqual(expect.any(Number))
    await archiveRaffle(raffle, false)
    expect((await raffleRow(raffle)).archivedAt).toBeNull()
  })

  it('para abrir por defecto elige la más nueva sin archivar', () => {
    const r = (id, createdAt, archivedAt = null) => ({ id, createdAt, archivedAt })
    expect(fallbackRaffle([r('a', 1), r('b', 3, 9), r('c', 2)]).id).toBe('c')
    expect(fallbackRaffle([r('a', 1, 5), r('b', 3, 9)]).id).toBe('b')
    expect(fallbackRaffle([])).toBeNull()
  })

  it('borrar una rifa se lleva todo lo suyo y abre otra', async () => {
    const other = await createRaffle({ title: 'Club' })
    const id = await assignNumbers(other, [1, 2], ana, {
      receipt: { name: 'a.pdf', type: 'application/pdf', size: 1, blob: new Blob(['x']), thumb: null },
    })
    await assignNumbers(raffle, [1], ana)
    expect(await deleteRaffle(other)).toBe(raffle)
    expect(await activeRaffle()).toBe(raffle)
    expect(await db.receipts.get(id)).toBeUndefined()
    expect(await db.sales.count()).toBe(1)
    expect(await db.people.count()).toBe(1)
    expect((await tickets()).map((t) => t.number)).toEqual([1])
  })

  it('borrar la última rifa deja una nueva vacía', async () => {
    await assignNumbers(raffle, [1], ana)
    const next = await deleteRaffle(raffle)
    expect(next).not.toBe(raffle)
    expect(await db.raffles.count()).toBe(1)
    expect(await db.numbers.count()).toBe(0)
    expect(await activeRaffle()).toBe(next)
  })

  it('si la rifa abierta ya no está, ensureRaffle elige otra', async () => {
    const other = await createRaffle()
    await db.settings.put({ key: 'activeRaffle', value: 'no-existe' })
    expect(await ensureRaffle()).toBe(other)
  })

  it('operar sobre una rifa borrada falla con un mensaje claro', async () => {
    await expect(assignNumbers('no-existe', [1], ana)).rejects.toThrow('La rifa ya no existe')
    await expect(saveConfig('no-existe', {})).rejects.toThrow('La rifa ya no existe')
  })

  it('los ids son UUIDv7', async () => {
    const id = await assignNumbers(raffle, [1], ana)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(raffle).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/)
  })
})

describe('migración desde la versión de una sola rifa', () => {
  /** Arma una base con el esquema viejo, como la dejaba la app antes de las rifas múltiples. */
  async function legacyDatabase(version, fill) {
    db.close()
    await Dexie.delete('rifa')
    const old = new Dexie('rifa')
    old.version(1).stores({ participants: '++id, &key', tickets: 'number, participantId', settings: 'key' })
    if (version === 2) {
      old.version(2).stores({
        participants: '++id, &key',
        tickets: 'number, participantId, purchaseId',
        purchases: '++id, participantId, createdAt',
        receipts: 'purchaseId',
        settings: 'key',
      })
    }
    await old.open()
    await old.transaction('rw', old.tables, () => fill(old))
    old.close()
    await db.open()
  }

  it('lo que había pasa a ser una rifa, con ids nuevos y todo enlazado', async () => {
    await legacyDatabase(2, async (old) => {
      await old.table('participants').bulkAdd([
        { id: 1, name: 'Ana', key: 'ana', phone: '1', email: '', referrer: 'Manu', createdAt: 1000 },
        { id: 2, name: 'Beto', key: 'beto', phone: '', email: '', referrer: '', createdAt: 2000 },
      ])
      await old.table('purchases').bulkAdd([
        { id: 1, participantId: 1, createdAt: 1000, amount: null },
        { id: 2, participantId: 2, createdAt: 2000, amount: 4500 },
      ])
      await old.table('tickets').bulkAdd([
        { number: 7, participantId: 1, purchaseId: 1, createdAt: 1000 },
        { number: 8, participantId: 1, purchaseId: 1, createdAt: 1000 },
        { number: 20, participantId: 2, purchaseId: 2, createdAt: 2000 },
      ])
      await old.table('receipts').put({ purchaseId: 2, name: 'pago.pdf', type: 'application/pdf', size: 3, blob: new Blob(['abc']), thumb: null })
      await old.table('settings').bulkAdd([
        { key: 'config', value: { ...DEFAULT_CONFIG, title: 'Club', total: 50 } },
        { key: 'share', value: { ...DEFAULT_SHARE, palette: 'menta' } },
        { key: 'appearance', value: { theme: 'noche' } },
      ])
    })

    const raffles = await db.raffles.toArray()
    expect(raffles).toHaveLength(1)
    const [migrated] = raffles
    expect(migrated.config).toMatchObject({ title: 'Club', total: 50 })
    expect(migrated.share.palette).toBe('menta')
    expect(migrated.createdAt).toBe(1000)
    expect(migrated.lastSeq).toBe(2)
    expect(await activeRaffle()).toBe(migrated.id)
    expect((await db.settings.get('appearance')).value).toEqual({ theme: 'noche' })
    expect(await db.settings.get('config')).toBeUndefined()

    const numbers = await tickets(migrated.id)
    expect(numbers.map((t) => t.number)).toEqual([7, 8, 20])
    const people = new Map((await db.people.toArray()).map((p) => [p.id, p]))
    const sales = new Map((await db.sales.toArray()).map((s) => [s.id, s]))
    expect(people.size).toBe(2)
    expect(sales.size).toBe(2)
    for (const t of numbers) {
      expect(t.id).toBe(`${migrated.id}:${t.number}`)
      expect(people.get(t.participantId).raffleId).toBe(migrated.id)
      expect(sales.get(t.purchaseId).participantId).toBe(t.participantId)
    }
    const beto = numbers.find((t) => t.number === 20)
    expect(people.get(beto.participantId).name).toBe('Beto')
    expect(sales.get(beto.purchaseId).amount).toBe(4500)
    const receipt = await db.receipts.get(beto.purchaseId)
    expect(receipt.raffleId).toBe(migrated.id)
    expect(await receiptBlob(receipt).text()).toBe('abc')

    // Y se sigue usando normalmente.
    await assignNumbers(migrated.id, [9], { name: 'ana' })
    expect(people.get((await tickets(migrated.id))[2].participantId).name).toBe('Ana')
  })

  it('desde la versión 1 también, agrupando los números en comprobantes', async () => {
    await legacyDatabase(1, async (old) => {
      await old.table('participants').add({ id: 1, name: 'Ana', key: 'ana', createdAt: 5 })
      await old.table('tickets').bulkAdd([
        { number: 1, participantId: 1, createdAt: 100 },
        { number: 2, participantId: 1, createdAt: 100 },
        { number: 3, participantId: 1, createdAt: 200 },
      ])
    })
    const [migrated] = await db.raffles.toArray()
    expect(migrated.config).toEqual(DEFAULT_CONFIG)
    expect(await db.sales.count()).toBe(2)
    expect((await tickets(migrated.id)).every((t) => t.purchaseId)).toBe(true)
  })

  it('una base vieja sin datos queda con una rifa vacía', async () => {
    await legacyDatabase(2, async () => {})
    expect(await db.raffles.count()).toBe(1)
    expect(await activeRaffle()).toBe((await db.raffles.toCollection().first()).id)
  })
})

describe('número de comprobante', () => {
  const seqs = async (id = raffle) => (await db.sales.where('raffleId').equals(id).sortBy('seq')).map((s) => s.seq)

  it('es correlativo dentro de cada rifa', async () => {
    const other = await createRaffle()
    await assignNumbers(raffle, [1], ana)
    await assignNumbers(raffle, [2], { name: 'Beto' })
    await assignNumbers(other, [1], ana)
    expect(await seqs()).toEqual([1, 2])
    expect(await seqs(other)).toEqual([1])
  })

  it('sigue después del último aunque se anulen ventas', async () => {
    await assignNumbers(raffle, [1], ana)
    const second = await assignNumbers(raffle, [2], ana)
    await voidPurchase(second)
    await assignNumbers(raffle, [3], ana)
    expect(await seqs()).toEqual([1, 3])
  })

  it('viaja en el respaldo; en los formatos viejos sale del id', async () => {
    await assignNumbers(raffle, [1], ana)
    await assignNumbers(raffle, [2], { name: 'Beto' })
    const { raffleId } = await importBackup(await exportBackup(raffle))
    expect(await seqs(raffleId)).toEqual([1, 2])

    const old = await importBackup({
      app: 'rifa',
      schema: 2,
      participants: [{ id: 1, name: 'Ana' }],
      purchases: [{ id: 5, participantId: 1, amount: null }],
      tickets: [{ number: 1, participantId: 1, purchaseId: 5 }],
      settings: [],
    })
    expect(await seqs(old.raffleId)).toEqual([5])
    await assignNumbers(old.raffleId, [2], ana)
    expect(await seqs(old.raffleId)).toEqual([5, 6])
  })

  it('si el respaldo no lo trae, se numera a continuación en orden de venta', async () => {
    const backup = await exportBackup(raffle)
    backup.participants = [{ id: 'p', name: 'Ana' }]
    backup.purchases = [
      { id: 'a', participantId: 'p', createdAt: 300, amount: null, seq: 4 },
      { id: 'b', participantId: 'p', createdAt: 200, amount: null },
      { id: 'c', participantId: 'p', createdAt: 100, amount: null },
    ]
    backup.tickets = [
      { number: 1, participantId: 'p', purchaseId: 'a' },
      { number: 2, participantId: 'p', purchaseId: 'b' },
      { number: 3, participantId: 'p', purchaseId: 'c' },
    ]
    const { raffleId } = await importBackup(backup)
    const byNumber = new Map((await tickets(raffleId)).map((t) => [t.number, t.purchaseId]))
    expect((await db.sales.get(byNumber.get(3))).seq).toBe(5)
    expect((await db.sales.get(byNumber.get(2))).seq).toBe(6)
  })
})
