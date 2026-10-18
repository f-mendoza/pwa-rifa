export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Abre el menú nativo de compartir (WhatsApp, Instagram, etc.) con la imagen.
 * Si el navegador no puede compartir archivos, la descarga.
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
      throw err
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

export function canCopyImage() {
  return typeof ClipboardItem !== 'undefined' && Boolean(navigator.clipboard?.write)
}

export async function copyImage(blob) {
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text)
}
