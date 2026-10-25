# Protocolo de sincronización (contrato cliente ↔ API)

Contrato **único** entre la PWA (`src/`) y la API Laravel (`api/`). Complementa a `docs/sync-etapas-2-3.md`; donde los dos documentos difieren, **manda este**. El servidor falso de los tests del cliente (`src/sync/fakeServer.js`) implementa exactamente esta misma semántica.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Tipos de rifa | **Local** (`remote: null`) o **en la nube** (`remote: {...}`). Se elige al crearla y **no se puede convertir**: no existe "Subir a la nube". Restaurar un respaldo siempre crea una rifa local. Sí se permite guardar una *copia local* de una rifa en la nube (ids nuevos, rifa independiente). |
| Id de la rifa | Local: UUIDv7 generado en el cliente (`newId()`). En la nube: lo genera **la API** (`HasUuids` de Laravel 13, v7) en `POST /raffles`. Crear una rifa en la nube requiere sesión y conexión. |
| Ids de personas y ventas | Siempre UUIDv7 del cliente (hacen falta para trabajar offline). El servidor los acepta como clave primaria. |
| `seq` (nº de comprobante) | Lo asigna **siempre el servidor**. El del cliente es provisorio hasta que el pull trae el definitivo; la UI lo marca como provisorio mientras la venta tenga operaciones pendientes. |
| Talonarios | **Opcionales**: `raffle_user.ranges` (`null` = sin restricción, o `[[1,100],[201,250]]`). |
| Archivar | **Personal y por dispositivo**: `archivedAt` local, no genera operación. El servidor guarda `raffle_user.archived_at` y lo expone, pero el cliente no está obligado a sincronizarlo. |
| Borrar una rifa en la nube | **No es una operación del outbox**: es una llamada directa con conexión. Dueño → `DELETE /raffles/{id}`. Otro rol → "Salir de la rifa" (`DELETE /raffles/{id}/members/me`). Después se borra localmente con su outbox. |
| Verificación de correo | Se envía, pero **no** es obligatoria para usar la nube. |
| Base de datos | SQLite en desarrollo y tests; el código no usa nada específico de un motor (debe funcionar en MySQL 8 / Postgres). |

## Convenciones

- Base URL: `{API}/api` (por defecto `http://localhost:8000/api`, en el cliente `import.meta.env.VITE_API_URL`).
- Autenticación: `Authorization: Bearer <token de Sanctum>`. Sin cookies.
- JSON en **camelCase** en todos los cuerpos de sync (filas, operaciones, respuestas).
- Fechas de datos sincronizados (`createdAt`, `addedAt`): **milisegundos epoch (entero)**, igual que `Date.now()` en el cliente.
- `version`: entero global y creciente (una secuencia/contador global del servidor), se actualiza en **cada** cambio de cualquier fila sincronizable.
- Errores HTTP: `401` sin sesión o token inválido · `403` sin acceso a la rifa o rol insuficiente para un endpoint · `404` rifa inexistente · `410` rifa borrada · `422` validación (`{ message, errors }`, mensajes en castellano) · `5xx`.
- Todos los mensajes para personas, en castellano rioplatense.

## Formas de las filas (las mismas en snapshot y changes)

```jsonc
// raffle
{ "id": "uuid", "config": {…}, "share": {…}, "lastSeq": 12, "createdAt": 1729850000000, "ownerId": 1, "deleted": false }
// people
{ "id": "uuid", "name": "Ana", "key": "ana", "phone": "", "email": "", "referrer": "", "createdAt": 0, "deleted": false }
// sales
{ "id": "uuid", "seq": 12, "participantId": "uuid", "amount": null, "createdAt": 0, "createdBy": { "id": 1, "name": "Facu" }, "deleted": false }
// numbers  (se identifican por (raffle, number); en el cliente el id es `${raffleId}:${number}` y saleId ↔ purchaseId)
{ "number": 7, "participantId": "uuid", "saleId": "uuid", "createdAt": 0, "createdBy": { "id": 1, "name": "Facu" }, "deleted": false }
// receipts (sólo metadata; el archivo se baja aparte)
{ "saleId": "uuid", "name": "pago.jpg", "type": "image/jpeg", "size": 12345, "thumb": "data:image/…", "addedAt": 0, "hasFile": true, "deleted": false }
```

`config` y `share` tienen las formas de `normalizeConfig` y `normalizeSharePrefs` de `src/db.js`. El servidor valida `config` con las mismas reglas (total entre 1 y 1000, precios enteros ≥ 0, títulos y premios recortados).

`key` de una persona = nombre limpio (`trim`, espacios colapsados), sin diacríticos (NFD + quitar marcas), en minúsculas. El servidor la calcula igual que `personKey` del cliente.

## Endpoints

### Cuentas

