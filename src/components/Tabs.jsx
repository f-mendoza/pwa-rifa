import { useEffect, useLayoutEffect, useRef } from 'react'

function placeIndicator(nav, indicator, animate) {
  const active = nav.querySelector('[aria-current="page"]')
  if (!active) return
  const inset = Math.min(14, active.offsetWidth / 6)
  indicator.classList.toggle('no-anim', !animate)
  indicator.style.transform = `translateX(${active.offsetLeft + inset}px) scaleX(${active.offsetWidth - inset * 2})`
  // En celulares angostos la pestaña activa puede quedar fuera de vista.
  const { scrollLeft, clientWidth } = nav
  if (active.offsetLeft < scrollLeft || active.offsetLeft + active.offsetWidth > scrollLeft + clientWidth) {
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
}

/** Pestañas de sección con un indicador que se desliza hasta la activa. */
export function Tabs({ tabs, current, onChange }) {
  const navRef = useRef(null)
  const indicatorRef = useRef(null)
  const mounted = useRef(false)

  // Al cambiar de pestaña, se desliza (la primera ubicación no se anima).
  useLayoutEffect(() => {
    placeIndicator(navRef.current, indicatorRef.current, mounted.current)
    mounted.current = true
  }, [current])

  // Las fuentes cargan después y la ventana cambia de tamaño: se reubica sin animar. Sólo se
  // mira el contenedor: la pestaña activa cambia de ancho al pasar a negrita y eso no tiene que
  // cortar el deslizamiento.
  useEffect(() => {
    const nav = navRef.current
    const place = () => placeIndicator(nav, indicatorRef.current, false)
    let width = nav.clientWidth
    const observer = new ResizeObserver(() => {
      if (nav.clientWidth === width) return
      width = nav.clientWidth
      place()
    })
    observer.observe(nav)
    let alive = true
    document.fonts?.ready.then(() => alive && place())
    return () => {
      alive = false
      observer.disconnect()
    }
  }, [])

  return (
    <nav ref={navRef} className="tabs" aria-label="Secciones">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className="tab"
          aria-current={current === t.id ? 'page' : undefined}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
      <span ref={indicatorRef} className="tab-indicator" aria-hidden="true" />
    </nav>
  )
}
