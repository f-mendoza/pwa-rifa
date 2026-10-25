import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { NumbersView } from './components/NumbersView.jsx'
import { ParticipantsView } from './components/ParticipantsView.jsx'
import { AssignDialog } from './components/AssignDialog.jsx'
import { Dialog } from './components/Dialog.jsx'
import { PaymentsView } from './components/PaymentsView.jsx'
import { PersonForm } from './components/PersonForm.jsx'
import { PurchaseDialog } from './components/PurchaseDialog.jsx'
import { SelectionBar } from './components/SelectionBar.jsx'
import { SettingsView } from './components/SettingsView.jsx'
import { ShareView } from './components/ShareView.jsx'
import { StatsBar } from './components/StatsBar.jsx'
import { Tabs } from './components/Tabs.jsx'
import { TicketDialog } from './components/TicketDialog.jsx'
import {
  assignNumbers,
  clearNumbers,
  exportBackup,
  importBackup,
  releaseNumber,
  removeReceipt,
  saveAppearance,
  saveConfig,
  setPurchaseAmount,
  setReceipt,
  transferNumber,
  updateParticipant,
  voidPurchase,
} from './db.js'
import { requestPersistence, useInstallPrompt, useOnline } from './hooks/usePwa.js'
import { useRaffle } from './hooks/useRaffle.js'
import { useShareImage } from './hooks/useShareImage.js'
import { friendlyError } from './lib/errors.js'
import { availableMessage, plural, todayStamp } from './lib/format.js'
import { copyImage, copyText, downloadBlob, shareImageFile } from './lib/share.js'
import { applyTheme } from './lib/themes.js'
import './App.css'

const TABS = [
  { id: 'numbers', label: 'Números' },
  { id: 'people', label: 'Personas' },
  { id: 'payments', label: 'Pagos' },
  { id: 'share', label: 'Imagen' },
  { id: 'settings', label: 'Ajustes' },
]

