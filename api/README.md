# API de Rifa (etapa 3)

API en **Laravel 13** (`php artisan --version` → `Laravel Framework 13.x`) para las rifas en la nube de la PWA: cuentas, rifas compartidas, invitaciones, comprobantes y sincronización por polling.

El contrato con el cliente está en [`../docs/sync-protocolo.md`](../docs/sync-protocolo.md) y el contexto en [`../docs/sync-etapas-2-3.md`](../docs/sync-etapas-2-3.md). Si algo de acá no coincide con el protocolo, manda el protocolo.

- PHP 8.3 o más nuevo (probado con 8.5), extensiones `pdo_sqlite` (o el driver de tu base), `intl`, `mbstring` y `fileinfo`.
- Laravel 13, Sanctum 4 (tokens Bearer, sin cookies) y Pest 5.
- SQLite en desarrollo y tests. El código usa sólo Eloquent y el Query Builder, así que funciona igual en MySQL 8 o Postgres.

## Instalación

```bash
cd api
composer install
cp .env.example .env
php artisan key:generate
touch database/database.sqlite
php artisan migrate
```

En `.env`:

| Variable | Para qué |
|---|---|
| `APP_URL` | URL pública de la API (se usa en el link firmado para verificar el correo). Por defecto `http://localhost:8000`. |
| `FRONTEND_URL` | Origen de la PWA, para los links de los correos. Por defecto `http://localhost:5173`. |
| `RECEIPTS_DISK` | Disco de `config/filesystems.php` donde se guardan los comprobantes (`local` por defecto, o `s3`). |
| `MAIL_MAILER` | `log` por defecto: los correos quedan en `storage/logs/laravel.log`. |
| `DB_CONNECTION` | `sqlite` por defecto. Para MySQL o Postgres, completá `DB_HOST`, `DB_DATABASE`, etc. |

## Correr

```bash
php artisan serve            # http://localhost:8000, la API en http://localhost:8000/api
```

La PWA en desarrollo (`npm run dev`, `http://localhost:5173`) apunta a esta URL con `VITE_API_URL=http://localhost:8000/api`. CORS está abierto para `api/*` desde cualquier origen, sin credenciales (sólo el header `Authorization: Bearer`).

## Tests

```bash
php artisan test             # o ./vendor/bin/pest
```

Usan SQLite en memoria (ver `phpunit.xml`), el disco de archivos falso y correos falsos: no hace falta configurar nada.

| Archivo | Qué cubre |
|---|---|
| `tests/Feature/AuthTest.php` | Registro, login, logout, me, recuperar y cambiar la contraseña, verificación del correo, 401 sin token, límite de intentos. |
| `tests/Feature/RafflesTest.php` | Crear (id del servidor), listar, archivar, snapshot sólo con filas vivas, borrar (410 / 403), 404, CORS. |
| `tests/Feature/OpsTest.php` | Todas las operaciones: `seq` del servidor, número tomado, idempotencia, reventa, talonarios, viewer, ventas ajenas, total por debajo de lo vendido, unificación de personas y alias, comprobantes, lotes con rechazos. |
| `tests/Feature/ChangesTest.php` | `changes`: ventana `version > since`, bajas, alias, `raffle: null`, rol y talonario, versión global. |
| `tests/Feature/MembersTest.php` | Invitaciones (crear, ver sin sesión, aceptar, vencida, con correo) y miembros (listar, rol, talonario, quitar, salir). |
| `tests/Feature/ReceiptsTest.php` | Subir, bajar y borrar archivos; límites de tamaño y tipo; permisos. |
| `tests/Unit/RaffleRulesTest.php` | Las reglas portadas de `src/db.js` (`personKey`, `cleanPerson`, `normalizeConfig`, `normalizeSharePrefs`, montos, talonarios). |

## Endpoints

Todos van con el prefijo `/api`. El detalle de cada cuerpo y respuesta está en [`docs/sync-protocolo.md`](../docs/sync-protocolo.md).

| Método y ruta | Quién |
|---|---|
| `POST /auth/register` · `POST /auth/login` | Público (con límite de intentos) |
| `POST /auth/forgot-password` · `POST /auth/reset-password` | Público (con límite de intentos) |
| `GET /auth/email/verify/{id}/{hash}` | Link firmado del correo |
| `POST /auth/logout` · `GET /auth/me` · `POST /auth/email/resend` | Con sesión |
| `GET /raffles` · `POST /raffles` | Con sesión |
| `GET /raffles/{id}/snapshot` · `GET /raffles/{id}/changes?since=V` · `POST /raffles/{id}/ops` | Miembros (los permisos de cada operación se validan una por una) |
| `PATCH /raffles/{id}/me` | Miembros (archivar personal) |
| `DELETE /raffles/{id}` | Owner |
| `GET · PUT · DELETE /raffles/{id}/sales/{saleId}/receipt` | Bajar: miembros. Subir y borrar: owner y seller |
| `GET /raffles/{id}/members` | Miembros |
| `PATCH /raffles/{id}/members/{userId}` · `POST /raffles/{id}/invitations` | Owner |
| `DELETE /raffles/{id}/members/{userId}` | Owner (a otro) o cualquiera con `me` |
| `GET /invitations/{token}` | Público |
| `POST /invitations/{token}/accept` | Con sesión |

