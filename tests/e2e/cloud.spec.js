import { expect, test } from '@playwright/test'
import { assign, cell, goTo, openRaffles, toast } from './helpers.js'

// `/?nube-falsa` (sólo en desarrollo) reemplaza la API por un servidor en memoria: ver src/sync/dev.js.
// Arranca con la sesión de «Yo»; `/?nube-falsa=sin-sesion`, sin sesión. Recargar pierde el servidor,
// así que las rutas (/invitacion/…) se abren sin recargar con `__rifaNube.openPath()`.

async function openFake(page, query = 'nube-falsa') {
  await page.goto(`/?${query}`)
  await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeVisible()
  await page.waitForFunction(() => Boolean(globalThis.__rifaNube))
}

const nube = (page, fn, arg) => page.evaluate(fn, arg)

test('el creador carga un respaldo en su rifa vacía con confirmación', async ({ page }) => {
  await openFake(page)
  const raffleId = await nube(page, () => globalThis.__rifaNube.createRaffle('Vacía'))
  await goTo(page, 'Ajustes')
  await page.getByRole('button', { name: 'Cargar respaldo en esta rifa…' }).click()
  const backup = {
    app: 'rifa', schema: 3,
    raffle: { config: { title: 'Del respaldo', total: 100, price: 5000, packSize: 0, packPrice: 0, prizes: [], drawText: '' } },
    participants: [{ id: 'ana', name: 'Ana', phone: '123' }],
    purchases: [{ id: 'venta', participantId: 'ana', seq: 4, amount: 7100, createdAt: 1000 }],
    tickets: [{ number: 5, participantId: 'ana', purchaseId: 'venta', createdAt: 1000 }],
    receipts: [],
  }
  const file = { name: 'respaldo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) }
  await page.getByLabel('Respaldo para esta rifa en la nube').setInputFiles(file)
  await expect(page.getByRole('alert')).toContainText('¿Cargar «respaldo.json»')
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('VACÍA')
  await page.getByLabel('Respaldo para esta rifa en la nube').setInputFiles(file)
  await page.getByRole('button', { name: 'Sí, cargar respaldo' }).click()
  await expect(toast(page)).toContainText('Respaldo cargado')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('DEL RESPALDO')
  await expect(page.locator('.sync-state')).toHaveText('Sincronizado')
  await expect(page.getByRole('button', { name: 'Cargar respaldo en esta rifa…' })).toHaveCount(0)
  const saved = await nube(page, (id) => globalThis.__rifaNube.server.inspect(id), raffleId)
  expect(saved.numbers.map((n) => n.number)).toEqual([5])
  await goTo(page, 'Pagos')
  await expect(page.getByRole('button', { name: /Ana #4/ })).toBeVisible()
})

test('vendedores y observadores no ven la carga de respaldo en Ajustes', async ({ page }) => {
  await openFake(page)
  for (const role of ['seller', 'viewer']) {
    await nube(page, (r) => globalThis.__rifaNube.shareWithMe(r, null, `Rifa ${r}`), role)
    const dialog = await openRaffles(page)
    await dialog.getByRole('button', { name: `Descargar Rifa ${role}` }).click()
    await goTo(page, 'Ajustes')
    await expect(page.getByRole('button', { name: 'Cargar respaldo en esta rifa…' })).toHaveCount(0)
  }
})

test('crear una rifa en la nube: elegir dónde, aviso de datos y distintivos', async ({ page }) => {
  await openFake(page)
  let dialog = await openRaffles(page)
  await expect(dialog.getByText('Cuenta: Yo')).toBeVisible()
  await dialog.getByRole('button', { name: '+ Nueva rifa' }).click()
  await expect(dialog.getByRole('radio', { name: /^Local/ })).toBeChecked()
  await dialog.getByLabel('Nombre de la rifa nueva').fill('Club Nube')
  await dialog.getByText('En la nube', { exact: true }).click()
  await expect(dialog).toContainText('No se puede cambiar después')
  await expect(dialog).toContainText('Ley 25.326')
  await dialog.getByRole('button', { name: 'Crear rifa' }).click()
  await expect(dialog).toBeHidden()
  await expect(toast(page)).toContainText('Rifa «Club Nube» creada en la nube')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('CLUB NUBE')
  await expect(page.locator('.sync-state')).toHaveText('Sincronizado')

  dialog = await openRaffles(page)
  const club = dialog.locator('.raffle-entry', { hasText: 'Club Nube' })
  await expect(club.locator('.badge.is-cloud')).toHaveText('En la nube')
  await expect(dialog.locator('.raffle-entry', { hasText: /^Rifa/ }).locator('.badge.is-local')).toHaveText('Local')
})

test('sin sesión: la nube pide cuenta; registrarse y crearla', async ({ page }) => {
  await openFake(page, 'nube-falsa=sin-sesion')
  const dialog = await openRaffles(page)
  await dialog.getByRole('button', { name: '+ Nueva rifa' }).click()
  await dialog.getByLabel('Nombre de la rifa nueva').fill('Rifa compartida')
  await dialog.getByText('En la nube', { exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Crear rifa' })).toBeDisabled()
  await dialog.locator('.raffle-new').getByRole('button', { name: 'Iniciar sesión' }).click()

  // La misma hoja cambia de título al pasar de "Iniciar sesión" a "Crear cuenta".
  const account = page.getByRole('dialog', { name: /^(Iniciar sesión|Crear cuenta)$/ })
  await account.getByRole('button', { name: 'No tengo cuenta: crear una' }).click()
  await expect(page.getByRole('dialog', { name: 'Crear cuenta' })).toContainText('Ley 25.326')
  await account.getByLabel(/^Tu nombre/).fill('Caro')
  await account.getByLabel('Correo').fill('caro@example.com')
  await account.getByLabel(/^Contraseña/).fill('secreto123')
  await account.getByLabel('Repetí la contraseña').fill('secreto123')
  await account.getByRole('button', { name: 'Crear cuenta' }).click()
  await expect(toast(page)).toContainText('Cuenta creada. ¡Hola, Caro!')
  await expect(account).toBeHidden()

  // En Ajustes aparece la cuenta, con el aviso de correo sin verificar.
  await goTo(page, 'Ajustes')
  const panel = page.getByRole('region', { name: 'Cuenta' })
  await expect(panel).toContainText('caro@example.com')
  await panel.getByRole('button', { name: 'Reenviar el correo' }).click()
  await expect(toast(page)).toContainText('Te mandamos otro correo')

  const raffles = await openRaffles(page)
  await raffles.getByRole('button', { name: '+ Nueva rifa' }).click()
  await raffles.getByLabel('Nombre de la rifa nueva').fill('Rifa compartida')
  await raffles.getByText('En la nube', { exact: true }).click()
  await raffles.getByRole('button', { name: 'Crear rifa' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RIFA COMPARTIDA')
  await expect(page.locator('.sync-state')).toHaveText('Sincronizado')
})

test('miembros: invitar con link, asignar talonario y ver quién vendió', async ({ page }) => {
  await openFake(page)
  const raffleId = await nube(page, () => globalThis.__rifaNube.createRaffle('Club'))
  await nube(page, (id) => globalThis.__rifaNube.addMember(id, 'Caro', 'seller'), raffleId)
  await assign(page, [5], { name: 'Ana' })
  await page.getByRole('button', { name: 'Miembros' }).click()
  const dialog = page.getByRole('dialog', { name: 'Miembros' })
  const list = dialog.getByRole('list', { name: 'Personas en la rifa' })
  await expect(list).toContainText('Yo (vos)')
  await expect(list).toContainText('Sin talonario')

  await dialog.getByText('Sólo mira', { exact: true }).click()
  await dialog.getByRole('button', { name: 'Crear link de invitación' }).click()
  await expect(dialog.getByRole('textbox', { name: /Link de invitación/ })).toHaveValue(/\/invitacion\/[0-9a-f]+$/)
  await expect(dialog.getByRole('button', { name: 'Copiar link' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Compartir por WhatsApp' })).toBeVisible()

  await dialog.getByRole('button', { name: 'Editar a Caro' }).click()
  await dialog.getByLabel(/^Talonario/).fill('1-50, 101-120')
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(toast(page)).toContainText('Cambios de Caro guardados')
  await expect(list).toContainText('Talonario: 1-50, 101-120 (70 números)')
  await dialog.getByRole('button', { name: 'Cerrar' }).click()

  // La venta dice quién la hizo.
  await goTo(page, 'Pagos')
  await expect(page.locator('.payment').first()).toContainText('vendió vos')
  await nube(page, (id) => globalThis.__rifaNube.sellFromOtherPhone(id, [9], 'Beto'), raffleId)
  await expect(page.locator('.payment', { hasText: 'Beto' })).toContainText('vendió Juan', { timeout: 15_000 })
})

test('invitación: aceptar como "sólo mira" abre la rifa sin acciones', async ({ page }) => {
  await openFake(page)
  const { token } = await nube(page, () => globalThis.__rifaNube.inviteFromJuan('viewer', 'Rifa de Juan'))
  await nube(page, (path) => globalThis.__rifaNube.openPath(path), `/invitacion/${token}`)
  const dialog = page.getByRole('dialog', { name: 'Invitación' })
  await expect(dialog).toContainText('Juan te invitó para ver esta rifa')
  await expect(dialog).toContainText('Vas a entrar como Yo')
  await dialog.getByRole('button', { name: 'Aceptar invitación' }).click()
  await expect(dialog).toBeHidden()
  await expect(toast(page)).toContainText('Te sumaste a «Rifa de Juan»')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('RIFA DE JUAN')
  await expect(page).toHaveURL(/\/$/)

  // Sólo lectura: no se eligen números, no hay configuración ni imagen para editar.
  await expect(cell(page, 3)).toBeDisabled()
  await expect(page.getByText('Sólo podés ver esta rifa.', { exact: false })).toBeVisible()
  await goTo(page, 'Ajustes')
  await expect(page.getByText('Sólo quien organiza la rifa puede cambiar estos datos.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Salir de la rifa…' })).toBeVisible()
  await goTo(page, 'Imagen')
  await expect(page.getByRole('radio').first()).toBeDisabled()
})

test('invitación vencida o inexistente: se explica', async ({ page }) => {
  await openFake(page)
  const { token } = await nube(page, () => globalThis.__rifaNube.inviteFromJuan('seller'))
  await nube(page, (t) => globalThis.__rifaNube.server.expireInvitation(t), token)
  await nube(page, (path) => globalThis.__rifaNube.openPath(path), `/invitacion/${token}`)
  const dialog = page.getByRole('dialog', { name: 'Invitación' })
  await expect(dialog).toContainText('Esta invitación venció')
  await dialog.getByRole('button', { name: 'Cerrar' }).click()
  await expect(page).toHaveURL(/\/$/)
  await nube(page, (path) => globalThis.__rifaNube.openPath(path), '/invitacion/no-existe')
  await expect(page.getByRole('dialog', { name: 'Invitación' })).toContainText('La invitación no existe o la rifa ya no está.')
})

test('compartidas conmigo: descargar con talonario; fuera de él no se vende', async ({ page }) => {
  await openFake(page)
  await nube(page, () => globalThis.__rifaNube.shareWithMe('seller', [[1, 10]], 'Kermesse'))
  const dialog = await openRaffles(page)
  const shared = dialog.getByRole('region', { name: 'Compartidas conmigo' })
  await expect(shared).toContainText('De Juan · Vende')
  await shared.getByRole('button', { name: 'Descargar Kermesse' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('KERMESSE')
  await expect(cell(page, 11)).toHaveAccessibleName('Número 11, disponible, fuera de tu talonario')
  await expect(cell(page, 11)).toBeDisabled()
  await assign(page, [3], { name: 'Ana' })
  await expect(page.locator('.sync-state')).toHaveText('Sincronizado', { timeout: 15_000 })
  await goTo(page, 'Ajustes')
  await expect(page.getByText('Tu talonario: 1-10.', { exact: false })).toBeVisible()
})

test('una rifa compartida que se borra ofrece guardar una copia local', async ({ page }) => {
  await openFake(page)
  const raffleId = await nube(page, () => globalThis.__rifaNube.shareWithMe('seller', null, 'Se borra'))
  const dialog = await openRaffles(page)
  await dialog.getByRole('button', { name: 'Descargar Se borra' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SE BORRA')
  await nube(page, (id) => globalThis.__rifaNube.deleteFromJuan(id), raffleId)
  await expect(page.locator('.sync-state')).toHaveText('Esta rifa se borró de la nube', { timeout: 20_000 })
  await page.locator('.sync-bar').getByRole('button', { name: 'Guardar copia local' }).click()
  await expect(toast(page)).toContainText('Copia local guardada')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('SE BORRA (COPIA)')
  await expect(page.locator('.sync-bar')).toHaveCount(0)
})

test('sesión vencida: el aviso lleva a iniciar sesión', async ({ page }) => {
  await openFake(page)
  await nube(page, () => globalThis.__rifaNube.createRaffle('Club'))
  await nube(page, () => globalThis.__rifaNube.expireSession())
  await assign(page, [2], { name: 'Ana' })
  await expect(page.locator('.sync-state')).toContainText('Iniciá sesión para sincronizar', { timeout: 15_000 })
  await page.locator('.sync-bar').getByRole('button', { name: 'Iniciar sesión' }).click()
  const account = page.getByRole('dialog', { name: 'Iniciar sesión' })
  await expect(account).toContainText('Tu sesión venció')
  await expect(account.getByLabel('Correo')).toHaveValue('yo@example.com')
  await account.getByLabel('Contraseña').fill('secreto123')
  await account.getByRole('button', { name: 'Iniciar sesión' }).click()
  await expect(page.locator('.sync-state')).toHaveText('Sincronizado', { timeout: 15_000 })
})
