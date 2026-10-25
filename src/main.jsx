import '@fontsource/big-shoulders-display/latin-800'
import '@fontsource/big-shoulders-display/latin-900'
import '@fontsource/instrument-serif/latin-400'
import '@fontsource/outfit/latin-400'
import '@fontsource/outfit/latin-500'
import '@fontsource/outfit/latin-600'
import '@fontsource/outfit/latin-700'
import '@fontsource/outfit/latin-800'
// Fuentes que se pueden elegir para la imagen (src/lib/fonts.js): sólo se descargan al usarlas.
import '@fontsource/anton/latin-400'
import '@fontsource/bebas-neue/latin-400'
import '@fontsource/fredoka/latin-700'
import '@fontsource/dm-serif-display/latin-400'
import '@fontsource/lobster/latin-400'
import '@fontsource/nunito/latin-400'
import '@fontsource/nunito/latin-600'
import '@fontsource/nunito/latin-700'
import '@fontsource/nunito/latin-800'
import '@fontsource/poppins/latin-400'
import '@fontsource/poppins/latin-600'
import '@fontsource/poppins/latin-700'
import '@fontsource/poppins/latin-800'
import '@fontsource/lora/latin-400'
import '@fontsource/lora/latin-600'
import '@fontsource/lora/latin-700'
import '@fontsource/atkinson-hyperlegible/latin-400'
import '@fontsource/atkinson-hyperlegible/latin-700'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { applyTheme, cachedTheme } from './lib/themes.js'
import { installCloud } from './sync/cloud.js'

// Antes del primer pintado: así la app no aparece un instante con otro tema mientras lee la base.
applyTheme(cachedTheme())

// La nube: la API real (VITE_API_URL) o, sólo en desarrollo, `/?nube-falsa`, un servidor en
// memoria (ver sync/dev.js; `/?nube-falsa=sin-sesion` arranca sin sesión). Las rifas locales no
// la necesitan: si no carga, la app arranca igual.
const fakeCloud = import.meta.env.DEV ? new URLSearchParams(location.search).get('nube-falsa') : null
const cloud =
  fakeCloud !== null
    ? import('./sync/dev.js').then((m) => m.installFakeCloud({ signedIn: fakeCloud !== 'sin-sesion' }))
    : installCloud()

cloud
  .catch((err) => console.error('No se pudo preparar la nube', err))
  .finally(() => {
    createRoot(document.getElementById('root')).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    )
  })