```
POST /auth/register          { name, email, password, passwordConfirmation, deviceName? } → 201 { token, user }
POST /auth/login             { email, password, deviceName? }                              → 200 { token, user } | 422
POST /auth/logout            (revoca el token actual)                                       → 204
GET  /auth/me                                                                              → { user }
POST /auth/forgot-password   { email }                                                     → 200 { message }   (siempre 200)
POST /auth/reset-password    { token, email, password, passwordConfirmation }              → 200 { message } | 422
POST /auth/email/resend                                                                    → 200
GET  /auth/email/verify/{id}/{hash}   (link firmado del correo)                            → 200 / redirección
```
`user = { id, name, email, emailVerifiedAt }`.

### Rifas

```
GET    /raffles                    → [{ id, title, role, archivedAt, ownerName, version, deleted:false }]   rifas a las que tiene acceso
POST   /raffles  { config, share } → 201 snapshot   (el servidor genera el id; si viene "id" en el cuerpo, se ignora)
GET    /raffles/{id}/snapshot      → snapshot
GET    /raffles/{id}/changes?since=V → changes
POST   /raffles/{id}/ops  { ops: [ { opId, type, payload, createdAt } ] }   (hasta 100 por lote)
       → { results: [ { opId, status: "accepted"|"rejected", reason?, message?, result? } ], version }
DELETE /raffles/{id}               (sólo owner; soft delete) → 204
PATCH  /raffles/{id}/me  { archived: bool } → 204    (archivar personal, opcional para el cliente)
```

**snapshot** = `{ raffle, people, sales, numbers, receipts, role, ranges, version }` — sólo filas vivas.

**changes** = `{ raffle|null, people, sales, numbers, receipts, aliases, role, ranges, version }` — filas con `version > since`, **incluidas las bajas** (`deleted: true`). `raffle` es `null` si no cambió. `version` es la versión actual máxima de la rifa (el cliente la guarda como `syncedVersion`). `aliases = [{ entity: "person", from: "uuid", to: "uuid" }]` con los ids unificados después de `since`.

### Comprobantes

```
PUT    /raffles/{id}/sales/{saleId}/receipt   multipart: file (+ name, thumb, addedAt) → 200 fila receipt   (máx. 10 MB, imagen o PDF)
       (PHP no lee cuerpos multipart en PUT: el cliente manda POST con el campo `_method=PUT`, que Laravel enruta a esta misma ruta)
GET    /raffles/{id}/sales/{saleId}/receipt   → el archivo (con su Content-Type), con el mismo Bearer
DELETE /raffles/{id}/sales/{saleId}/receipt   → 204
```

### Miembros e invitaciones

```
GET    /raffles/{id}/members                     → [{ userId, name, email, role, ranges }]
PATCH  /raffles/{id}/members/{userId}  { role?, ranges? }   (sólo owner; no puede quitarse el rol de owner a sí mismo)
DELETE /raffles/{id}/members/{userId}            (owner quita a otro; cualquiera puede usar "me" para salir; el owner no puede salir)
POST   /raffles/{id}/invitations  { role: "seller"|"viewer", email? } → 201 { token, role, expiresAt }   (sólo owner; vence a los 7 días)
GET    /invitations/{token}                      → { raffleId, raffleTitle, role, invitedBy, expired, accepted }   (público)
POST   /invitations/{token}/accept               → { raffleId, role }   (requiere sesión; si ya es miembro, devuelve su rol actual)
```

El link que comparte la PWA es `{origen de la PWA}/invitacion/{token}`.

## Operaciones (`POST /raffles/{id}/ops`)

Cada operación describe la **intención**. El servidor las aplica **en orden**, cada una en su propia transacción con bloqueo de la rifa (`lockForUpdate` sobre la fila de `raffles`).

**Idempotencia:** si un `opId` ya existe en `operations`, se devuelve el mismo resultado guardado sin volver a aplicarla.

| type | payload | Roles | Rechazos (`reason`) |
|---|---|---|---|
| `numbers.assign` | `{ saleId, seq, numbers[], person: { id, name, phone, email, referrer }, amount, createdAt }` | owner, seller | `number_taken`, `out_of_range` (fuera del total), `outside_ranges` (fuera del talonario), `invalid` |
| `number.release` | `{ number }` | owner, seller (dentro de su talonario) | `outside_ranges`. Si el número ya estaba libre: **accepted** sin cambios |
| `number.transfer` | `{ number, person: { id, name, phone, email, referrer } }` | owner, seller (dentro de su talonario) | `number_not_taken`, `outside_ranges` |
| `sale.void` | `{ saleId }` | owner; seller sólo sus ventas (`created_by`) | `not_yours`. Si ya no existe: **accepted** sin cambios |
| `sale.setAmount` | `{ saleId, amount }` (`null` = calculado) | owner, seller | `sale_not_found`, `invalid` |
| `person.update` | `{ personId, data: { name, phone, email, referrer } }` | owner, seller | `person_not_found`, `invalid` |
| `raffle.updateConfig` | `{ config }` | owner | `total_below_sold`, `invalid` |
| `raffle.updateShare` | `{ share }` | owner, seller | `invalid` |
| `receipt.set` | `{ saleId, meta: { name, type, size, thumb, addedAt } }` | owner, seller | `sale_not_found` |
| `receipt.remove` | `{ saleId }` | owner, seller | — (si no había, accepted) |

