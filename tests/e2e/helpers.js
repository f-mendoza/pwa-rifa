import { expect } from '@playwright/test'

/** Abre la app con la base vacía (cada test corre en un contexto nuevo, con su propio IndexedDB). */
export async function openApp(page) {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible()
}

export const cell = (page, n) => page.getByRole('button', { name: new RegExp(`^Número ${n},`) })

export async function goTo(page, tab) {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name: tab, exact: true }).click()
}

export function toast(page) {
  return page.locator('.toast-region')
}

/** Elige números en la grilla y los asigna a una persona desde la hoja de asignar. */
export async function assign(page, numbers, person, { amount, receipt } = {}) {
  for (const n of numbers) await cell(page, n).click()
  await page.locator('.selection-bar').getByRole('button', { name: 'Asignar' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Ej: Ana Pérez').fill(person.name)
  if (person.phone) await dialog.getByPlaceholder('221 555 1234').fill(person.phone)
  if (person.email) await dialog.getByPlaceholder('ana@mail.com').fill(person.email)
  if (person.referrer) await dialog.getByLabel('Referido').fill(person.referrer)
  if (amount != null) await dialog.getByRole('spinbutton').fill(String(amount))
  if (receipt) {
    await dialog.locator('input[type=file]').setInputFiles(receipt)
    await expect(dialog.getByText('listo para guardar')).toBeVisible()
  }
  await dialog.getByRole('button', { name: 'Asignar' }).click()
  await expect(dialog).toBeHidden()
}

/** Una imagen real del proyecto, para subir como comprobante. */
export const receiptImage = 'public/pwa-192.png'