Errores: `401` sin sesión · `403` sin acceso o rol insuficiente · `404` no existe · `410` rifa borrada · `422` validación (`{ message, errors }`) · `429` demasiados intentos. Todos los mensajes, en castellano.

## Estructura

```
app/
  Sync/
    OperationRunner.php   lote de ops: una transacción por op, rifa bloqueada, idempotencia por opId
    OperationApplier.php  un método por tipo de operación (numbers.assign, number.release, …)
    SyncContext.php       una escritura sobre una rifa: bloqueo, versión nueva por fila, head_version
    VersionCounter.php    contador global de versiones (tabla sync_counters)
    RaffleFeed.php        snapshot y changes
    RaffleRules.php       reglas portadas de src/db.js
    ReceiptFiles.php      archivos de comprobantes en el disco configurado
  Http/Controllers/       Auth/, RaffleController, SyncController, ReceiptController, MemberController, InvitationController
  Http/Requests/          validación de cada endpoint (Form Requests)
  Http/Resources/         filas en camelCase con fechas en ms
  Policies/RafflePolicy   view (miembro), sell (owner/seller), manage (owner)
  Models/                 User, Raffle, RaffleMember (raffle_user), Invitation, Person, Sale, RaffleNumber, Receipt, Operation, Alias
config/rifa.php           límites, valores por defecto y opciones de la imagen (tienen que coincidir con la PWA)
database/migrations/2026_10_25_140000_create_raffle_tables.php
lang/es/                  mensajes de validación, de cuentas y de contraseñas; lang/es.json: textos de los correos
```

### Modelo

- `raffles.id` lo genera el servidor (UUIDv7). `people.id` y `sales.id` son los UUID del cliente.
- Las filas sincronizables (`raffles`, `people`, `sales`, `numbers`, `receipts`) tienen `version`, `deleted_at` (soft delete) y `created_at` en milisegundos epoch.
- `numbers` tiene `UNIQUE(raffle_id, number)`: un número liberado conserva su fila con baja y se reactiva al revenderse.
- `people` tiene `UNIQUE(raffle_id, unique_key)`, donde `unique_key` es la `key` mientras la persona existe y `null` cuando se borra. Así la unicidad vale sólo para las personas vivas sin depender de índices parciales.
- `version` sale de `sync_counters` (una fila que se incrementa con `SELECT … FOR UPDATE` dentro de la transacción). Cada operación aplica `lockForUpdate()` sobre la fila de la rifa y después sobre el contador, siempre en ese orden.
- `raffles.version` cambia cuando cambia la fila de la rifa (`config`, `share`, `last_seq` o la baja). `raffles.head_version` es la máxima de todo lo de la rifa: es la `version` que devuelven snapshot, changes y ops, y la que el cliente guarda como `syncedVersion`.
- `operations` guarda cada operación procesada (aceptada o rechazada) con su resultado, para la idempotencia y la auditoría. `aliases` guarda los ids de personas unificadas.

## Notas de implementación

Ambigüedades del contrato y cómo se resolvieron:

1. **Mensaje de `number_taken`.** Nombra a quien vendió y a quien compró: «El número 7 ya lo había vendido Facu a Juan desde otro teléfono». Con varios números: «Los números 7 y 8 ya estaban vendidos desde otro teléfono (el 7 a Juan y el 8 a Ana)».
2. **Orden de los rechazos.** Primero `unknown_type`, después `forbidden` (viewer), igual que el servidor falso. En `numbers.assign`: `invalid` → `out_of_range` → `outside_ranges` → `number_taken`. En `number.release` y `number.transfer` primero se mira el talonario y después si el número está vendido. Liberar un número fuera del total es liberar uno libre: se acepta sin cambios.
3. **Una versión por operación.** Todas las filas que toca una operación reciben la misma versión nueva (mayor que cualquier anterior). Una operación aceptada sin efecto (por ejemplo, liberar un número libre) no consume versión. `changes` devuelve las filas con `since < version <= head_version`, leyendo primero `head_version`: lo que se confirme mientras tanto llega en el próximo pull.
4. **Fechas.** Todas las fechas de la API van en milisegundos epoch, no sólo las de las filas sincronizadas: `emailVerifiedAt`, `archivedAt` y `expiresAt` también. Si una operación no trae `createdAt` en el `payload`, se usa el `createdAt` de la operación (y si tampoco viene, la hora del servidor).
5. **Personas en `numbers.assign` / `number.transfer`:**
   - Primero se resuelve `person.id` contra los alias y después se busca por `key` entre las personas vivas.
   - Si existe con otro id, se registra el alias `person.id → id existente`, salvo que `person.id` sea otra persona viva de la rifa (ahí no se toca a nadie).
   - Si no hay nadie con esa `key` pero `person.id` existe vivo con otro nombre (lo renombraron desde otro teléfono), se usa esa persona tal cual (se completan sus datos de contacto, el nombre no se cambia).
   - Si `person.id` es una persona borrada de la misma rifa, se reactiva con los datos nuevos.
   - Si `person.id` ya existe en otra rifa, o si el `saleId` ya existe, la operación se rechaza con `invalid`.
