import { expect, test } from '@playwright/test'
import { assign, cell, goTo, openApp, toast } from './helpers.js'

test.beforeEach(async ({ page }) => {
  await openApp(page)
  await assign(page, [10, 11], { name: 'Ana Pérez', phone: '221 555 1234', email: 'ana@mail.com' })
})

test('tocar un número tomado muestra dueño, contacto y comprobante', async ({ page }) => {
  await cell(page, 10).click()
  const dialog = page.getByRole('dialog', { name: 'Número 10' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Ana Pérez')
  await expect(dialog.getByRole('link', { name: '221 555 1234' })).toHaveAttribute('href', 'tel:2215551234')
  await expect(dialog.getByRole('link', { name: 'ana@mail.com' })).toHaveAttribute('href', 'mailto:ana@mail.com')
  await expect(dialog).toContainText('Comprobante #1')

  // Ir a otro número de la misma persona.
  await dialog.getByRole('button', { name: '11', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Número 11' })).toBeVisible()
})

test('liberar pide confirmación y deja el número disponible', async ({ page }) => {
  await cell(page, 10).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Liberar número' }).click()
  await expect(dialog.getByRole('alert')).toContainText('¿Liberar el número 10?')
  await dialog.getByRole('button', { name: 'No, dejarlo' }).click()
  await dialog.getByRole('button', { name: 'Liberar número' }).click()
  await dialog.getByRole('button', { name: 'Sí, liberar' }).click()
  await expect(dialog).toBeHidden()
  await expect(toast(page)).toContainText('Número 10 liberado')
  await expect(cell(page, 10)).toHaveAccessibleName('Número 10, disponible')
})

test('pasar un número a otra persona', async ({ page }) => {
  await cell(page, 11).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Pasar a otra persona' }).click()
  await dialog.getByPlaceholder('Ej: Ana Pérez').fill('Beto')
  await dialog.getByRole('button', { name: 'Pasar el 11' }).click()
  await expect(toast(page)).toContainText('Número 11 pasado a Beto')
  await expect(cell(page, 11)).toHaveAccessibleName('Número 11, tomado por Beto')
})

test('editar datos con un correo inválido no se guarda', async ({ page }) => {
  await cell(page, 10).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Editar datos' }).click()
  await dialog.getByPlaceholder('ana@mail.com').fill('sin-arroba')
  await dialog.getByRole('button', { name: 'Guardar datos' }).click()
  // La validación nativa frena el envío: el formulario sigue abierto.
  await expect(dialog.getByRole('button', { name: 'Guardar datos' })).toBeVisible()
  await dialog.getByPlaceholder('ana@mail.com').fill('ana@club.org')
  await dialog.getByRole('button', { name: 'Guardar datos' }).click()
  await expect(toast(page)).toContainText('Datos actualizados')
})

test('Escape y el fondo cierran la hoja con animación', async ({ page }) => {
  await cell(page, 10).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveClass(/is-closing/)
  await expect(dialog).toBeHidden()

  await cell(page, 10).click()
  await expect(dialog).toBeVisible()
  // Tocar el fondo (fuera de la hoja, arriba de todo).
  await page.mouse.click(10, 10)
  await expect(dialog).toBeHidden()
})

test('la persona aparece en Personas con sus números', async ({ page }) => {
  await goTo(page, 'Personas')
  const person = page.locator('.person')
  await expect(person).toContainText('Ana Pérez')
  await expect(person).toContainText('2 números · pagó $8.000')
  await person.getByRole('button', { name: '11', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Número 11' })).toBeVisible()
})
