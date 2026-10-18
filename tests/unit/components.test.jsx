// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Dialog } from '../../src/components/Dialog.jsx'
import { NumbersView } from '../../src/components/NumbersView.jsx'
import { PersonForm } from '../../src/components/PersonForm.jsx'
import { StatsBar } from '../../src/components/StatsBar.jsx'
import { LIMITS, personKey } from '../../src/db.js'

afterEach(cleanup)

const config = { title: 'Rifa', total: 20, price: 100, packSize: 0, packPrice: 0, prizes: [], drawText: '' }

/** Datos mínimos con la forma que devuelve useRaffle. */
function raffle(taken = {}) {
  const people = new Map()
  const ticketByNumber = new Map()
  for (const [n, name] of Object.entries(taken)) {
    const key = personKey(name)
    if (!people.has(key)) people.set(key, { id: people.size + 1, name, key, numbers: [], amount: 0 })
    people.get(key).numbers.push(Number(n))
    ticketByNumber.set(Number(n), { number: Number(n), participantId: people.get(key).id })
  }
  const list = [...people.values()]
  const available = []
  for (let n = 1; n <= config.total; n++) if (!ticketByNumber.has(n)) available.push(n)
  return {
    config,
    people: list,
    peopleById: new Map(list.map((p) => [p.id, p])),
    ticketByNumber,
    available,
    takenCount: ticketByNumber.size,
    revenue: ticketByNumber.size * 100,
    missingReceipts: 0,
  }
}

describe('NumbersView', () => {
  const setup = (data, selected = new Set()) => {
    const props = { selected, onToggle: vi.fn(), onOpenTicket: vi.fn() }
    const view = render(<NumbersView data={data} {...props} />)
    return { ...view, ...props }
  }

  it('tocar un libre lo elige y tocar uno tomado abre su detalle', async () => {
    const { onToggle, onOpenTicket } = setup(raffle({ 3: 'Ana' }))
    await userEvent.click(screen.getByRole('button', { name: 'Número 1, disponible' }))
    expect(onToggle).toHaveBeenCalledWith(1)
    await userEvent.click(screen.getByRole('button', { name: 'Número 3, tomado por Ana' }))
    expect(onOpenTicket).toHaveBeenCalledWith(3)
  })

  it('marca como elegidos los seleccionados', () => {
    setup(raffle(), new Set([2]))
    expect(screen.getByRole('button', { name: 'Número 2, disponible' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('filtra por disponibles, tomados y busca por nombre sin tildes', async () => {
    setup(raffle({ 3: 'Ana Pérez', 4: 'Beto' }))
    await userEvent.click(screen.getByRole('radio', { name: /Tomados/ }))
    expect(screen.getAllByRole('button', { name: /^Número/ })).toHaveLength(2)
    await userEvent.type(screen.getByPlaceholderText('Número o nombre'), 'perez')
    expect(screen.getAllByRole('button', { name: /^Número/ })).toHaveLength(1)
    await userEvent.clear(screen.getByPlaceholderText('Número o nombre'))
    await userEvent.type(screen.getByPlaceholderText('Número o nombre'), 'zzz')
    expect(screen.getByText('Ningún número coincide con la búsqueda.')).toBeInTheDocument()
  })

  it('anima sólo los números recién vendidos, no los que ya estaban al entrar', () => {
    const { rerender, onToggle, onOpenTicket } = setup(raffle({ 3: 'Ana' }))
    expect(document.querySelectorAll('.just-taken')).toHaveLength(0)
    rerender(
      <NumbersView data={raffle({ 3: 'Ana', 5: 'Beto', 6: 'Beto' })} selected={new Set()} onToggle={onToggle} onOpenTicket={onOpenTicket} />,
    )
    const fresh = [...document.querySelectorAll('.just-taken')]
    expect(fresh.map((el) => el.textContent)).toEqual(['5', '6'])
    // Escalonados en orden.
    expect(fresh[1].style.getPropertyValue('--i')).toBe('1')
  })
})

describe('StatsBar', () => {
  it('muestra totales y progreso, y anima sólo los valores que cambian', () => {
    const { rerender } = render(<StatsBar data={raffle({ 1: 'Ana' })} />)
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '5% vendido')
    expect(document.querySelectorAll('.tick.is-changed')).toHaveLength(0)
    rerender(<StatsBar data={raffle({ 1: 'Ana', 2: 'Ana' })} />)
    // Cambian disponibles, tomados y recaudado; participantes sigue igual.
    expect(document.querySelectorAll('.tick.is-changed')).toHaveLength(3)
    expect(screen.getByText('10% vendido · 2 de 20')).toBeInTheDocument()
  })
})

describe('PersonForm', () => {
  it('limita largos, avisa coincidencias y evita doble envío', async () => {
    let resolve
    const onSubmit = vi.fn(() => new Promise((r) => (resolve = r)))
    const people = [{ id: 1, name: 'Ana Pérez', key: personKey('Ana Pérez'), numbers: [1, 2] }]
    render(<PersonForm people={people} submitLabel="Asignar" onSubmit={onSubmit} />)

    const name = screen.getByPlaceholderText('Ej: Ana Pérez')
    expect(name).toHaveAttribute('maxLength', String(LIMITS.name))
    expect(screen.getByRole('button', { name: 'Asignar' })).toBeDisabled()

    await userEvent.type(name, 'ana perez')
    expect(screen.getByText(/ya tiene 2 números/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Asignar' }))
    expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Guardando…' }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    await act(async () => resolve())
    expect(screen.getByRole('button', { name: 'Asignar' })).toBeEnabled()
  })
})

describe('Dialog', () => {
  // jsdom no implementa <dialog> modal; el comportamiento real lo cubren los tests E2E.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function () {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function () {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    }
  })

  it('al cerrar mantiene el contenido mientras anima la salida y después cierra', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { rerender } = render(
      <Dialog open title="Número 7" onClose={onClose}>
        <p>Ana Pérez</p>
      </Dialog>,
    )
    const dialog = document.querySelector('dialog')
    expect(dialog.open).toBe(true)

    // El padre cierra y vacía el contenido en el mismo render.
    rerender(<Dialog open={false} title="Número " onClose={onClose} />)
    expect(dialog).toHaveClass('is-closing')
    expect(screen.getByText('Ana Pérez')).toBeInTheDocument()
    expect(screen.getByRole('heading', { hidden: true })).toHaveTextContent('Número 7')

    act(() => vi.advanceTimersByTime(400))
    expect(dialog.open).toBe(false)
    expect(dialog).not.toHaveClass('is-closing')
    vi.useRealTimers()
  })

  it('Escape pide cerrar al padre en vez de cerrar de golpe', () => {
    const onClose = vi.fn()
    render(
      <Dialog open title="Hola" onClose={onClose}>
        <p>x</p>
      </Dialog>,
    )
    const dialog = document.querySelector('dialog')
    const cancel = new Event('cancel', { cancelable: true })
    fireEvent(dialog, cancel)
    expect(cancel.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