export default function App() {
  const data = useRaffle()
  const image = useShareImage(data)
  const install = useInstallPrompt()
  const online = useOnline()

  const [tab, setTab] = useState('numbers')
  const [selection, setSelection] = useState(() => new Set())
  const [assigning, setAssigning] = useState(false)
  const [ticketNumber, setTicketNumber] = useState(null)
  const [purchaseId, setPurchaseId] = useState(null)
  const [editingPersonId, setEditingPersonId] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  const tabsAnchor = useRef(null)

  // El tema guardado en la base manda (p. ej. al restaurar un respaldo de otro teléfono).
  const theme = data?.appearance.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  const notify = useCallback((message, tone = 'info') => {
    clearTimeout(toastTimer.current)
    // Los errores quedan más tiempo: suelen pedir que la persona haga algo.
    const duration = tone === 'error' ? 6000 : 3800
    setToast({ message, tone, id: Date.now(), leaving: false })
    toastTimer.current = setTimeout(() => {
      setToast((t) => t && { ...t, leaving: true })
      toastTimer.current = setTimeout(() => setToast(null), 180)
    }, duration)
  }, [])

  function changeTab(id) {
    setTab(id)
    // Si se venía scrolleado (p. ej. al final de la grilla), la sección nueva arranca arriba de todo.
    const anchor = tabsAnchor.current
    if (!anchor) return
    // + el margen de la barra de pestañas, para que quede pegada arriba sin asomar el resumen.
    const top = anchor.getBoundingClientRect().top + parseFloat(getComputedStyle(anchor.nextElementSibling).marginTop)
    if (top < 0) window.scrollTo({ top: window.scrollY + top })
  }

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onOfflineReady: () => notify('Lista para usar sin conexión'),
  })

  /** Ejecuta una acción sobre la base y muestra el error si falla. Devuelve true si salió bien. */
  const run = useCallback(
    async (action, success) => {
      try {
        const result = await action()
        if (success) notify(typeof success === 'function' ? success(result) : success, 'success')
        return true
      } catch (err) {
        notify(friendlyError(err), 'error')
        return false
      }
    },
    [notify],
  )

  if (!data) {
    return (
      <div className="loading" role="status">
        <span className="logo">RIFA</span>
      </div>
    )
  }

  const fileName = `rifa-disponibles-${todayStamp()}.png`
  // Si un número elegido dejó de estar libre (p. ej. al restaurar un respaldo), deja de contar.
  const selected = new Set([...selection].filter((n) => n <= data.config.total && !data.ticketByNumber.has(n)))

  const toggle = (n) =>
    setSelection((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })

  async function handleShare() {
    if (!image.ready) return
    try {
      const result = await shareImageFile(image.blob, fileName, availableMessage(data.config, data.available))
      if (result === 'downloaded') notify('Imagen descargada', 'success')
    } catch (err) {
      notify(friendlyError(err, 'No se pudo compartir. Probá con "Descargar PNG".'), 'error')
    }
  }

  const editingPerson = editingPersonId != null ? data.peopleById.get(editingPersonId) : null
  const title = (data.config.title || 'Rifa').toUpperCase()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1 className={`logo ${title.length > 12 ? 'is-long' : ''}`}>{title}</h1>
          {data.config.drawText && <p className="brand-sub">{data.config.drawText}</p>}
        </div>
        <div className="topbar-actions">
          {install && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={install}>
              Instalar app
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={handleShare} disabled={!image.ready}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 3v12M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
            </svg>
            Compartir disponibles
          </button>
        </div>
      </header>

      {(!online || needRefresh) && (
        <div className="notice" role="status">
          {needRefresh ? (
            <>
              Hay una versión nueva de la app.
              <button type="button" className="link-btn" onClick={() => updateServiceWorker(true)}>
                Actualizar
              </button>
            </>
          ) : (
            'Sin conexión: todo sigue funcionando y se guarda en este dispositivo.'
          )}
        </div>
      )}

      <StatsBar data={data} />

      <div ref={tabsAnchor} />
      <Tabs tabs={TABS} current={tab} onChange={changeTab} />

      <main className={`main ${selected.size ? 'has-selection' : ''}`}>
        <div key={tab} className="view">
        {tab === 'numbers' && (
          <NumbersView data={data} selected={selected} onToggle={toggle} onOpenTicket={setTicketNumber} />
        )}
        {tab === 'people' && (
          <ParticipantsView data={data} onOpenTicket={setTicketNumber} onEditPerson={setEditingPersonId} />
        )}
        {tab === 'payments' && <PaymentsView data={data} onOpenPurchase={setPurchaseId} />}
        {tab === 'share' && (
          <ShareView
            data={data}
            image={image}
            onShare={handleShare}
            onDownload={() => {
              downloadBlob(image.blob, fileName)
              notify('Imagen descargada', 'success')
            }}
            onCopyImage={() => run(() => copyImage(image.blob), 'Imagen copiada')}
            onCopyText={() => run(() => copyText(availableMessage(data.config, data.available)), 'Lista copiada')}
          />
        )}
        {tab === 'settings' && (
          <SettingsView
            data={data}
            onSaveConfig={(config) => run(() => saveConfig(config), 'Cambios guardados')}
            onSaveAppearance={(appearance) => run(() => saveAppearance(appearance))}
            onExport={() =>
              run(async () => {
                const backup = await exportBackup()
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
                downloadBlob(blob, `rifa-respaldo-${todayStamp()}.json`)
              }, 'Respaldo descargado')
            }
            onImport={(file) =>
              run(
                async () => {
                  let parsed
                  try {
                    parsed = JSON.parse(await file.text())
                  } catch {
                    throw new Error('El archivo no es un respaldo válido')
                  }
                  return importBackup(parsed)
                },
                (r) =>
                  `Respaldo restaurado: ${plural(r.tickets, 'número', 'números')}, ${plural(r.participants, 'persona', 'personas')}, ${plural(r.receipts, 'comprobante adjunto', 'comprobantes adjuntos')}`,
              )
            }
            onClear={() => run(clearNumbers, 'Rifa reiniciada')}
          />
        )}
        </div>
      </main>

      {tab === 'numbers' && (
        <SelectionBar
          selected={selected}
          config={data.config}
          onClear={() => setSelection(new Set())}
          onAssign={() => setAssigning(true)}
        />
      )}

      <AssignDialog
        open={assigning}
        numbers={[...selected].sort((a, b) => a - b)}
        data={data}
        onClose={() => setAssigning(false)}
        onError={(message) => notify(message, 'error')}
        onAssign={async (numbers, person, payment) => {
          const ok = await run(
            () => assignNumbers(numbers, person, payment),
            `${plural(numbers.length, 'número asignado', 'números asignados')} a ${person.name.trim()}`,
          )
          if (ok) {
            setSelection(new Set())
            setAssigning(false)
            requestPersistence()
          }
        }}
      />

      <TicketDialog
        number={ticketNumber}
        data={data}
        onClose={() => setTicketNumber(null)}
        onOpenTicket={setTicketNumber}
        onOpenPurchase={(id) => {
          setTicketNumber(null)
          setPurchaseId(id)
        }}
        onUpdatePerson={(id, form) => run(() => updateParticipant(id, form), 'Datos actualizados')}
        onTransfer={(n, form) => run(() => transferNumber(n, form), `Número ${n} pasado a ${form.name.trim()}`)}
        onRelease={(n) => run(() => releaseNumber(n), `Número ${n} liberado`)}
      />

      <PurchaseDialog
        purchaseId={purchaseId}
        data={data}
        onClose={() => setPurchaseId(null)}
        onError={(message) => notify(message, 'error')}
        onOpenTicket={(n) => {
          setPurchaseId(null)
          setTicketNumber(n)
        }}
        onSetAmount={(id, amount) => run(() => setPurchaseAmount(id, amount), 'Monto actualizado')}
        onSetReceipt={(id, receipt) => run(() => setReceipt(id, receipt), 'Comprobante guardado')}
        onRemoveReceipt={(id) => run(() => removeReceipt(id), 'Comprobante quitado')}
        onVoid={(id) => run(() => voidPurchase(id), 'Venta anulada')}
      />

      <Dialog open={Boolean(editingPerson)} onClose={() => setEditingPersonId(null)} title="Editar participante">
        {editingPerson && (
          <PersonForm
            initial={editingPerson}
            people={data.people}
            excludeId={editingPerson.id}
            submitLabel="Guardar datos"
            onCancel={() => setEditingPersonId(null)}
            onSubmit={async (form) => {
              if (await run(() => updateParticipant(editingPerson.id, form), 'Datos actualizados')) {
                setEditingPersonId(null)
              }
            }}
          >
            <p className="form-note">
              Si usás el nombre de otra persona que ya participa, se unifican sus números.
            </p>
          </PersonForm>
        )}
      </Dialog>

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            className={`toast is-${toast.tone} ${toast.leaving ? 'is-leaving' : ''}`}
            role={toast.tone === 'error' ? 'alert' : undefined}
          >
            {toast.tone === 'success' && (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {toast.tone === 'error' && (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8v5M12 16.5v.5" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            )}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </div>
  )
}
