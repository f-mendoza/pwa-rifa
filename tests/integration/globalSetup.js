import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Levanta la API de `api/` para los tests de integración:
 * - base SQLite y carpeta `storage` temporales (no toca `api/database/database.sqlite` ni los
 *   comprobantes de desarrollo), con `migrate:fresh`;
 * - el servidor de PHP con el router de Laravel (lo mismo que hace `php artisan serve`, pero sin
 *   que `serve` filtre las variables de entorno que apuntan a la base temporal);
 * - correos en memoria y caché en memoria (sin límites de intentos entre pedidos).
 *
 * Con `RIFA_API_URL=http://…/api` usa una API ya levantada y no arranca nada.
 */
const API_DIR = resolve(import.meta.dirname, '../../api')

function freePort() {
  return new Promise((ok, fail) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', fail)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => ok(port))
    })
  })
}

async function waitFor(url, child, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (child.exitCode !== null) throw new Error(`El servidor de PHP terminó antes de arrancar (código ${child.exitCode})`)
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // todavía no escucha
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`La API no respondió en ${url}`)
}

export default async function setup({ provide }) {
  if (process.env.RIFA_API_URL) {
    provide('apiUrl', process.env.RIFA_API_URL.replace(/\/+$/, ''))
    return undefined
  }
  const php = spawnSync('php', ['--version'], { encoding: 'utf8' })
  if (php.error || php.status !== 0) {
    throw new Error('Los tests de integración necesitan PHP 8.3+ en el PATH (y `composer install` en api/).')
  }

  const tmp = mkdtempSync(join(tmpdir(), 'rifa-api-'))
  const storage = join(tmp, 'storage')
  for (const dir of ['app/private', 'app/public', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs']) {
    mkdirSync(join(storage, dir), { recursive: true })
  }
  const database = join(tmp, 'database.sqlite')
  writeFileSync(database, '')
  const port = await freePort()
  const env = {
    ...process.env,
    APP_ENV: 'local',
    APP_DEBUG: 'false',
    APP_URL: `http://127.0.0.1:${port}`,
    DB_CONNECTION: 'sqlite',
    DB_DATABASE: database,
    LARAVEL_STORAGE_PATH: storage,
    CACHE_STORE: 'array',
    SESSION_DRIVER: 'array',
    QUEUE_CONNECTION: 'sync',
    MAIL_MAILER: 'array',
    RECEIPTS_DISK: 'local',
    BCRYPT_ROUNDS: '4',
    LOG_CHANNEL: 'single',
  }
  // variables_order=EGPCS: así Laravel ve LARAVEL_STORAGE_PATH en $_ENV.
  const phpFlags = ['-d', 'variables_order=EGPCS']

  const migrate = spawnSync('php', [...phpFlags, 'artisan', 'migrate:fresh', '--force', '--no-interaction'], { cwd: API_DIR, env, encoding: 'utf8' })
  if (migrate.status !== 0) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error(`No se pudo migrar la base temporal:\n${migrate.stdout}\n${migrate.stderr}`)
  }

  const router = join(API_DIR, 'vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php')
  const child = spawn('php', [...phpFlags, '-S', `127.0.0.1:${port}`, '-t', join(API_DIR, 'public'), router], {
    cwd: join(API_DIR, 'public'),
    env,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000)
  })
  try {
    await waitFor(`http://127.0.0.1:${port}/up`, child)
  } catch (err) {
    child.kill()
    rmSync(tmp, { recursive: true, force: true })
    throw new Error(`${err.message}\n${stderr}`)
  }
  provide('apiUrl', `http://127.0.0.1:${port}/api`)

  return () => {
    child.kill()
    rmSync(tmp, { recursive: true, force: true })
  }
}