Cualquier operación de un `viewer`, o de un tipo desconocido, se rechaza con `forbidden` / `unknown_type`. Un rechazo **no** corta el lote: se sigue con la siguiente.

`message` es el texto para mostrar, por ejemplo: «El número 7 ya lo había vendido Juan desde otro teléfono», «El número 150 está fuera de tu talonario», «No podés bajar el total a 100: el número 120 está vendido».

### Semántica detallada (servidor y servidor falso)

- **numbers.assign**: todos los números deben estar entre 1 y `config.total`, dentro del talonario del usuario (si tiene) y libres (sin fila viva); si uno falla se rechaza la operación entera. Persona: se busca por `(raffle_id, key)`; si existe se reutiliza completando sólo los campos de contacto que vengan no vacíos; si no, se crea con `person.id`. Si la persona existente tiene un id distinto de `person.id`, se registra un **alias** `person.id → id existente`. `seq` definitivo = `raffles.last_seq + 1` (el del payload se ignora). Un número liberado y vuelto a vender **reactiva** su fila con soft delete. `amount` como en el cliente (entero ≥ 0 o `null`). `result = { seq, participantId }`.
- **number.release**: borra (soft) el número; si su venta queda sin números, borra la venta y su comprobante; si la persona queda sin números ni ventas, la borra.
- **number.transfer**: upsert de la persona como en assign; cambia el dueño del número; borra la persona anterior si queda huérfana. El pago queda en la venta original.
- **sale.void**: borra sus números, la venta, el comprobante y las personas huérfanas.
- **person.update**: si el nombre nuevo coincide (por `key`) con otra persona, se **unifican**: las referencias pasan a la otra, se completan sus campos vacíos, la persona editada se borra (soft) y se registra el alias.
- **raffle.updateConfig**: rechaza si algún número vendido supera el nuevo total. Última escritura gana.
- Los ids que llegan en las operaciones se resuelven contra los **aliases** antes de aplicarlas (una operación offline puede referirse a una persona que el servidor ya unificó).
- Cada fila tocada recibe una `version` nueva; la rifa también, si cambió `config`, `share`, `last_seq` o se borró.

## Cliente: modelo local (etapa 2)

- Dexie v4: `raffles.remote` (`null` en las existentes). Para rifas en la nube: `remote = { syncedVersion, role, ranges, userId, lastSyncAt, status: "active"|"deleted"|"revoked" }`.
- `outbox: '++seq, raffleId, opId'` → `{ seq, opId, raffleId, type, payload, createdAt, attempts, error }`, escrita **en la misma transacción** que el cambio local. Las rifas locales nunca generan filas.
- `uploads: 'saleId, raffleId'` → cola de archivos de comprobantes a subir (el blob queda en `receipts`).
- `conflicts: '++id, raffleId'` → `{ id, raffleId, opId, type, reason, message, createdAt }`.
- `sales.createdBy` (`{ id, name }` o `null` en rifas locales). `receipts` que vinieron del servidor sin archivo: `{ …meta, remote: true }` sin `blob`/`buffer`; se bajan al abrirlos.
- `settings`: `auth = { token, user }` (del dispositivo, no se sincroniza).

### Ciclo de sync de una rifa

1. **Push** de las operaciones pendientes en orden, en lotes. Aceptadas → salen del outbox. Rechazadas → salen del outbox y se guardan en `conflicts`.
2. Si hubo **algún rechazo**, el cliente se reconcilia con `GET /snapshot`: reemplaza todas las filas locales de la rifa por las del servidor, salvo las entidades con operaciones aún pendientes (así se deshacen los cambios optimistas rechazados). Si no, **pull** incremental con `changes?since=syncedVersion`: reemplaza o borra filas, aplica `aliases` (reescribe referencias y borra la persona vieja), y **no toca** entidades con operaciones pendientes (`person:<id>`, `sale:<id>`, `number:<n>`, `receipt:<saleId>`, `raffle`).
3. Sube la cola de comprobantes (`uploads`) cuyas ventas ya existen en el servidor.
4. Guarda `syncedVersion`, `role`, `ranges`, `lastSyncAt`.

Errores del transporte (`SyncError.kind`): `network` y `server` → reintento con espera exponencial; `auth` (401) → se pide iniciar sesión sin perder el outbox; `forbidden` (403) → `remote.status = "revoked"`; `gone` (404/410) → `remote.status = "deleted"`. En los dos últimos la UI ofrece guardar una copia local o quitarla del dispositivo.
