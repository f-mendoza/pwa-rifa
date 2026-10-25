import { useRef, useState } from 'react'
import {
  archiveRaffle,
  assignNumbers,
  deleteRaffle,
  dismissConflicts,
  exportBackup,
  releaseNumber,
  removeRaffleLocally,
  removeReceipt,
  saveLocalCopy,
  saveAppearance,
  saveConfig,
  setPurchaseAmount,
  setReceipt,
  transferNumber,
  updateParticipant,
  voidPurchase,
} from '../db.js'
import { requestPersistence } from '../hooks/usePwa.js'
import { useShareImage } from '../hooks/useShareImage.js'
import { friendlyError } from '../lib/errors.js'
import { availableMessage, exportFileName, plural } from '../lib/format.js'
import { deleteKind, permissionsFor } from '../lib/permissions.js'
import { copyImage, copyText, downloadBlob, shareImageFile } from '../lib/share.js'
import { currentTransport, deleteCloudRaffle, fetchReceiptFile } from '../sync/index.js'
import { AssignDialog } from './AssignDialog.jsx'
import { Dialog } from './Dialog.jsx'
import { MembersDialog } from './MembersDialog.jsx'
import { NumbersView } from './NumbersView.jsx'
import { ParticipantsView } from './ParticipantsView.jsx'
import { PaymentsView } from './PaymentsView.jsx'
import { PersonForm } from './PersonForm.jsx'
import { PurchaseDialog } from './PurchaseDialog.jsx'
import { SelectionBar } from './SelectionBar.jsx'
import { SettingsView } from './SettingsView.jsx'
import { ShareView } from './ShareView.jsx'
import { StatsBar } from './StatsBar.jsx'
import { SyncStatus } from './SyncStatus.jsx'
import { Tabs } from './Tabs.jsx'
import { TicketDialog } from './TicketDialog.jsx'

const TABS = [
  { id: 'numbers', label: 'Números' },
  { id: 'people', label: 'Personas' },
  { id: 'payments', label: 'Pagos' },
  { id: 'share', label: 'Imagen' },
  { id: 'settings', label: 'Ajustes' },
]

/**
 * La rifa abierta. Se monta con `key` = id de la rifa: al cambiar de rifa empieza de cero
 * (pestaña, selección, diálogos abiertos e imagen).
 */
export function RaffleScreen({ data, install, notice, notify, run, onOpenRaffles, onOpenAccount }) {
  const image = useShareImage(data)
  const raffleId = data.raffle.id
  const perms = permissionsFor(data)
  const [membersOpen, setMembersOpen] = useState(false)

  const [tab, setTab] = useState('numbers')
  const [selection, setSelection] = useState(() => new Set())
  const [assigning, setAssigning] = useState(false)
  const [ticketNumber, setTicketNumber] = useState(null)
  const [purchaseId, setPurchaseId] = useState(null)
  const [editingPersonId, setEditingPersonId] = useState(null)
  const tabsAnchor = useRef(null)

  function changeTab(id) {
    setTab(id)
    // Si se venía scrolleado (p. ej. al final de la grilla), la sección nueva arranca arriba de todo.
    const anchor = tabsAnchor.current
    if (!anchor) return
    // + el margen de la barra de pestañas, para que quede pegada arriba sin asomar el resumen.
    const top = anchor.getBoundingClientRect().top + parseFloat(getComputedStyle(anchor.nextElementSibling).marginTop)
    if (top < 0) window.scrollTo({ top: window.scrollY + top })
  }

  const fileName = exportFileName('disponibles', data.config.title, 'png')
  // Si un número elegido dejó de estar libre (p. ej. lo vendió otra pestaña), deja de contar.
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
  const raffleName = data.config.title || 'Rifa'

  /** Copia local de una rifa en la nube (ids nuevos, independiente): queda abierta. */
  const saveCopy = () =>
    run(
      () => saveLocalCopy(raffleId, { title: `${raffleName} (copia)` }),
      (r) =>
        r.missingFiles
          ? `Copia local guardada (${plural(r.missingFiles, 'comprobante quedó', 'comprobantes quedaron')} afuera porque nunca se descargaron)`
          : 'Copia local guardada',
    )

  function deleteThis() {
    const kind = deleteKind(perms)
    if (kind === 'delete') return run(() => deleteRaffle(raffleId), `Rifa «${raffleName}» borrada`)
    if (kind === 'remove') return run(() => removeRaffleLocally(raffleId), `Rifa «${raffleName}» quitada del dispositivo`)
    // En la nube se borra (o se sale de ella) en el servidor antes de quitarla de acá.
    return run(
      () => deleteCloudRaffle(raffleId, currentTransport()),
      kind === 'leave' ? `Saliste de «${raffleName}»` : `Rifa «${raffleName}» borrada`,
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1 className={`logo ${title.length > 12 ? 'is-long' : ''}`}>
            <button
              type="button"
              className="logo-switch"
              onClick={onOpenRaffles}
              aria-haspopup="dialog"
              aria-label={`${title}. Cambiar de rifa`}
            >
              {title}
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 9.5l6 6 6-6" />
              </svg>
            </button>
          </h1>
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

      {notice}

      <SyncStatus
        sync={data.sync}
        onDismissConflicts={() => run(() => dismissConflicts(raffleId))}
        onLogin={() => onOpenAccount('login')}
        onOpenMembers={() => setMembersOpen(true)}
        onSaveCopy={saveCopy}
        onRemove={() => run(() => removeRaffleLocally(raffleId), `Rifa «${raffleName}» quitada del dispositivo`)}
      />

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
            notify={notify}
            onSaveCopy={saveCopy}
            onOpenMembers={() => setMembersOpen(true)}
            onOpenAccount={onOpenAccount}
            onSaveConfig={(config) => run(() => saveConfig(raffleId, config), 'Cambios guardados')}
            onSaveAppearance={(appearance) => run(() => saveAppearance(appearance))}
            onExport={() =>
              run(async () => {
                const backup = await exportBackup(raffleId)
                const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
                downloadBlob(blob, exportFileName('respaldo', data.config.title, 'json'))
              }, 'Respaldo descargado')
            }
            onArchive={(archived) =>
              run(
                () => archiveRaffle(raffleId, archived),
                archived ? `Rifa «${raffleName}» archivada` : `Rifa «${raffleName}» desarchivada`,
              )
            }
            onDelete={deleteThis}
          />
        )}
        </div>
      </main>

      {tab === 'numbers' && perms.sell && (
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
            () => assignNumbers(raffleId, numbers, person, payment),
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
        onTransfer={(n, form) =>
          run(() => transferNumber(raffleId, n, form), `Número ${n} pasado a ${form.name.trim()}`)
        }
        onRelease={(n) => run(() => releaseNumber(raffleId, n), `Número ${n} liberado`)}
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
        onDownloadReceipt={
          data.sync && currentTransport()
            ? (id) => run(() => fetchReceiptFile(raffleId, id, currentTransport()), 'Comprobante descargado')
            : undefined
        }
        onVoid={(id) => run(() => voidPurchase(id), 'Venta anulada')}
      />

      <MembersDialog
        open={membersOpen}
        data={data}
        notify={notify}
        onClose={() => setMembersOpen(false)}
        onLogin={() => {
          setMembersOpen(false)
          onOpenAccount('login')
        }}
        onLeave={() => run(() => deleteCloudRaffle(raffleId, currentTransport()), `Saliste de «${raffleName}»`)}
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
    </div>
  )
}
