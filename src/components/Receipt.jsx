import { useEffect, useId, useRef, useState } from 'react'
import { formatBytes, openBlob, prepareReceipt } from '../lib/receipt.js'

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  )
}

/** Miniatura chica para listados. */
export function ReceiptThumb({ receipt, size = 'md' }) {
  if (!receipt) {
    return (
      <span className={`thumb thumb-${size} is-empty`} aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 8v8M8 12h8" />
        </svg>
      </span>
    )
  }
  if (!receipt.thumb) {
    return (
      <span className={`thumb thumb-${size} is-file`} aria-hidden="true">
        <FileIcon />
        <small>PDF</small>
      </span>
    )
  }
  return <img className={`thumb thumb-${size}`} src={receipt.thumb} alt="" />
}

/**
 * Imagen completa del comprobante guardado. La URL del blob se crea y libera
 * directamente sobre el <img> para no filtrar memoria.
 */
function BlobImage({ blob, alt }) {
  const ref = useRef(null)
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    ref.current.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return <img ref={ref} alt={alt} />
}

/**
 * Comprobante que vino de la nube sin el archivo: se ve la miniatura (si tiene) y se puede bajar
 * cuando hay quien lo baje (`onDownload`).
 */
function RemoteReceipt({ receipt, label, onDownload }) {
  const [busy, setBusy] = useState(false)
  const pending = receipt.hasFile === false
  return (
    <figure className="receipt-view is-remote">
      <div className="receipt-remote">
        {receipt.thumb ? (
          <img src={receipt.thumb} alt={label} />
        ) : (
          <span className="receipt-file">
            <FileIcon />
            {receipt.name || 'Comprobante'}
          </span>
        )}
      </div>
      <figcaption className="muted">
        {receipt.name} · {formatBytes(receipt.size ?? 0)} ·{' '}
        {pending ? 'todavía no se subió desde el otro teléfono' : 'en la nube, sin descargar'}
      </figcaption>
      {onDownload && !pending && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              await onDownload()
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Descargando…' : 'Descargar'}
        </button>
      )}
    </figure>
  )
}

export function ReceiptView({ receipt, label, onDownload }) {
  if (!receipt.blob) return <RemoteReceipt receipt={receipt} label={label} onDownload={onDownload} />
  const isImage = receipt.type.startsWith('image/')
  return (
    <figure className="receipt-view">
      <button type="button" className="receipt-open" onClick={() => openBlob(receipt.blob)} aria-label={`Abrir ${label}`}>
        {isImage ? (
          <BlobImage blob={receipt.blob} alt={label} />
        ) : (
          <span className="receipt-file">
            <FileIcon />
            {receipt.name || 'Comprobante.pdf'}
          </span>
        )}
      </button>
      <figcaption className="muted">
        {receipt.name} · {formatBytes(receipt.size ?? receipt.blob.size)} · tocá para abrir
      </figcaption>
    </figure>
  )
}

/**
 * Botón para elegir (o sacar una foto de) un comprobante. Procesa el archivo y
 * devuelve el resultado listo para guardar con `onReady`.
 */
export function ReceiptPicker({ onReady, onError, onBusy, label = 'Subir comprobante', variant = 'drop' }) {
  const [busy, setBusy] = useState(false)
  const id = useId()

  async function handleChange(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    onBusy?.(true)
    try {
      await onReady(await prepareReceipt(file))
    } catch (err) {
      onError(err.message)
    } finally {
      setBusy(false)
      onBusy?.(false)
    }
  }

  return (
    <>
      <input id={id} type="file" accept="image/*,application/pdf" className="visually-hidden" onChange={handleChange} disabled={busy} />
      <label htmlFor={id} className={variant === 'drop' ? 'receipt-drop' : 'btn btn-ghost btn-sm'} aria-busy={busy}>
        {variant === 'drop' && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 16V4M7 9l5-5 5 5M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
          </svg>
        )}
        <span>{busy ? 'Procesando…' : label}</span>
        {variant === 'drop' && !busy && <small>Foto, captura o PDF</small>}
      </label>
    </>
  )
}
