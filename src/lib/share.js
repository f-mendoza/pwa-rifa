export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // iOS tarda en empezar la descarga: liberar la URL muy rápido la cancela.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/**
 * Abre el menú nativo de compartir (WhatsApp, Instagram, etc.) con la imagen.
 * Si el navegador no puede compartir archivos, o no lo permite en este momento, la descarga.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareImageFile(blob, filename, text) {
  const file = new File([blob], filename, { type: 'image/png' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
      // NotAllowedError: se perdió el gesto del usuario o hay otro share abierto. Mejor descargar
      // que dejar a la persona sin imagen.
      if (err.name !== 'NotAllowedError') throw err
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

export function canCopyImage() {
  return typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write)
}

export async function copyImage(blob) {
  if (!canCopyImage()) throw new Error('Este navegador no permite copiar imágenes')
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } catch {
    throw new Error('No se pudo copiar la imagen. Probá con "Descargar PNG".')
  }
}

/** Copia texto; si no hay API de portapapeles (http, navegadores viejos) usa el método clásico. */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Sin permiso: se intenta el método clásico.
    }
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px'
  document.body.append(area)
  area.select()
  area.setSelectionRange(0, text.length)
  const ok = document.execCommand?.('copy')
  area.remove()
  if (!ok) throw new Error('No se pudo copiar la lista en este navegador.')
}
