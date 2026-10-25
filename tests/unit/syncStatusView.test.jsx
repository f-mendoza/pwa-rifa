// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ReceiptView } from '../../src/components/Receipt.jsx'
import { SyncStatus } from '../../src/components/SyncStatus.jsx'

afterEach(cleanup)

beforeAll(() => {
  // jsdom no implementa <dialog> modal.
  HTMLDialogElement.prototype.showModal ??= function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close ??= function () {
    this.removeAttribute('open')
  }
})

const sync = (patch = {}) => ({ status: 'active', role: 'owner', pending: 0, conflicts: [], needsLogin: false, lastSyncAt: 1000, ...patch })

describe('SyncStatus', () => {
  it('explica que el conflicto todavía no se corrigió si está pendiente la reconciliación', async () => {
    const conflicts = [{ id: 1, type: 'numbers.assign', payload: { numbers: [7] }, message: 'Número ocupado', createdAt: 1000 }]
    render(<SyncStatus sync={sync({ needsReconcile: true, conflicts })} onDismissConflicts={async () => true} />)
    await userEvent.click(screen.getByRole('button', { name: /Hay conflictos/ }))
    expect(screen.getByText(/Falta actualizar los datos de este teléfono/)).toBeInTheDocument()
    expect(screen.queryByText(/se deshicieron acá/)).toBeNull()
  })

  it('en una rifa local no muestra nada', () => {
    const { container } = render(<SyncStatus sync={null} onDismissConflicts={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra el estado de la rifa en la nube', () => {
    render(<SyncStatus sync={sync({ pending: 2 })} onDismissConflicts={() => {}} />)
    expect(screen.getByRole('status')).toHaveTextContent('2 cambios sin enviar')
    expect(screen.queryByRole('button', { name: /Hay conflictos/ })).toBeNull()
  })

  it('lista los conflictos con su explicación y "Entendido" los descarta', async () => {
    const onDismiss = vi.fn(async () => true)
    const conflicts = [
      {
        id: 1,
        type: 'numbers.assign',
        payload: { numbers: [7], person: { name: 'Pedro' } },
        message: 'El número 7 ya lo había vendido Ana a Juan desde otro teléfono',
        createdAt: Date.now(),
      },
    ]
    render(<SyncStatus sync={sync({ conflicts })} onDismissConflicts={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /Hay conflictos/ }))
    expect(screen.getByText('Venta del número 7 a Pedro')).toBeInTheDocument()
    expect(screen.getByText(/ya lo había vendido Ana a Juan/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Entendido' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('ReceiptView de un comprobante en la nube sin descargar', () => {
  const remote = { name: 'pago.jpg', type: 'image/jpeg', size: 2048, thumb: 'data:image/jpeg;base64,AA==', blob: null, remote: true, hasFile: true }

  it('muestra la miniatura y que falta descargarlo, sin romperse', () => {
    render(<ReceiptView receipt={remote} label="comprobante de Ana" />)
    expect(screen.getByRole('img', { name: 'comprobante de Ana' })).toHaveAttribute('src', remote.thumb)
    expect(screen.getByText(/sin descargar/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descargar' })).toBeNull()
  })

  it('con quien lo baje, ofrece descargarlo', async () => {
    const onDownload = vi.fn(async () => {})
    render(<ReceiptView receipt={remote} label="comprobante de Ana" onDownload={onDownload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Descargar' }))
    expect(onDownload).toHaveBeenCalled()
  })
})
