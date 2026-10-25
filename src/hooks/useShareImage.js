import { useEffect, useMemo, useRef, useState } from 'react'
import { renderRaffleImage } from '../lib/shareImage.js'
import { resolveImagePalette } from '../lib/themes.js'

/**
 * Mantiene la imagen para compartir siempre pre-generada. Así el botón
 * "Compartir" llama a `navigator.share` al instante, dentro del gesto del
 * usuario (Safari cancela el share si antes se espera a renderizar).
 *
 * `ready` es false mientras la imagen no corresponde a los datos actuales
 * (se está regenerando o falló): así nunca se comparte una con números ya vendidos.
 */
export function useShareImage(data) {
  const [image, setImage] = useState({ blob: null, url: null, key: null, error: null, errorKey: null })
  const urlRef = useRef(null)

  // Firma de lo que se dibuja: la consulta en vivo crea objetos nuevos ante cualquier
  // escritura (un comprobante, un monto), pero sólo se redibuja si cambia la imagen.
  const key = useMemo(
    () =>
      data
        ? JSON.stringify({
            config: data.config,
            available: data.available,
            mode: data.share.mode,
            format: data.share.format,
            // Ya resuelta: con "Como la app", cambiar el tema de la app también redibuja.
            palette: resolveImagePalette(data.share, data.appearance.theme),
            titleFont: data.share.titleFont,
            textFont: data.share.textFont,
          })
        : null,
    [data],
  )

  useEffect(() => {
    if (!key) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const blob = await renderRaffleImage(JSON.parse(key))
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        if (urlRef.current) URL.revokeObjectURL(urlRef.current)
        urlRef.current = url
        setImage({ blob, url, key, error: null, errorKey: null })
      } catch (error) {
        if (!cancelled) setImage((prev) => ({ ...prev, error, errorKey: key }))
      }
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [key])

  useEffect(() => () => urlRef.current && URL.revokeObjectURL(urlRef.current), [])

  return {
    blob: image.blob,
    url: image.url,
    ready: Boolean(image.blob) && image.key === key,
    error: image.errorKey === key ? image.error : null,
  }
}
