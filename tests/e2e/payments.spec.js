import { expect, test } from '@playwright/test'
import { assign, cell, goTo, openApp, receiptImage, toast } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await assign(page, [1, 2], { name: 'Ana' }, { receipt: receiptImage })
  await assign(page, [3], { name: 'Beto' }, { amount: 9000 })
  await goTo(page, 'Pagos')
})

test('lista comprobantes con total, monto corregido y faltantes', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Comprobantes' })).toBeVisible()
  await expect(page.getByText('2 ventas · $17.000 recaudado')).toBeVisible()
  await expect(page.locator('.payment')).toHaveCount(2)
  // El de Ana tiene miniatura de la imagen subida.
  await expect(page.locator('.payment', { hasText: 'Ana' }).locator('img.thumb')).toBeVisible()

  await page.getByRole('radio', { name: /Sin comprobante/ }).click()
  await expect(page.locator('.payment')).toHaveCount(1)
  await expect(page.locator('.payment')).toContainText('Beto')
  await page.getByRole('radio', { name: /Monto corregido/ }).click()
  await expect(page.locator('.payment')).toContainText('$9.000')
})

test('corregir el monto y volver al calculado', async ({ page }) => {
  await page.locator('.payment', { hasText: 'Ana' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('spinbutton').fill('10000')
  await dialog.getByRole('button', { name: 'Guardar monto' }).click()
  await expect(toast(page)).toContainText('Monto actualizado')
  await expect(dialog.locator('.purchase-amount')).toHaveText('$10.000')
  await expect(dialog.getByText('Monto corregido')).toBeVisible()

  await dialog.getByRole('button', { name: 'Volver al calculado' }).click()
  await dialog.getByRole('button', { name: 'Usar $8.000' }).click()
  await expect(dialog.locator('.purchase-amount')).toHaveText('$8.000')
})

test('subir y quitar un comprobante', async ({ page }) => {
  await page.locator('.payment', { hasText: 'Beto' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type=file]').setInputFiles(receiptImage)
  await expect(toast(page)).toContainText('Comprobante guardado')
  await expect(dialog.getByRole('button', { name: /Abrir comprobante de Beto/ })).toBeVisible()

  await dialog.getByRole('button', { name: 'Quitar' }).click()
  await dialog.getByRole('button', { name: 'Sí, quitar' }).click()
  await expect(toast(page)).toContainText('Comprobante quitado')
})

test('un archivo que no es imagen ni PDF se rechaza con un mensaje claro', async ({ page }) => {
  await page.locator('.payment', { hasText: 'Beto' }).click()
  await page
    .getByRole('dialog')
    .locator('input[type=file]')
    .setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
  await expect(toast(page)).toContainText('tiene que ser una imagen o un PDF')
})

test('anular una venta libera sus números', async ({ page }) => {
  await page.locator('.payment', { hasText: 'Ana' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Anular venta…' }).click()
  await expect(dialog.getByRole('alert')).toContainText('1, 2')
  await dialog.getByRole('button', { name: 'Sí, anular' }).click()
  await expect(dialog).toBeHidden()
  await expect(toast(page)).toContainText('Venta anulada')
  await expect(page.locator('.payment')).toHaveCount(1)
  await goTo(page, 'Números')
  await expect(cell(page, 1)).toHaveAccessibleName('Número 1, disponible')
})
