import { expect, test } from '@playwright/test'
import { assign, goTo, openApp, toast } from './helpers.js'

test.beforeEach(async ({ page }) => openApp(page))

test('genera la vista previa y la regenera al vender', async ({ page }) => {
  await goTo(page, 'Imagen')
  const preview = page.getByRole('img', { name: /Vista previa: 300 números disponibles/ })
  await expect(preview).toBeVisible()
  await expect(page.getByRole('button', { name: 'Compartir imagen' })).toBeEnabled()

  await goTo(page, 'Números')
  await assign(page, [1], { name: 'Ana' })
  await goTo(page, 'Imagen')
  await expect(page.getByRole('img', { name: /Vista previa: 299 números disponibles/ })).toBeVisible()
})

test('cambiar formato cambia la proporción de la imagen', async ({ page }) => {
  await goTo(page, 'Imagen')
  const figure = page.locator('.preview')
  await expect(figure).toHaveAttribute('style', /1080 \/ 1920/)
  await page.getByText('Publicación').click()
  await expect(figure).toHaveAttribute('style', /1080 \/ 1350/)
})

test('descargar el PNG', async ({ page }) => {
  await goTo(page, 'Imagen')
  await expect(page.getByRole('button', { name: 'Descargar PNG' })).toBeEnabled()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Descargar PNG' }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/^rifa-disponibles-\d{4}-\d{2}-\d{2}\.png$/)
  await expect(toast(page)).toContainText('Imagen descargada')
})

test('copiar la lista en texto', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'WebKit no permite leer el portapapeles en tests')
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await goTo(page, 'Imagen')
  await page.getByRole('button', { name: 'Copiar lista en texto' }).click()
  await expect(toast(page)).toContainText('Lista copiada')
  const text = await page.evaluate(() => navigator.clipboard.readText())
  expect(text).toContain('Números disponibles (300 de 300)')
})
