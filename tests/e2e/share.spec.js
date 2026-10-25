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

test('colores y letras de la imagen: tema, personalizados y volver al original', async ({ page }) => {
  await goTo(page, 'Imagen')
  const preview = page.locator('.preview img')
  await expect(preview).toBeVisible()
  const src = () => preview.getAttribute('src')

  const style = page.locator('.share-style')
  await style.getByText('Colores y letras').click()
  await expect(style.getByText('Colores como la app')).toBeVisible()

  // Un tema para la imagen redibuja la vista previa.
  let before = await src()
  await style.locator('.palette-option', { hasText: 'Menta' }).click()
  await expect(preview).not.toHaveAttribute('src', before)
  await expect(page.getByRole('button', { name: 'Compartir imagen' })).toBeEnabled()

  // Personalizar arranca de los colores que se estaban viendo.
  await style.locator('.palette-option', { hasText: 'Personalizar' }).click()
  const fields = style.locator('.color-field')
  await expect(fields).toHaveCount(6)
  await expect(fields.filter({ hasText: 'Fondo, izquierda' })).toContainText('#E2F7C9')

  // Casillas del mismo color que los números: avisa que no se va a leer.
  before = await src()
  await fields.filter({ hasText: 'Casillas' }).locator('input').fill('#0c2a27')
  await expect(style.getByRole('status')).toContainText('Los números se leen mal')
  await expect(preview).not.toHaveAttribute('src', before)

  before = await src()
  await style.locator('.font-option', { hasText: 'Lobster' }).click()
  await expect(style.getByRole('radio', { name: /Lobster/ })).toBeChecked()
  await expect(preview).not.toHaveAttribute('src', before)
  await expect(style.locator('summary')).toContainText('Colores personalizados · Lobster y Outfit')

  // Se recuerda al volver a la pestaña.
  await goTo(page, 'Números')
  await goTo(page, 'Imagen')
  await expect(style.locator('summary')).toContainText('Lobster')

  await style.locator('summary').click()
  await style.getByRole('button', { name: 'Volver al diseño original' }).click()
  await expect(style.locator('summary')).toContainText('Colores como la app · Big Shoulders y Outfit')
  await expect(style.getByRole('button', { name: 'Volver al diseño original' })).toBeHidden()
})

for (const name of ['Océano', 'Bosque', 'Marea', 'Terracota']) {
  test(`con "Como la app", elegir ${name} redibuja la imagen`, async ({ page }) => {
    await goTo(page, 'Imagen')
    const preview = page.locator('.preview img')
    await expect(preview).toBeVisible()
    const before = await preview.getAttribute('src')
    await goTo(page, 'Ajustes')
    await page.locator('.theme-option', { hasText: name }).click()
    await goTo(page, 'Imagen')
    await expect(preview).not.toHaveAttribute('src', before)
  })
}
