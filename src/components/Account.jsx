import { useState } from 'react'
import { unsentChanges } from '../db.js'
import { useSession } from '../hooks/useSession.js'
import { friendlyError } from '../lib/errors.js'
import { plural } from '../lib/format.js'
import { Dialog } from './Dialog.jsx'

/** Aviso de datos personales (Ley 25.326), en lenguaje llano. */
export function CloudPrivacyNote() {
  return (
    <p className="form-note privacy-note">
      <strong>Tus datos y los de tus compradores.</strong> Las rifas en la nube se guardan en nuestro servidor, con el
      nombre, teléfono y correo de cada participante, para que las vean las personas que invites. Usá esos datos sólo para
      la rifa, contales a los participantes que quedan guardados y borrá la rifa cuando ya no la necesites (Ley 25.326 de
      Protección de Datos Personales).
    </p>
  )
}

const TITLES = {
  login: 'Iniciar sesión',
  register: 'Crear cuenta',
  forgot: 'Recuperar la contraseña',
  account: 'Tu cuenta',
}

/**
 * Hoja de la cuenta: iniciar sesión, registrarse, recuperar la contraseña o, con sesión, ver la
 * cuenta y cerrarla. `mode` es la pantalla con que abre.
 */
export function AccountDialog({ open, mode = 'login', onClose, notify }) {
  const { user } = useSession()
  const [current, setCurrent] = useState(mode)
  const [opened, setOpened] = useState({ open, mode })
  // Cada vez que se abre arranca en la pantalla pedida.
  if (opened.open !== open || opened.mode !== mode) {
    setOpened({ open, mode })
    if (open) setCurrent(mode)
  }
  const screen = user ? (current === 'login' ? 'login' : 'account') : current === 'account' ? 'login' : current

  return (
    <Dialog open={open} onClose={onClose} title={TITLES[screen]}>
      {screen === 'account' ? (
        <AccountPanel notify={notify} onLoggedOut={onClose} />
      ) : (
        <AccountForms
          key={screen}
          mode={screen}
          onModeChange={setCurrent}
          notify={notify}
          onDone={onClose}
        />
      )}
    </Dialog>
  )
}

/**
 * Formularios de la cuenta, sin hoja alrededor (también se usan dentro de la invitación).
 * `onDone(user)` se llama después de iniciar sesión o registrarse.
 */
export function AccountForms({ mode, onModeChange, onDone, notify, intro }) {
  const { session, auth } = useSession()
  const [form, setForm] = useState({ name: '', email: auth?.user?.email ?? '', password: '', passwordConfirmation: '' })
  const [error, setError] = useState(null)
  const [sent, setSent] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const go = (next) => {
    setError(null)
    setSent(null)
    onModeChange(next)
  }

  if (!session) return <p className="muted">La nube no está disponible en esta versión de la app.</p>

  async function submit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'forgot') {
        const { message } = await session.forgotPassword(form.email)
        setSent(message || 'Si hay una cuenta con ese correo, te mandamos un link para elegir una contraseña nueva.')
        return
      }
      if (mode === 'register' && form.password !== form.passwordConfirmation) {
        setError('Las contraseñas no coinciden.')
        return
      }
      const user =
        mode === 'register'
          ? await session.register(form)
          : await session.login({ email: form.email, password: form.password })
      notify?.(mode === 'register' ? `Cuenta creada. ¡Hola, ${user.name}!` : `Sesión iniciada como ${user.name}`, 'success')
      onDone?.(user)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form account-form" onSubmit={submit}>
      {intro}
      {mode === 'login' && auth?.user && (
        <p className="form-note">Tu sesión venció. Iniciá sesión de nuevo para seguir sincronizando.</p>
      )}
      {mode === 'register' && (
        <label className="field">
          <span className="field-label">Tu nombre</span>
          <input value={form.name} onChange={set('name')} required maxLength={80} autoComplete="name" data-autofocus autoFocus />
          <span className="field-hint">Lo ven las personas con las que compartas una rifa.</span>
        </label>
      )}
      <label className="field">
        <span className="field-label">Correo</span>
        <input
          type="email"
          value={form.email}
          onChange={set('email')}
          required
          maxLength={120}
          autoComplete={mode === 'register' ? 'email' : 'username'}
          inputMode="email"
          data-autofocus={mode !== 'register' || undefined}
          autoFocus={mode !== 'register'}
        />
      </label>
      {mode !== 'forgot' && (
        <label className="field">
          <span className="field-label">Contraseña</span>
          <input
            type="password"
            value={form.password}
            onChange={set('password')}
            required
            minLength={mode === 'register' ? 8 : undefined}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          />
          {mode === 'register' && <span className="field-hint">Al menos 8 caracteres.</span>}
        </label>
      )}
      {mode === 'register' && (
        <label className="field">
          <span className="field-label">Repetí la contraseña</span>
          <input
            type="password"
            value={form.passwordConfirmation}
            onChange={set('passwordConfirmation')}
            required
            autoComplete="new-password"
          />
        </label>
      )}
      {mode === 'register' && <CloudPrivacyNote />}
      {mode === 'forgot' && !sent && (
        <p className="muted">Te mandamos un correo con un link para elegir una contraseña nueva.</p>
      )}

      {error && (
        <p className="error form-error" role="alert">
          {error}
        </p>
      )}
      {sent && (
        <p className="form-note" role="status">
          {sent}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy
            ? 'Un momento…'
            : mode === 'register'
              ? 'Crear cuenta'
              : mode === 'forgot'
                ? sent
                  ? 'Mandar de nuevo'
                  : 'Mandar el link'
                : 'Iniciar sesión'}
        </button>
      </div>

      <div className="account-links">
        {mode === 'login' && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('register')}>
              No tengo cuenta: crear una
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('forgot')}>
              Olvidé mi contraseña
            </button>
          </>
        )}
        {mode !== 'login' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('login')}>
            Ya tengo cuenta: iniciar sesión
          </button>
        )}
      </div>
    </form>
  )
}

