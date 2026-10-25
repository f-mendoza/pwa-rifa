import { expect, test } from '@playwright/test'
import { assign, cell, createRaffle, goTo, openApp, openRaffles, toast } from './helpers.js'

test.beforeEach(async ({ page }) => openApp(page))

test('cada rifa tiene sus números y la abierta se mantiene al recargar', async ({ page }) => {
  await assign(page, [7], { name: 'Ana' })
  await goTo(page, 'Ajustes')
  await page.getByLabel('Cantidad de números').fill('120')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(toast(page)).toContainText('Cambios guardados')

  await createRaffle(page, 'Club Atenas')
  await expect(toast(page)).toContainText('Rifa «Club Atenas» creada')
  // Copió la configuración pero no las ventas, y arranca en Números.
  await expect(page.getByText('0% vendido · 0 de 120')).toBeVisible()
  await expect(cell(page, 7)).toHaveAccessibleName('Número 7, disponible')
  await assign(page, [7, 8], { name: 'Beto' })

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CLUB ATENAS')
  await expect(cell(page, 7)).toHaveAccessibleName('Número 7, tomado por Beto')

  const dialog = await openRaffles(page)
  await expect(dialog.getByRole('button', { name: /Club Atenas/ })).toHaveAttribute('aria-current', 'true')
  await expect(dialog.getByRole('button', { name: /Club Atenas/ })).toContainText('2 de 120 vendidos · $8.000')
  await dialog.getByRole('button', { name: /^Rifa/ }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RIFA')
  await expect(cell(page, 7)).toHaveAccessibleName('Número 7, tomado por Ana')
  await expect(cell(page, 8)).toHaveAccessibleName('Número 8, disponible')
})

test('una rifa de cero no copia premios ni texto del sorteo', async ({ page }) => {
  await createRaffle(page, 'Nueva', { copy: false })
  await expect(page.locator('.brand-sub')).toHaveCount(0)
  await goTo(page, 'Ajustes')
  await expect(page.getByRole('group', { name: 'Premios (en orden)' }).getByRole('textbox')).toHaveCount(0)
})

test('archivar una rifa la muestra aparte y se puede desarchivar', async ({ page }) => {
  await createRaffle(page, 'Vieja')
  await goTo(page, 'Ajustes')
  await page.getByRole('button', { name: 'Archivar rifa' }).click()
  await expect(toast(page)).toContainText('Rifa «Vieja» archivada')

  const dialog = await openRaffles(page)
  await expect(dialog.locator('.raffle-list').first().locator('.raffle-item')).toHaveCount(1)
  await dialog.getByText('Archivadas').click()
  await expect(dialog.locator('.raffle-archived .raffle-item')).toContainText('Vieja')
  await dialog.getByRole('button', { name: 'Cerrar' }).click()

  await page.getByRole('button', { name: 'Desarchivar rifa' }).click()
  await expect(toast(page)).toContainText('Rifa «Vieja» desarchivada')
})

test('borrar la rifa abierta pasa a otra', async ({ page }) => {
  await assign(page, [3], { name: 'Ana' })
  await createRaffle(page, 'Para borrar')
  await assign(page, [9], { name: 'Beto' })
  await goTo(page, 'Ajustes')
  await page.getByRole('button', { name: 'Borrar esta rifa…' }).click()
  await page.getByRole('button', { name: 'Sí, borrar la rifa' }).click()
  await expect(toast(page)).toContainText('Rifa «Para borrar» borrada')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RIFA')
  await expect(cell(page, 3)).toHaveAccessibleName('Número 3, tomado por Ana')

  const dialog = await openRaffles(page)
  await expect(dialog.locator('.raffle-item')).toHaveCount(1)
})
