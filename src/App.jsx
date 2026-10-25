import { useCallback, useEffect, useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { AccountDialog, ResetPasswordDialog } from './components/Account.jsx'
import { InvitationDialog } from './components/InvitationDialog.jsx'
import { RaffleScreen } from './components/RaffleScreen.jsx'
import { RafflesDialog } from './components/RafflesDialog.jsx'
import { ensureRaffle } from './db.js'
import { useInstallPrompt, useOnline } from './hooks/usePwa.js'
import { useRaffle } from './hooks/useRaffle.js'
import { goHome, useRoute } from './hooks/useRoute.js'
import { friendlyError } from './lib/errors.js'
import { applyTheme } from './lib/themes.js'
import { createSyncManager, currentSession, currentTransport } from './sync/index.js'
import './App.css'

/** Lo que no depende de qué rifa está abierta: tema, avisos, actualizaciones y la lista de rifas. */
export default function App() {
  const data = useRaffle()
  const install = useInstallPrompt()
  const online = useOnline()

  const route = useRoute()
  const [rafflesOpen, setRafflesOpen] = useState(false)
  const [account, setAccount] = useState({ open: false, mode: 'login' })
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  // El tema guardado en la base manda (p. ej. si se cambió en otra pestaña).
  const theme = data?.appearance.theme
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  // Sincronización de las rifas en la nube: sin rifas en la nube (o sin sesión) no hace nada de red.
  // Al iniciar o cerrar sesión (también desde otra pestaña) sincroniza en el momento.
  useEffect(() => {
    const session = currentSession()
    const manager = createSyncManager({ getTransport: currentTransport, getUserId: () => session?.user?.id ?? null })
    manager.start()
    const unsubscribe = session?.subscribe(() => manager.syncNow())
    return () => {
      unsubscribe?.()
      manager.stop()
    }
  }, [])

  // La base siempre deja una rifa; si por algo no hay ninguna, se crea en vez de quedar cargando.
  useEffect(() => {
    if (data === null) ensureRaffle()
  }, [data])

  const notify = useCallback((message, tone = 'info') => {
    clearTimeout(toastTimer.current)
    // Los errores quedan más tiempo: suelen pedir que la persona haga algo.
    const duration = tone === 'error' ? 6000 : 3800
    setToast({ message, tone, id: Date.now(), leaving: false })
    toastTimer.current = setTimeout(() => {
      setToast((t) => t && { ...t, leaving: true })
      toastTimer.current = setTimeout(() => setToast(null), 180)
    }, duration)
  }, [])

  // Volvió del link del correo para verificar la cuenta.
  useEffect(() => {
    if (route.name !== 'email-verified') return
    goHome()
    Promise.resolve(currentSession()?.refreshUser())
      .catch(() => {})
      .then(() => notify('Listo, tu correo quedó verificado', 'success'))
  }, [route.name, notify])

  const openAccount = useCallback((mode = 'login') => setAccount({ open: true, mode }), [])

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onOfflineReady: () => notify('Lista para usar sin conexión'),
  })

  /** Ejecuta una acción sobre la base y muestra el error si falla. Devuelve true si salió bien. */
  const run = useCallback(
    async (action, success) => {
      try {
        const result = await action()
        if (success) notify(typeof success === 'function' ? success(result) : success, 'success')
        return true
      } catch (err) {
        notify(friendlyError(err), 'error')
        return false
      }
    },
    [notify],
  )

  if (!data) {
    return (
      <div className="loading" role="status">
        <span className="logo">RIFA</span>
      </div>
    )
  }

  const notice = (!online || needRefresh) && (
    <div className="notice" role="status">
      {needRefresh ? (
        <>
          Hay una versión nueva de la app.
          <button type="button" className="link-btn" onClick={() => updateServiceWorker(true)}>
            Actualizar
          </button>
        </>
      ) : (
        'Sin conexión: todo sigue funcionando y se guarda en este dispositivo.'
      )}
    </div>
  )

  return (
    <>
      <RaffleScreen
        key={data.raffle.id}
        data={data}
        install={install}
        notice={notice}
        notify={notify}
        run={run}
        onOpenRaffles={() => setRafflesOpen(true)}
        onOpenAccount={openAccount}
      />

      <RafflesDialog
        open={rafflesOpen}
        current={data}
        run={run}
        notify={notify}
        onClose={() => setRafflesOpen(false)}
        onOpenAccount={(mode) => {
          setRafflesOpen(false)
          openAccount(mode)
        }}
      />

      <AccountDialog
        open={account.open}
        mode={account.mode}
        notify={notify}
        onClose={() => setAccount((a) => ({ ...a, open: false }))}
      />

      <InvitationDialog token={route.name === 'invitation' ? route.token : null} notify={notify} onClose={goHome} />

      <ResetPasswordDialog
        key={route.name === 'reset-password' ? route.token : 'none'}
        open={route.name === 'reset-password'}
        token={route.token}
        email={route.email}
        notify={notify}
        onClose={goHome}
      />

      <div className="toast-region" aria-live="polite">
        {toast && (
          <div
            key={toast.id}
            className={`toast is-${toast.tone} ${toast.leaving ? 'is-leaving' : ''}`}
            role={toast.tone === 'error' ? 'alert' : undefined}
          >
            {toast.tone === 'success' && (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            )}
            {toast.tone === 'error' && (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 8v5M12 16.5v.5" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            )}
            <span>{toast.message}</span>
          </div>
        )}
      </div>
    </>
  )
}
