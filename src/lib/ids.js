let lastMs = -1
let counter = 0

/**
 * Id nuevo, generado en el dispositivo: un UUIDv7 (los primeros 48 bits son la hora en
 * milisegundos y el resto es azar). Así dos teléfonos no chocan nunca, y cuando se sincronice
 * con un servidor los ids sirven tal cual como clave primaria y se ordenan por fecha.
 *
 * Dentro de un mismo milisegundo los ids siguen creciendo (RFC 9562, §6.2, método 1): los 12
 * bits que siguen a la hora son un contador que arranca al azar en cada milisegundo nuevo. Así,
 * ordenar por id desempata de forma determinista lo que se creó en el mismo milisegundo.
 */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let ms = Date.now()
  if (ms > lastMs) {
    lastMs = ms
    // La mitad de abajo del rango, para dejar lugar a muchos ids en el mismo milisegundo.
    counter = ((bytes[6] & 0x07) << 8) | bytes[7]
  } else {
    // Mismo milisegundo (o el reloj volvió atrás): se sigue con el anterior y se suma uno.
    ms = lastMs
    counter += 1
    if (counter > 0xfff) {
      // Se agotó el contador: se toma prestado el milisegundo siguiente.
      lastMs += 1
      ms = lastMs
      counter = 0
    }
  }
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff
  bytes[6] = 0x70 | (counter >> 8) // versión 7 + los 4 bits altos del contador
  bytes[7] = counter & 0xff
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variante RFC 9562
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
