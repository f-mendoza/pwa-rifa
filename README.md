# Rifa — gestión de números

PWA (aplicación web instalable) para organizar una rifa desde el celular, **sin internet y sin servidor**: llevás qué números están tomados, quién los compró, cuánto pagó cada uno con su comprobante, y generás una imagen lista para compartir por WhatsApp o Instagram con los números que quedan libres.

Todo se guarda en el propio teléfono. No hay cuentas, ni backend, ni datos que salgan del dispositivo salvo que vos descargues un respaldo o compartas la imagen.

> **Aplicación vibe codeada.** Este proyecto se hizo con *vibe coding*: el código lo escribió en su mayor parte una IA ([Claude Code](https://claude.com/claude-code)) a partir de indicaciones en lenguaje natural, con revisión y pruebas manuales. Funciona y se usa, pero no pasó por el proceso de diseño y revisión de un proyecto tradicional: tomalo como tal.

## Qué se puede hacer

| Pestaña | Para qué sirve |
| --- | --- |
| **Números** | Grilla con todos los números de la rifa. Tocás los libres para elegirlos y los asignás juntos a una persona (nombre obligatorio; teléfono y correo opcionales). Tocás uno tomado para ver de quién es, editar sus datos, pasarlo a otra persona o liberarlo. Se puede filtrar (todos / disponibles / tomados) y buscar por número o por nombre. |
| **Personas** | Lista de participantes con sus números, lo que pagaron y accesos directos para llamarlos o escribirles. Si a una persona le asignás números con un nombre que ya existe (aunque cambien mayúsculas, tildes o espacios), se suman a su lista. |
| **Pagos** | Un comprobante por cada asignación, con el monto y opcionalmente una foto o PDF del pago. Muestra cuáles no tienen comprobante y cuáles tienen el monto corregido a mano. Desde acá se puede anular una venta entera. |
| **Imagen** | Flyer de la rifa (título, precio, promo, premios y texto del sorteo) con los números disponibles, o con la grilla completa y los vendidos tachados. Formato historia (1080×1920) o publicación (1080×1350). Se comparte con el menú nativo del teléfono, se descarga como PNG o se copia la lista en texto. |
| **Ajustes** | Título, cantidad de números (hasta 1000), precio, promo (p. ej. "2 por $8.000"), premios y texto del sorteo. También respaldo y restauración de datos, y "empezar una rifa nueva". |

Arriba siempre se ven los totales: disponibles, tomados, participantes y lo recaudado.

## Cómo funciona

- **Base de datos local.** Todo vive en IndexedDB a través de [Dexie](https://dexie.org) (`src/db.js`). Es la única fuente de verdad: la UI lee con consultas en vivo (`useLiveQuery`) y se actualiza sola ante cualquier cambio, sin estado duplicado. Las escrituras que tocan varias tablas (asignar, liberar, pasar un número, anular una venta) van en transacciones, así nunca queda un número sin dueño ni un comprobante sin números.
- **Modelo de datos.** Sólo se guardan los números *tomados*: un número sin fila está disponible. Cada asignación crea un comprobante (`purchases`) con su monto; si el monto queda vacío o coincide con el precio calculado (aplicando la promo), se usa el calculado. Los archivos de los comprobantes van en una tabla aparte (`receipts`) para no cargar blobs en cada consulta.
- **Comprobantes.** Las fotos se achican a 1600 px en JPEG antes de guardarse (una foto de 5 MB queda en ~300 KB) y se genera una miniatura. Los PDF se guardan tal cual (máximo 8 MB).
- **Imagen para compartir.** Se dibuja en un `<canvas>` (`src/lib/shareImage.js`) y queda pre-generada: así "Compartir" abre el menú nativo al instante, dentro del gesto del usuario (Safari cancela el share si hay que esperar). Mientras se regenera tras un cambio, los botones de compartir se deshabilitan para no mandar una imagen con números ya vendidos.
- **Offline.** El service worker (vite-plugin-pwa / Workbox) precachea JS, CSS, fuentes e íconos: una vez abierta, la app funciona sin conexión y se puede instalar en la pantalla de inicio. Cuando hay una versión nueva, la app ofrece actualizarse.
- **Respaldo.** Desde Ajustes se descarga un `.json` con todo (las imágenes de los comprobantes van en base64) para guardarlo o pasarlo a otro teléfono. Desde «Mis rifas» se restaura como una rifa local nueva. El creador también puede cargarlo desde Ajustes en una rifa en la nube todavía vacía, para compartir sus datos con los miembros. La carga se valida completa; si ya hubo ventas, no se permite reemplazarlas. También acepta respaldos del formato anterior.

## Desarrollo

Requiere Node.js 20.19+ o 22.12+.

```bash
npm install
npm run dev       # servidor de desarrollo
npm run build     # build de producción con service worker (en dist/)
npm run preview   # sirve el build, para probar el modo offline y la instalación
npm run lint      # oxlint
npm test          # tests unitarios (Vitest)
npm run test:e2e  # tests E2E en celular (Playwright)
npm run test:integration  # integración real contra la API (necesita PHP, ver abajo)
```

### Tests

- **Unitarios** (`tests/unit/`, [Vitest](https://vitest.dev)): precios y textos, mensajes de error, compartir/copiar, la base de datos completa (asignar, liberar, pasar, unificar personas, montos, configuración, respaldo y restauración) sobre un IndexedDB en memoria (`fake-indexeddb`), y componentes con Testing Library. `npm run test:coverage` genera la cobertura.
- **E2E** (`tests/e2e/`, [Playwright](https://playwright.dev)): los flujos reales en dos teléfonos emulados, Android (Chromium, Pixel 7) e iPhone (WebKit, iPhone 13): vender números, ver y liberar un número, pasarlo, comprobantes con foto, corrección de montos, anular ventas, ajustes, respaldo, imagen para compartir, modo sin conexión, "reducir movimiento", contraste y que no haya scroll lateral a 320, 375 y 414 px. Levantan su propio servidor en el puerto 5199. La primera vez hay que bajar los navegadores con `npx playwright install chromium webkit`.

- **Integración** (`tests/integration/`, `npm run test:integration`): levanta la API de `api/` con PHP (base PostgreSQL aislada `rifa_integration` y `storage` temporal, `migrate:fresh`) y corre el ciclo completo con el transporte HTTP real desde Node: dos cuentas, invitación, dos teléfonos (dos bases Dexie) que venden el mismo número, push/pull, conflicto, talonario, comprobante subido y bajado, sesión vencida y rifa borrada. Necesita PHP 8.3+, `composer install` en `api/` y `docker compose up -d` desde `api/`; con `RIFA_API_URL=http://…/api` usa una API ya levantada. No forma parte de `npm test`.

Stack: React 19, Vite, Dexie, vite-plugin-pwa. Fuentes empaquetadas con Fontsource (Big Shoulders Display, Outfit e Instrument Serif), así la imagen se dibuja igual sin internet.

## Rifas en la nube

Una rifa puede ser **local** (como siempre: sólo en el teléfono, sin cuenta ni internet) o **en la nube** (se vende entre varias personas, cada una desde su teléfono, y sigue funcionando sin señal). Se elige al crearla y no se puede cambiar después; de una rifa en la nube sí se puede guardar una copia local. El contrato con la API está en [`docs/sync-protocolo.md`](docs/sync-protocolo.md).

Para probarlo en desarrollo:

```bash
# 1. La API (Laravel 13, ver api/README.md)
cd api && composer install && cp .env.example .env && php artisan key:generate
# Definí DB_PASSWORD y POSTGRES_ADMIN_PASSWORD con claves aleatorias distintas.
docker compose up -d --wait && php artisan migrate
php artisan serve                     # http://localhost:8000/api

# 2. La PWA, en otra terminal
cp .env.example .env.local            # VITE_API_URL=http://localhost:8000/api (es el valor por defecto)
npm run dev                           # http://localhost:5173
```

Los correos (verificación, cambiar la contraseña) quedan en `api/storage/logs/laravel.log`; sus links abren la PWA (`/restablecer-clave?token=…`, `/?correo=verificado`). Las invitaciones son links `/invitacion/{token}` que se comparten por WhatsApp.

Sin PHP: `npm run dev` y abrir `http://localhost:5173/?nube-falsa` usa un servidor en memoria con la misma semántica (arranca con la sesión de «Yo», `yo@example.com` / `secreto123`; `?nube-falsa=sin-sesion` arranca sin sesión). En la consola, `__rifaNube` permite simular a otra persona: `inviteFromJuan('seller')`, `shareWithMe('viewer')`, `sellFromOtherPhone(id, [7])`, `setOnline(false)`. Se pierde al recargar. Es lo que usan los E2E de `tests/e2e/cloud.spec.js`.

## Estructura

| Archivo | Qué hace |
| --- | --- |
| `src/db.js` | Esquema Dexie (con migración v1 → v2) y todas las escrituras: asignar, liberar, transferir, comprobantes, configuración, respaldo. |
| `src/hooks/useRaffle.js` | Consulta en vivo y datos derivados (disponibles, participantes, comprobantes, recaudación). |
| `src/hooks/useShareImage.js` | Mantiene el PNG para compartir actualizado ante cada cambio que lo afecte. |
| `src/hooks/usePwa.js` | Botón de instalar, estado de conexión y almacenamiento persistente. |
| `src/lib/shareImage.js` | Render del flyer en canvas. |
| `src/lib/receipt.js` | Compresión y miniatura de los comprobantes. |
| `src/lib/format.js` | Precios con promo, montos y textos. |
| `src/lib/share.js` | Compartir, descargar y copiar al portapapeles. |
| `src/lib/errors.js` | Traduce errores del navegador o de IndexedDB a mensajes claros en castellano. |
| `src/sync/` | Sincronización de las rifas en la nube: motor (`engine.js`), cuándo sincronizar (`manager.js`), transporte HTTP (`httpTransport.js`), cliente de cuentas, miembros e invitaciones (`api.js`), sesión (`session.js`) y el servidor falso (`fakeServer.js`, `dev.js`). |
| `src/lib/permissions.js` | Qué permite cada rol (organiza, vende, sólo mira) en la UI. |
| `src/lib/ranges.js` | Talonarios: leer y mostrar rangos como «1-100, 201-250». |
| `src/components/` | Vistas (Números, Personas, Pagos, Imagen, Ajustes), diálogos, pestañas y la pantalla de error (`ErrorBoundary`). |

## Datos y privacidad

Las rifas locales quedan sólo en el navegador del dispositivo donde se usa la app; las rifas en la nube también se guardan en el servidor (con los datos de contacto de los participantes), y la app lo avisa al crear una cuenta o una rifa en la nube (Ley 25.326). En las locales, si se borran los datos del sitio, o el navegador libera espacio, se pierden: por eso la app pide almacenamiento persistente y conviene descargar un respaldo de vez en cuando.

## Licencia

[GPL-3.0](LICENSE).
