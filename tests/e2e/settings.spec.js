import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import { assign, cell, goTo, openApp, toast } from './helpers.js'

test.beforeEach(async ({ page }) => openApp(page))

test('cambiar título, cantidad y precio se refleja en toda la app', async ({ page }) => {
  await goTo(page, 'Ajustes')
  await page.getByLabel('Título').fill('Club Atenas')
  const total = page.getByLabel('Cantidad de números')
  await total.fill('')
  await total.fill('50')
  await page.getByLabel('Precio por número').fill('1250')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(toast(page)).toContainText('Cambios guardados')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CLUB ATENAS')
  await expect(page.getByText('0% vendido · 0 de 50')).toBeVisible()

  await goTo(page, 'Números')
  await expect(page.locator('.number-grid .cell')).toHaveCount(50)
})

test('un título largo usa la variante compacta del logo', async ({ page }) => {
  await goTo(page, 'Ajustes')
  await page.getByLabel('Título').fill('Rifa solidaria del Club Atenas 2026')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveClass(/is-long/)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBe(0)
})

test('no deja bajar la cantidad por debajo de un número vendido', async ({ page }) => {
  await assign(page, [40], { name: 'Ana' })
  await goTo(page, 'Ajustes')
  await page.getByLabel('Cantidad de números').fill('30')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(toast(page)).toContainText('el número 40 está tomado')
  await expect(toast(page).getByRole('alert')).toBeVisible()
})

test('agregar y quitar premios; descartar vuelve atrás', async ({ page }) => {
  await goTo(page, 'Ajustes')
  const prizes = page.getByRole('group', { name: 'Premios (en orden)' })
  const before = await prizes.getByRole('textbox').count()
  await prizes.getByRole('button', { name: '+ Agregar premio' }).click()
  await expect(prizes.getByRole('textbox')).toHaveCount(before + 1)
  await prizes.getByRole('button', { name: 'Quitar premio 1' }).click()
  await page.getByRole('button', { name: 'Descartar' }).click()
  await expect(prizes.getByRole('textbox')).toHaveCount(before)
})

test('respaldo: descargar y restaurar pide confirmación si hay datos', async ({ page }) => {
  await assign(page, [5, 6], { name: 'Ana' })
  await goTo(page, 'Ajustes')

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar respaldo' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^rifa-respaldo-\d{4}-\d{2}-\d{2}\.json$/)
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'))
  expect(backup.tickets).toHaveLength(2)

  // Se vende otro número y después se restaura el respaldo: tiene que confirmar.
  await goTo(page, 'Números')
  await assign(page, [7], { name: 'Beto' })
  await goTo(page, 'Ajustes')
  await page.locator('input[type=file][accept*=json]').setInputFiles({
    name: 'respaldo.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const confirm = page.getByRole('alert').filter({ hasText: 'reemplaza todo' })
  await expect(confirm).toContainText('3 números tomados')
  await confirm.getByRole('button', { name: 'Sí, restaurar' }).click()
  await expect(toast(page)).toContainText('Respaldo restaurado: 2 números, 1 persona')

  await goTo(page, 'Números')
  await expect(cell(page, 7)).toHaveAccessibleName('Número 7, disponible')
})

test('un archivo que no es respaldo se rechaza sin tocar nada', async ({ page }) => {
  await goTo(page, 'Ajustes')
  await page.locator('input[type=file][accept*=json]').setInputFiles({
    name: 'otra-cosa.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"hola": 1}'),
  })
  await expect(toast(page)).toContainText('no es un archivo de esta app')
  await page.locator('input[type=file][accept*=json]').setInputFiles({
    name: 'roto.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{roto'),
  })
  await expect(toast(page)).toContainText('El archivo no es un respaldo válido')
})

test('empezar una rifa nueva pide confirmación y borra las ventas', async ({ page }) => {
  await assign(page, [1], { name: 'Ana' })
  await goTo(page, 'Ajustes')
  await page.getByRole('button', { name: 'Empezar una rifa nueva…' }).click()
  await page.getByRole('button', { name: 'Sí, borrar todo' }).click()
  await expect(toast(page)).toContainText('Rifa reiniciada')
  await expect(page.getByText('0% vendido · 0 de 300')).toBeVisible()
})
