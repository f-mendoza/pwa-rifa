import { canvasToBlob } from './canvas.js'

const MAX_SIDE = 1600
const THUMB_SIDE = 200
const MAX_PDF_BYTES = 8 * 1024 * 1024

function scaledCanvas(bitmap, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const ctx = canvas.getContext('2d')
  // Fondo blanco: las capturas PNG con transparencia quedarían negras en JPEG.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

/**
 * Prepara un comprobante para guardarlo en IndexedDB: las fotos se achican a
 * 1600px en JPEG (una foto de 5 MB queda en ~300 KB) y se genera una miniatura.
 * Los PDF se guardan tal cual.
 */
export async function prepareReceipt(file) {
  const base = { name: file.name, addedAt: Date.now() }

  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('El PDF es muy pesado (máximo 8 MB)')
    return { ...base, blob: file, type: file.type, size: file.size, thumb: null }
  }
  if (!file.type.startsWith('image/')) {
    throw new Error('El comprobante tiene que ser una imagen o un PDF')
  }

  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('No se pudo leer la imagen. Probá con una captura en JPG o PNG.')
  }
  try {
    const compressed = await canvasToBlob(scaledCanvas(bitmap, MAX_SIDE), 'image/jpeg', 0.82, 'No se pudo procesar la imagen')
    const fits = Math.max(bitmap.width, bitmap.height) <= MAX_SIDE
    // Si el original ya era chico y liviano (p. ej. una captura), se conserva; pero sólo
    // en JPEG o PNG: HEIC, WebP o GIF podrían no verse en otro navegador al restaurar un respaldo.
    const portable = file.type === 'image/jpeg' || file.type === 'image/png'
    const blob = portable && fits && file.size <= compressed.size ? file : compressed
    const thumb = scaledCanvas(bitmap, THUMB_SIDE).toDataURL('image/jpeg', 0.7)
    return { ...base, blob, type: blob.type, size: blob.size, thumb }
  } finally {
    bitmap.close()
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Abre el archivo en otra pestaña (visor del sistema en el celular). */
export function openBlob(blob) {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
