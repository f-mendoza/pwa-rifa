import { expect, test } from '@playwright/test'
import { assign, cell, openApp, toast } from './helpers.js'

test.beforeEach(async ({ page }) => openApp(page))

test('elegir números muestra la barra con cantidad y precio con promo', async ({ page }) => {
  const bar = page.locator('.selection-bar')
  await expect(bar).not.toHaveClass(/is-visible/)
  await cell(page, 7).click()
  await cell(page, 8).click()
  await cell(page, 23).click()
  await expect(bar).toHaveClass(/is-visible/)
  await expect(bar).toContainText('3 números · $13.000')
  await expect(bar).toContainText('7 · 8 · 23')
  await expect(cell(page, 8)).toHaveAttribute('aria-pressed', 'true')

  // Tocar de nuevo lo deselecciona; limpiar oculta la barra.
  await cell(page, 8).click()
  await expect(bar).toContainText('2 números · $8.000')
  await bar.getByRole('button', { name: 'Limpiar selección' }).click()
  await expect(bar).not.toHaveClass(/is-visible/)
})

test('asignar números los tacha, actualiza el resumen y confirma', async ({ page }) => {
  await assign(page, [7, 8, 23], { name: 'Ana Pérez', phone: '221 555 1234' })

  await expect(toast(page)).toContainText('3 números asignados a Ana Pérez')
  await expect(cell(page, 7)).toHaveAccessibleName('Número 7, tomado por Ana Pérez')
  await expect(cell(page, 7)).toHaveClass(/is-taken/)
  // La X recién trazada se anima sólo en los números nuevos.
  await expect(page.locator('.cell.just-taken')).toHaveCount(3)

  const stats = page.getByRole('region', { name: 'Resumen' })
  await expect(stats).toContainText('297')
  await expect(stats).toContainText('$13.000')
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
  await expect(page.locator('.selection-bar')).not.toHaveClass(/is-visible/)
})

test('los datos quedan guardados al recargar', async ({ page }) => {
  await assign(page, [1, 2], { name: 'Beto' })
  await page.reload()
  await expect(cell(page, 1)).toHaveAccessibleName('Número 1, tomado por Beto')
  // Al entrar no se re-anima nada.
  await expect(page.locator('.cell.just-taken')).toHaveCount(0)
})

test('filtros y búsqueda por número o nombre', async ({ page }) => {
  await assign(page, [5], { name: 'María José' })
  await page.getByRole('radio', { name: /Tomados/ }).click()
  await expect(page.locator('.number-grid .cell')).toHaveCount(1)
  await page.getByRole('radio', { name: /Todos/ }).click()
  await page.getByPlaceholder('Número o nombre').fill('maria jose')
  await expect(page.locator('.number-grid .cell')).toHaveCount(1)
  await page.getByPlaceholder('Número o nombre').fill('nadie')
  await expect(page.getByText('Ningún número coincide con la búsqueda.')).toBeVisible()
})

test('el nombre es obligatorio y no se puede asignar dos veces con doble toque', async ({ page }) => {
  await cell(page, 3).click()
  await page.locator('.selection-bar').getByRole('button', { name: 'Asignar' }).click()
  const dialog = page.getByRole('dialog')
  const submit = dialog.getByRole('button', { name: 'Asignar' })
  await expect(submit).toBeDisabled()
  await dialog.getByPlaceholder('Ej: Ana Pérez').fill('   ')
  await expect(submit).toBeDisabled()
  await dialog.getByPlaceholder('Ej: Ana Pérez').fill('Carla')
  await submit.dblclick()
  await expect(dialog).toBeHidden()
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: 'Pagos' }).click()
  await expect(page.locator('.payment')).toHaveCount(1)
})

test('los campos limitan el largo de lo que se escribe', async ({ page }) => {
  await cell(page, 3).click()
  await page.locator('.selection-bar').getByRole('button', { name: 'Asignar' }).click()
  const name = page.getByRole('dialog').getByPlaceholder('Ej: Ana Pérez')
  await name.fill('x'.repeat(200))
  await expect(name).toHaveValue('x'.repeat(80))
})
