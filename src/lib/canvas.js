/** `canvas.toBlob` como promesa; rechaza si el navegador no pudo generar el archivo. */
export function canvasToBlob(canvas, type, quality, errorMessage = 'No se pudo generar la imagen') {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(errorMessage))), type, quality)
  })
}
