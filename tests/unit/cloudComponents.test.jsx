// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountDialog } from '../../src/components/Account.jsx'
import { MembersDialog } from '../../src/components/MembersDialog.jsx'
import { NumbersView } from '../../src/components/NumbersView.jsx'
import { RafflesDialog } from '../../src/components/RafflesDialog.jsx'
import { SyncStatus } from '../../src/components/SyncStatus.jsx'
import { db, store } from '../../src/db.js'
import { createFakeServer } from '../../src/sync/fakeServer.js'
import { setSession } from '../../src/sync/index.js'
import { createSession } from '../../src/sync/session.js'

beforeAll(() => {
  // jsdom no implementa <dialog> modal.
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open')
  }
})

let server
let session

beforeEach(async () => {
  await db.delete()
  await db.open()
  server = createFakeServer()
  server.createUser('Ana', 'ana@example.com')
  session = createSession({ store, createClient: (getToken) => server.client({ getToken }) })
  await session.ready
  setSession(session)
})

afterEach(() => {
  cleanup()
  setSession(null)
})

const signIn = () => act(() => session.login({ email: 'ana@example.com', password: 'secreto123' }))

describe('AccountDialog', () => {
  it('inicia sesión, explica el error y guarda la sesión', async () => {
    const notify = vi.fn()
    const onClose = vi.fn()
    render(<AccountDialog open mode="login" notify={notify} onClose={onClose} />)
    const dialog = screen.getByRole('dialog', { name: 'Iniciar sesión' })
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'ana@example.com')
    await userEvent.type(within(dialog).getByLabelText('Contraseña'), 'equivocada')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Iniciar sesión' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('El correo o la contraseña no son correctos.')
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.clear(within(dialog).getByLabelText('Contraseña'))
    await userEvent.type(within(dialog).getByLabelText('Contraseña'), 'secreto123')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Iniciar sesión' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(notify).toHaveBeenCalledWith('Sesión iniciada como Ana', 'success')
    expect((await db.settings.get('auth')).value.user).toMatchObject({ name: 'Ana', email: 'ana@example.com' })
  })

  it('registrarse muestra el aviso de datos personales y valida la contraseña repetida', async () => {
    render(<AccountDialog open mode="register" notify={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Crear cuenta' })
    expect(dialog).toHaveTextContent('Ley 25.326')
    await userEvent.type(within(dialog).getByLabelText(/^Tu nombre/), 'Beto')
    await userEvent.type(within(dialog).getByLabelText('Correo'), 'beto@example.com')
    await userEvent.type(within(dialog).getByLabelText(/^Contraseña/), 'secreto123')
    await userEvent.type(within(dialog).getByLabelText('Repetí la contraseña'), 'otra-cosa')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear cuenta' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.')
  })

  it('con sesión muestra la cuenta, el correo sin verificar y avisa de cambios sin enviar al cerrar sesión', async () => {
    await signIn()
    await db.outbox.add({ opId: 'x', raffleId: 'r', type: 'number.release', payload: { number: 1 }, createdAt: 1 })
    const notify = vi.fn()
    render(<AccountDialog open mode="account" notify={notify} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Tu cuenta' })
    expect(dialog).toHaveTextContent('ana@example.com')
    expect(within(dialog).getByRole('button', { name: 'Reenviar el correo' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sesión' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Hay 1 cambio sin enviar')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cerrar sesión igual' }))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Sesión cerrada', 'success'))
    expect(await db.settings.get('auth')).toBeUndefined()
  })
})

describe('RafflesDialog: crear una rifa local o en la nube', () => {
  async function open() {
    const active = (await db.settings.get('activeRaffle')).value
    const current = { raffle: { id: active }, config: { title: 'Rifa' } }
    const run = vi.fn(async (action) => {
      try {
        await action()
        return true
      } catch (err) {
        run.error = err
        return false
      }
    })
    render(<RafflesDialog open current={current} run={run} notify={vi.fn()} onClose={vi.fn()} onOpenAccount={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Mis rifas' })
    await within(dialog).findByText(/de \d+ vendidos/)
    return { dialog, run }
  }

  it('por defecto es local y funciona sin cuenta; cada rifa muestra su distintivo', async () => {
    const { dialog } = await open()
    expect(within(dialog).getByText('Local')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Nueva rifa' }))
    expect(within(dialog).getByRole('radio', { name: /^Local/ })).toBeChecked()
    await userEvent.type(within(dialog).getByLabelText('Nombre de la rifa nueva'), 'Kermesse')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear rifa' }))
    await waitFor(async () => expect(await db.raffles.count()).toBe(2))
    const created = (await db.raffles.toArray()).find((r) => r.config.title === 'Kermesse')
    expect(created.remote).toBeNull()
  })

  it('en la nube pide sesión, avisa que no se puede cambiar y de los datos personales', async () => {
    const { dialog } = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Nueva rifa' }))
    await userEvent.type(within(dialog).getByLabelText('Nombre de la rifa nueva'), 'Club')
    await userEvent.click(within(dialog).getByRole('radio', { name: /^En la nube/ }))
    expect(dialog).toHaveTextContent('No se puede cambiar después')
    expect(dialog).toHaveTextContent('Ley 25.326')
    expect(dialog).toHaveTextContent('Para crear una rifa en la nube iniciá sesión')
    expect(within(dialog).getByRole('button', { name: 'Crear rifa' })).toBeDisabled()

    await signIn()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear rifa' }))
    await waitFor(async () => expect((await db.raffles.toArray()).some((r) => r.remote)).toBe(true))
    const cloud = (await db.raffles.toArray()).find((r) => r.remote)
    expect(cloud.config.title).toBe('Club')
    expect(cloud.remote).toMatchObject({ role: 'owner', status: 'active' })
    expect(server.inspect(cloud.id)).not.toBeNull()
  })

  it('lista las rifas compartidas que no están en el teléfono y las descarga', async () => {
    const juan = server.createUser('Juan', 'juan@example.com')
    const juanToken = server.tokenFor(juan).token
    const juanApi = server.client({ getToken: () => juanToken })
    const { raffle } = await juanApi.createRaffle({ config: { title: 'De Juan' }, share: {} })
    await signIn()
    const ana = session.user
    server.addMember(raffle.id, ana, 'viewer')
    const { dialog } = await open()
    const shared = await within(dialog).findByRole('region', { name: 'Compartidas conmigo' })
    expect(shared).toHaveTextContent('De Juan')
    expect(shared).toHaveTextContent('Sólo mira')
    await userEvent.click(within(shared).getByRole('button', { name: 'Descargar De Juan' }))
    await waitFor(async () => expect(await db.raffles.get(raffle.id)).toBeTruthy())
    expect((await db.raffles.get(raffle.id)).remote).toMatchObject({ role: 'viewer', userId: ana.id })
    expect((await db.settings.get('activeRaffle')).value).toBe(raffle.id)
  })
})

describe('MembersDialog', () => {
  async function cloudRaffle(role = 'owner') {
    await signIn()
    const id = await store.createCloudRaffle({ title: 'Club' }, session.transport())
    const beto = server.createUser('Beto', 'beto@example.com')
    server.addMember(id, beto, 'seller', [[1, 10]])
    const raffle = await db.raffles.get(id)
    const data = { raffle: { id, remote: { ...raffle.remote, role } }, sync: { otherAccount: false }, config: { title: 'Club', total: 100 } }
    return { id, beto, data }
  }

  it('quien organiza ve los miembros, invita, cambia el talonario y quita', async () => {
    const { id, beto, data } = await cloudRaffle()
    const notify = vi.fn()
    render(<MembersDialog open data={data} notify={notify} onClose={vi.fn()} onLeave={vi.fn()} onLogin={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Miembros' })
    const list = await within(dialog).findByRole('list', { name: 'Personas en la rifa' })
    expect(list).toHaveTextContent('Ana (vos)')
    expect(list).toHaveTextContent('Organiza')
    expect(list).toHaveTextContent('Talonario: 1-10 (10 números)')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Crear link de invitación' }))
    const link = await within(dialog).findByRole('textbox', { name: /Link de invitación/ })
    expect(link.value).toMatch(/\/invitacion\/[0-9a-f]+$/)
    expect(within(dialog).getByRole('button', { name: 'Compartir por WhatsApp' })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Editar a Beto' }))
    const ranges = within(dialog).getByLabelText(/^Talonario/)
    await userEvent.clear(ranges)
    await userEvent.type(ranges, '1-500')
    expect(within(dialog).getByText('La rifa tiene 100 números: «1-500» se pasa.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await userEvent.clear(ranges)
    await userEvent.type(ranges, '20-30, 1-5')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Guardar' }))
    await waitFor(() => expect(list).toHaveTextContent('Talonario: 1-5, 20-30'))
    const members = await server.client({ getToken: () => session.auth.token }).listMembers(id)
    expect(members.find((m) => m.userId === beto.id).ranges).toEqual([[1, 5], [20, 30]])

    await userEvent.click(within(dialog).getByRole('button', { name: 'Editar a Beto' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Quitar de la rifa' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, quitar' }))
    await waitFor(() => expect(list).not.toHaveTextContent('Beto'))
    expect(notify).toHaveBeenCalledWith('Beto ya no está en la rifa', 'success')
  })

  it('quien no organiza ve la lista sin editar ni invitar, y puede salir', async () => {
    const { data } = await cloudRaffle('viewer')
    const onLeave = vi.fn(async () => true)
    render(<MembersDialog open data={data} notify={vi.fn()} onClose={vi.fn()} onLeave={onLeave} onLogin={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Miembros' })
    await within(dialog).findByRole('list', { name: 'Personas en la rifa' })
    expect(within(dialog).queryByRole('button', { name: /Editar a/ })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Crear link de invitación' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salir de la rifa…' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sí, salir' }))
    expect(onLeave).toHaveBeenCalled()
  })
})

describe('roles en la UI', () => {
  it('un vendedor no puede elegir números fuera de su talonario; quien sólo mira, ninguno', async () => {
    const base = {
      config: { title: 'Club', total: 12 },
      ticketByNumber: new Map(),
      peopleById: new Map(),
      available: Array.from({ length: 12 }, (_, i) => i + 1),
      takenCount: 0,
    }
    const seller = { ...base, raffle: { remote: { role: 'seller', ranges: [[1, 10]], status: 'active', userId: 1 } }, sync: { otherAccount: false } }
    const onToggle = vi.fn()
    const view = render(<NumbersView data={seller} selected={new Set()} onToggle={onToggle} onOpenTicket={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Número 11, disponible, fuera de tu talonario' })).toBeDisabled()
    expect(screen.getByText(/Tu talonario: 1-10/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Número 3, disponible' }))
    expect(onToggle).toHaveBeenCalledWith(3)
    view.unmount()

    const viewer = { ...base, raffle: { remote: { role: 'viewer', status: 'active', userId: 1 } }, sync: { otherAccount: false } }
    render(<NumbersView data={viewer} selected={new Set()} onToggle={onToggle} onOpenTicket={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Número 3, disponible' })).toBeDisabled()
    expect(screen.getByText(/Sólo podés ver esta rifa/)).toBeInTheDocument()
  })

  it('el aviso de sesión vencida lleva a iniciar sesión; una rifa borrada ofrece copia local', async () => {
    const onLogin = vi.fn()
    const sync = { status: 'active', pending: 1, conflicts: [], needsLogin: true, otherAccount: false }
    const view = render(<SyncStatus sync={sync} onDismissConflicts={vi.fn()} onLogin={onLogin} onOpenMembers={vi.fn()} onSaveCopy={vi.fn()} onRemove={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(onLogin).toHaveBeenCalled()
    view.unmount()

    const onSaveCopy = vi.fn()
    render(
      <SyncStatus
        sync={{ ...sync, needsLogin: false, status: 'deleted' }}
        onDismissConflicts={vi.fn()}
        onLogin={onLogin}
        onOpenMembers={vi.fn()}
        onSaveCopy={onSaveCopy}
        onRemove={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Miembros' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Guardar copia local' }))
    expect(onSaveCopy).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Quitar del dispositivo' })).toBeInTheDocument()
  })
})