/** La cuenta con sesión iniciada: correo sin verificar (con "reenviar") y cerrar sesión. */
export function AccountPanel({ notify, onLoggedOut, compact = false }) {
  const { session, user } = useSession()
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!session || !user) return null

  async function logout(force = false) {
    if (!force) {
      const unsent = await unsentChanges()
      if (unsent > 0) {
        setConfirm(unsent)
        return
      }
    }
    setBusy(true)
    try {
      await session.logout()
      notify?.('Sesión cerrada', 'success')
      onLoggedOut?.()
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  async function resend() {
    setBusy(true)
    try {
      const { message } = await session.resendVerification()
      notify?.(message || 'Te mandamos otro correo para verificar tu cuenta.', 'success')
    } catch (err) {
      notify?.(friendlyError(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="account">
      <p className="account-who">
        <span className="avatar" aria-hidden="true">
          {(user.name || user.email || '?').trim().charAt(0).toUpperCase()}
        </span>
        <span>
          <strong>{user.name}</strong>
          <span className="muted">{user.email}</span>
        </span>
      </p>
      {!user.emailVerifiedAt && (
        <div className="notice-inline" role="note">
          <p>
            Todavía no verificaste tu correo. No hace falta para usar la nube, pero sirve para recuperar la contraseña si
            te la olvidás.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resend} disabled={busy}>
            Reenviar el correo
          </button>
        </div>
      )}
      {!compact && (
        <p className="muted">
          Las rifas locales no usan la cuenta. Las rifas en la nube se sincronizan con esta cuenta en todos tus teléfonos.
        </p>
      )}
      {confirm ? (
        <div className="confirm" role="alert">
          <p>
            Hay {plural(confirm, 'cambio sin enviar', 'cambios sin enviar')} de tus rifas en la nube. Si cerrás la sesión
            quedan guardados en este teléfono y se envían cuando vuelvas a iniciar sesión con esta cuenta.
          </p>
          <div className="form-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-danger" onClick={() => logout(true)} disabled={busy}>
              Cerrar sesión igual
            </button>
          </div>
        </div>
      ) : (
        <div className="form-actions start">
          <button type="button" className="btn btn-ghost danger-text" onClick={() => logout(false)} disabled={busy}>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Elegir una contraseña nueva desde el link del correo (`/restablecer-clave?token=…&email=…`).
 * Al terminar ofrece iniciar sesión con la contraseña nueva.
 */
export function ResetPasswordDialog({ open, token, email, onClose, notify }) {
  const { session } = useSession()
  const [form, setForm] = useState({ password: '', passwordConfirmation: '' })
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError(null)
    if (form.password !== form.passwordConfirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setBusy(true)
    try {
      const { message } = await session.resetPassword({ token, email, ...form })
      notify?.(message || 'Listo, cambiaste tu contraseña.', 'success')
      setDone(true)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={done ? 'Iniciar sesión' : 'Elegí una contraseña nueva'}>
      {!session ? (
        <p className="muted">La nube no está disponible en esta versión de la app.</p>
      ) : done ? (
        <AccountForms
          mode="login"
          onModeChange={() => {}}
          notify={notify}
          onDone={onClose}
          intro={<p className="form-note">Listo, ya podés iniciar sesión con tu contraseña nueva.</p>}
        />
      ) : !token || !email ? (
        <p className="error" role="alert">
          El link para cambiar la contraseña está incompleto. Pedí uno nuevo desde «Olvidé mi contraseña».
        </p>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="muted">
            Para la cuenta <strong>{email}</strong>. Al cambiarla se cierra la sesión en tus otros dispositivos.
          </p>
          <label className="field">
            <span className="field-label">Contraseña nueva</span>
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              required
              minLength={8}
              autoComplete="new-password"
              data-autofocus
              autoFocus
            />
            <span className="field-hint">Al menos 8 caracteres.</span>
          </label>
          <label className="field">
            <span className="field-label">Repetí la contraseña</span>
            <input type="password" value={form.passwordConfirmation} onChange={set('passwordConfirmation')} required autoComplete="new-password" />
          </label>
          {error && (
            <p className="error form-error" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Un momento…' : 'Cambiar la contraseña'}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  )
}
