import { expect, test } from '@playwright/test'
import { assign, cell, openApp } from './helpers.js'

test('una rifa local no muestra nada de sincronización', async ({ page }) => {
  await openApp(page)
  await assign(page, [1], { name: 'Ana' })
  await expect(page.locator('.sync-bar')).toHaveCount(0)
})

test('un servidor inaccesible deja de mostrarse sincronizado aunque haya internet y no haya ventas pendientes', async ({ page }) => {
  await page.goto('/?nube-falsa')
  await page.waitForFunction(() => Boolean(globalThis.__rifaNube))
  await page.evaluate(() => globalThis.__rifaNube.createRaffle('Conexión'))
  const state = page.locator('.sync-state')
  await expect(state).toHaveText('Sincronizado')
  await page.evaluate(() => globalThis.__rifaNube.setOnline(false))
  await expect(state).toContainText('Sin conexión con la nube', { timeout: 15_000 })
  await expect(state).toContainText('Tus datos siguen guardados en este teléfono')
  await page.evaluate(() => globalThis.__rifaNube.setOnline(true))
  await expect(state).toHaveText('Sincronizado', { timeout: 15_000 })
})

// `/?nube-falsa` (sólo en desarrollo) reemplaza la API por un servidor en memoria: ver src/sync/dev.js.
test('rifa en la nube: cambios sin enviar, sincronizado y conflictos', async ({ page }) => {
  await page.goto('/?nube-falsa')
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible()
  await page.waitForFunction(() => Boolean(globalThis.__rifaNube))
  const raffleId = await page.evaluate(() => globalThis.__rifaNube.createRaffle('Nube'))
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('NUBE')
  const state = page.locator('.sync-state')
  await expect(state).toHaveText('Sincronizado')

  // El servidor no responde: lo vendido queda en el teléfono, pendiente de enviar.
  await page.evaluate(() => globalThis.__rifaNube.setOnline(false))
  await assign(page, [3], { name: 'Ana' })
  await expect(cell(page, 3)).toHaveAccessibleName('Número 3, tomado por Ana')
  await expect(state).toHaveText('1 cambio sin enviar')

  // Mientras tanto, otro teléfono vende el mismo número.
  await page.evaluate((id) => globalThis.__rifaNube.sellFromOtherPhone(id, [3], 'Caro'), raffleId)
  await page.evaluate(() => globalThis.__rifaNube.setOnline(true))

  const conflicts = page.getByRole('button', { name: /Hay conflictos/ })
  await expect(conflicts).toBeVisible({ timeout: 15_000 })
  await expect(state).toHaveText('Sincronizado')
  await expect(cell(page, 3)).toHaveAccessibleName('Número 3, tomado por Caro')

  await conflicts.click()
  const dialog = page.getByRole('dialog', { name: 'Conflictos' })
  await expect(dialog).toContainText('Venta del número 3 a Ana')
  await expect(dialog).toContainText('El número 3 ya lo había vendido Juan a Caro desde otro teléfono')
  await dialog.getByRole('button', { name: 'Entendido' }).click()
  await expect(dialog).toBeHidden()
  await expect(conflicts).toHaveCount(0)
})
