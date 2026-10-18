import '@fontsource/big-shoulders-display/latin-800'
import '@fontsource/big-shoulders-display/latin-900'
import '@fontsource/instrument-serif/latin-400'
import '@fontsource/outfit/latin-400'
import '@fontsource/outfit/latin-500'
import '@fontsource/outfit/latin-600'
import '@fontsource/outfit/latin-700'
import '@fontsource/outfit/latin-800'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