6. **Unificación en `person.update`.** Como dice el protocolo (y hace `src/sync/fakeServer.js`), la persona que queda completa **sólo sus campos vacíos** con los datos editados; los que ya tenía no se pisan. Ojo: `updateParticipant` de `src/db.js` sí los pisa (`data.phone || clash.phone`), así que una rifa local y una en la nube pueden quedar distintas en ese caso. `result = { personId }` con el id que queda. `number.transfer` devuelve `result = { participantId }`.
7. **`receipt.set` y el archivo.** Como en el servidor falso, cada `receipt.set` es un comprobante nuevo: se descarta el archivo que hubiera (`hasFile: false`) hasta que llegue el nuevo por `PUT`. El cliente sube el archivo después del push, así que el orden siempre es `receipt.set` → `PUT`. En el `PUT`, `type` y `size` salen del archivo mismo; `name`, `thumb` y `addedAt` vienen del formulario (o se conservan los guardados). Una `thumb` que no es un `data:image/…` o pasa los 300.000 caracteres se guarda como `null`. `GET` sin archivo subido → `404`.
8. **Talonarios y roles.** Los talonarios sólo se aplican a los `seller`. Si un `PATCH` deja a alguien con otro rol, su talonario pasa a `null`. La rifa tiene un solo dueño: no se puede pasar a nadie a `owner`, ni quitarse ese rol (`422`). `sale.void` no mira el talonario, sólo quién hizo la venta.
9. **Salir y quitar miembros.** El dueño que intenta salir (con `me` o con su id) recibe `422` con un mensaje que sugiere borrar la rifa. La lista de miembros (con sus correos) la ve cualquier miembro.
10. **Invitaciones.** Son de un solo uso. Una vencida o ya usada por otra cuenta → `422`. Si se creó con `email`, sólo la acepta una cuenta con ese correo (si no, `403`). Si la rifa se borró, la invitación da `404`. El token se guarda hasheado (sha256). Quien ya es miembro siempre recibe su rol actual.
11. **Idempotencia entre rifas.** Si llega un `opId` que ya se usó en otra rifa o con otra cuenta, se rechaza con `invalid` y ese rechazo no se guarda.
12. **Orden de los errores HTTP.** El sobre del pedido (por ejemplo `since` en changes o la forma de `ops`) se valida antes de mirar el acceso a la rifa: un pedido mal armado recibe `422` aunque la rifa esté borrada o no sea miembro. Para pedidos bien armados el orden es `404` → `403` → `410`: quien no es miembro recibe `403` aunque la rifa esté borrada (así no se entera de nada). El servidor falso del cliente hoy responde `410` antes que `403`; para el cliente no cambia nada útil, porque las dos respuestas le ofrecen guardar una copia local.
13. **Borrar una rifa** es una baja lógica de la fila de la rifa: las personas, ventas, números y archivos quedan guardados, pero todos los endpoints de esa rifa responden `410` a sus miembros y `403` a los demás. `GET /raffles` deja de listarla.
14. **Configuración.** `POST /raffles` exige `config`; los campos que falten se completan con los valores por defecto de `normalizeConfig` (los de `DEFAULT_CONFIG` de la PWA). Los recortes de largo (título 40, premios 60, texto del sorteo 140) cuentan caracteres Unicode; en el cliente cuentan unidades UTF-16, así que sólo difieren con emojis u otros caracteres fuera del plano básico.
15. **Correos.** El link para cambiar la contraseña es `{FRONTEND_URL}/restablecer-clave?token=…&email=…` (la PWA tiene que tener esa ruta y llamar a `POST /auth/reset-password`). Cambiar la contraseña cierra la sesión en todos los dispositivos (revoca los tokens). El link de verificación, abierto en el navegador, redirige a `{FRONTEND_URL}/?correo=verificado`. Si se pide con `Accept: application/json`, responde `200 { message }`.
16. **Versión de Laravel.** Se usa Laravel 13 (la última estable), no la 12 que mencionaba el documento de etapas.
