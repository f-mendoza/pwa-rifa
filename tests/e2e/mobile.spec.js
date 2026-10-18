import { expect, test } from '@playwright/test'
import { assign, goTo, openApp } from './helpers.js'

const TABS = ['Números', 'Personas', 'Pagos', 'Imagen', 'Ajustes']

async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const tabs = document.querySelector('.tabs')
    const segmented = document.querySelector('.segmented')
    return {
      page: document.documentElement.scrollWidth - window.innerWidth,
      tabs: tabs.scrollWidth - tabs.clientWidth,
      filters: segmented ? segmented.scrollWidth - segmented.clientWidth : 0,
    }
  })
}

for (const width of [320, 375, 414]) {
  test(`sin scroll lateral en ninguna pestaña a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 })
    await openApp(page)
    await assign(page, [1], { name: 'María José de los Ángeles Fernández-Bustamante Gutiérrez 🎉' })
    for (const tab of TABS) {
      await goTo(page, tab)
      expect(await horizontalOverflow(page), `${tab} a ${width}px`).toEqual({ page: 0, tabs: 0, filters: 0 })
    }
  })
}

test('los controles principales tienen tamaño cómodo para el pulgar', async ({ page }) => {
  await openApp(page)
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('.tab, .search input, .topbar .btn')].map((el) => {
      const r = el.getBoundingClientRect()
      return { el: el.className || el.tagName, h: Math.round(r.height) }
    }),
  )
  for (const s of sizes) expect(s.h, s.el).toBeGreaterThanOrEqual(44)
  const segmented = await page.locator('.segmented-item').first().boundingBox()
  expect(segmented.height).toBeGreaterThanOrEqual(40)
})

test('al cambiar de pestaña desde abajo de la grilla, la sección arranca arriba', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await goTo(page, 'Ajustes')
  const top = await page.locator('.tabs').evaluate((el) => el.getBoundingClientRect().top)
  expect(top).toBeLessThanOrEqual(1)
  await expect(page.getByRole('heading', { name: 'La rifa' })).toBeInViewport()
})

test('el indicador de pestaña queda debajo de la pestaña activa', async ({ page }) => {
  await openApp(page)
  for (const tab of ['Pagos', 'Ajustes', 'Números']) {
    await goTo(page, tab)
    const active = page.locator('.tab[aria-current=page]')
    await expect(active).toHaveText(tab)
    await expect
      .poll(async () => {
        const [a, i] = await Promise.all([active.boundingBox(), page.locator('.tab-indicator').boundingBox()])
        return i.x >= a.x - 1 && i.x + i.width <= a.x + a.width + 1
      })
      .toBe(true)
  }
})

test('con "reducir movimiento" las animaciones quedan prácticamente en cero', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openApp(page)
  const duration = await page.locator('.view').evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))
  expect(duration).toBeLessThan(0.001)
  // Y las hojas igual abren y cierran.
  await assign(page, [9], { name: 'Ana' })
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('sin conexión avisa que todo sigue funcionando', async ({ page, context }) => {
  await openApp(page)
  await context.setOffline(true)
  await expect(page.getByRole('status').filter({ hasText: 'Sin conexión' })).toBeVisible()
  await assign(page, [2], { name: 'Ana' })
  await context.setOffline(false)
  await expect(page.getByText('Sin conexión')).toBeHidden()
})

test('el texto secundario cumple contraste AA', async ({ page }) => {
  await openApp(page)
  const ratio = await page.evaluate(() => {
    const parse = (c) => c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number)
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        v /= 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const fg = lum(parse(getComputedStyle(document.querySelector('.segmented .count')).color))
    const bg = lum(parse(getComputedStyle(document.querySelector('.segmented')).backgroundColor))
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})
