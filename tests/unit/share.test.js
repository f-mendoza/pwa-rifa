// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyImage, copyText, shareImageFile } from '../../src/lib/share.js'

afterEach(() => {
  vi.unstubAllGlobals()
  delete navigator.share
  delete navigator.canShare
})

const png = () => new Blob(['png'], { type: 'image/png' })

function stubDownload() {
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
}

describe('shareImageFile', () => {
  it('usa el menú nativo cuando puede compartir archivos', async () => {
    navigator.canShare = () => true
    navigator.share = vi.fn().mockResolvedValue()
    await expect(shareImageFile(png(), 'a.png', 'txt')).resolves.toBe('shared')
    expect(navigator.share).toHaveBeenCalledWith(expect.objectContaining({ text: 'txt' }))
  })

  it('si la persona cancela no hace nada más', async () => {
    navigator.canShare = () => true
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))
    await expect(shareImageFile(png(), 'a.png', '')).resolves.toBe('cancelled')
  })

  it('si el navegador no lo permite, descarga en vez de fallar', async () => {
    const click = stubDownload()
    navigator.canShare = () => true
    navigator.share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    await expect(shareImageFile(png(), 'a.png', '')).resolves.toBe('downloaded')
    expect(click).toHaveBeenCalled()
  })

  it('sin Web Share descarga el PNG', async () => {
    const click = stubDownload()
    await expect(shareImageFile(png(), 'a.png', '')).resolves.toBe('downloaded')
    expect(click).toHaveBeenCalled()
  })
})

describe('copyText', () => {
  it('usa el portapapeles cuando existe', async () => {
    const writeText = vi.fn().mockResolvedValue()
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await copyText('1, 2, 3')
    expect(writeText).toHaveBeenCalledWith('1, 2, 3')
  })

  it('sin portapapeles (http, navegadores viejos) usa el método clásico', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => true)
    await copyText('1, 2, 3')
    expect(document.execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('si nada funciona, avisa en castellano', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
    document.execCommand = vi.fn(() => false)
    await expect(copyText('x')).rejects.toThrow('No se pudo copiar la lista')
  })
})

describe('copyImage', () => {
  it('avisa si el navegador no copia imágenes', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    await expect(copyImage(png())).rejects.toThrow('no permite copiar imágenes')
  })
})
