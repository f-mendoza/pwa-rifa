# Rifas compartidas: etapas 2 y 3

Documento de traspaso para continuar el trabajo. Resume el estado actual y lo que falta para que una rifa pueda sincronizarse con un servidor y gestionarse entre varias personas.

## Contexto

PWA (React 19 + Vite + Dexie/IndexedDB) para gestionar rifas benéficas desde el celular, pensada para usarse **sin conexión**. La base local es hoy la única fuente de verdad. La UI está en castellano rioplatense; el tono y los principios de diseño están en `PRODUCT.md`.

Objetivo final: que varias personas (con cuenta) vendan números de **la misma rifa** desde sus teléfonos, sincronizando contra una **API propia en Laravel**, sin perder el funcionamiento offline. Una rifa puede seguir siendo **sólo local** (sin cuenta ni servidor).

| Etapa | Qué | Estado |
|---|---|---|
| 1 | Varias rifas en el dispositivo, modelo preparado para sincronizar | Hecha (rama `multiples-rifas`) |
| 2 | Cliente listo para sincronizar: outbox de operaciones, motor de sync contra una interfaz | Pendiente |
| 3 | API Laravel: cuentas, rifas en la nube, invitaciones, sync por polling | Pendiente |

## Estado actual (después de la etapa 1)

Todo el acceso a datos está en `src/db.js`, y la UI lee con `useLiveQuery` (`src/hooks/useRaffle.js`). **Toda escritura pasa por funciones de `db.js`**: es el único punto a instrumentar.

### Esquema Dexie v3

```
raffles:  'id, createdAt'                                 { id, config, share, createdAt, archivedAt, lastSeq }
people:   'id, raffleId, &[raffleId+key]'                 { id, raffleId, name, key, phone, email, referrer, createdAt }
numbers:  'id, [raffleId+number], participantId, purchaseId'   { id: `${raffleId}:${number}`, raffleId, number, participantId, purchaseId, createdAt }
sales:    'id, raffleId, participantId'                   { id, raffleId, seq, participantId, createdAt, amount }   // amount null = precio calculado
receipts: 'purchaseId, raffleId'                          { purchaseId, raffleId, name, type, size, blob | buffer, thumb, addedAt }
settings: 'key'                                           'appearance' (tema) y 'activeRaffle' (rifa abierta): son del dispositivo y no se sincronizan
```

- **IDs:** UUIDv7 generados en el cliente (`src/lib/ids.js`). Están pensados para que el servidor los acepte tal cual como clave primaria; en Laravel 12, `HasUuids` también genera v7.
- **Números:** un número vendido es una fila; uno libre no tiene fila. El id `raffleId:number` garantiza localmente que no se venda dos veces.
- **Personas:** son por rifa. La unicidad es por `key` (el nombre normalizado, ver `personKey`). Si se edita una persona y su nombre coincide con otra, se **unifican**.
- **Número de comprobante:** `seq` es el número que se muestra (#1, #2…), correlativo por rifa. Sale de `raffles.lastSeq` y no se reutiliza.
- **Monto de la venta:** el total se calcula con `priceFor(count, config)` (`src/lib/format.js`). `amount` sólo se guarda cuando se corrige a mano.
- **Respaldo (`exportBackup(raffleId)`, formato 3):** JSON con `{ raffle: { config, share, createdAt }, participants, tickets, purchases, receipts }`, con los comprobantes adjuntos en base64. Hoy `importBackup` regenera los ids; en la etapa 3 el mismo formato puede servir para subir una rifa local a la nube **conservando** los ids.

### Escrituras existentes (las que hay que convertir en operaciones)

| Función en `db.js` | Qué hace |
|---|---|
| `createRaffle({ title, copyFrom })` | Crea una rifa (opcionalmente copiando config y share de otra) |
| `saveConfig(raffleId, config)` | Guarda la configuración. Falla si el total queda por debajo de un número vendido |
| `saveSharePrefs(raffleId, prefs)` | Guarda el estilo de la imagen para compartir |
| `archiveRaffle(raffleId, archived)` | Archiva o desarchiva |
| `deleteRaffle(raffleId)` | Borra la rifa con todo lo suyo |
| `importBackup(data)` | Restaura un respaldo como rifa nueva |
| `assignNumbers(raffleId, numbers, person, { amount, receipt })` | Crea o reutiliza la persona, crea la venta (`seq` nuevo) y los números |
| `releaseNumber(raffleId, number)` | Libera un número. Borra la venta si queda vacía y la persona si queda huérfana |
| `transferNumber(raffleId, number, person)` | Pasa un número a otra persona. El pago queda en la venta original |
| `voidPurchase(purchaseId)` | Anula la venta entera |
| `setPurchaseAmount(purchaseId, amount)` | Corrige el monto (`null` = calculado) |
| `setReceipt(purchaseId, receipt)` / `removeReceipt(purchaseId)` | Adjunta o quita la imagen o PDF del comprobante |
| `updateParticipant(id, person)` | Edita una persona. Si el nombre coincide con otra, se unifican |

Tests: `tests/unit/db.test.js` (Vitest + fake-indexeddb) y e2e con Playwright en `tests/e2e/` (perfiles Pixel 7 y iPhone 13).

## Etapa 2: cliente listo para sincronizar

Todavía sin servidor real. El objetivo es que el cliente sepa **qué cambió y en qué orden**, y que tenga un motor de sincronización probado contra un servidor falso.

### 2.1 Distinguir rifas locales y en la nube

- Agregar `remote` a `raffles`: `null` para una rifa local, o `{ syncedVersion, role, lastSyncAt }` para una rifa en la nube. Sólo las rifas con `remote` generan operaciones y se sincronizan.
- Migración Dexie v4: todas las rifas existentes quedan con `remote: null`.

### 2.2 Outbox de operaciones

- Tabla nueva, sólo local: `outbox: '++seq, raffleId'`, con filas `{ seq, opId (UUIDv7), raffleId, type, payload, createdAt, attempts, error }`.
- Cada escritura de `db.js` sobre una rifa con `remote` agrega su operación **en la misma transacción** que el cambio local, para que nunca quede un cambio sin su operación ni al revés.
- **Las operaciones describen la intención, no el estado resultante.** Así el servidor puede validar (por ejemplo, rechazar un número que ya vendió otra persona):
  - `numbers.assign { saleId, seq, numbers[], person: { id, name, phone, email, referrer }, amount, createdAt }`
  - `number.release { number }`
  - `number.transfer { number, person }`
  - `sale.void { saleId }`
  - `sale.setAmount { saleId, amount }`
  - `person.update { personId, data }`
  - `raffle.updateConfig { config }`
  - `raffle.updateShare { share }`
  - `raffle.delete`
  - Los comprobantes adjuntos **no** van en el outbox: se suben aparte (ver 3.6). En el outbox sólo va `receipt.set { saleId, meta }` o `receipt.remove { saleId }`, y los archivos esperan en una cola de subida propia.
- El cliente sigue aplicando el cambio localmente al instante (optimista). La UI no espera a la red.

### 2.3 Motor de sincronización (`src/sync/`)

Debe programarse contra una interfaz (`transport`) para poder probarlo con un servidor falso en memoria. Un ciclo de sincronización por rifa hace:

1. **Push:** envía las operaciones pendientes en orden (`POST /raffles/{id}/ops`, en lotes). El servidor responde una por una: aceptada o rechazada con un motivo. Las aceptadas salen del outbox. Las rechazadas se registran como **conflictos** para mostrarlos ("El número 7 ya lo había vendido Juan desde otro teléfono") y también salen.
2. **Pull:** pide los cambios desde la última versión vista (`GET /raffles/{id}/changes?since={syncedVersion}`). El servidor devuelve filas completas y bajas ("tombstones"). El cliente reemplaza o borra localmente, **salvo las entidades que todavía tienen operaciones pendientes** (por ejemplo, una que se creó entre el push y el pull), y actualiza `syncedVersion`.
3. Si el servidor cambió ids (por ejemplo, unificó una persona creada en dos teléfonos), el pull lo trae resuelto; el cliente reescribe las referencias.

Puntos de diseño:

- **Borrados:** el cliente puede seguir borrando filas de verdad. Las bajas las guarda el servidor (`deleted_at`) y llegan en el pull. No hace falta `deletedAt` local.
- **Cuándo sincronizar:** desde la página, no desde el service worker. La sincronización periódica en segundo plano no existe en iOS y en Chrome es poco confiable. Se dispara:
  - cada 10–15 segundos con la pestaña visible y conexión;
  - al volver a la app (`visibilitychange`) y al recuperar señal (evento `online`);
  - poco después de cada escritura local (con un pequeño retardo para agrupar).
  - Opcional: Background Sync API para vaciar el outbox donde exista.
- **Varias pestañas:** que sincronice una sola, usando Web Locks (`navigator.locks`) o `BroadcastChannel`.
- **Reintentos:** con espera exponencial ante errores de red o 5xx. Si el servidor responde 401, se pide volver a iniciar sesión, sin perder el outbox.

### 2.4 UI mínima de esta etapa

- Indicador de estado de la rifa abierta: "Sincronizado", "N cambios sin enviar", "Sin conexión" o "Hay conflictos".
- Lista de conflictos con su explicación y un "Entendido" para descartarlos.

### 2.5 Criterio de terminado

- Tests unitarios del outbox: cada escritura de una rifa con `remote` genera exactamente su operación, y una rifa local no genera ninguna.
- Tests del motor contra el servidor falso: dos "dispositivos" que venden el mismo número sin conexión, push idempotente (reenviar el mismo `opId` no duplica nada), pull que no pisa cambios pendientes y bajas que se aplican.
- Ningún cambio de comportamiento para las rifas locales: todos los tests actuales siguen pasando.

## Etapa 3: API en Laravel y colaboración

Repositorio aparte (todavía no existe). Recomendado: Laravel 12, Postgres o MySQL 8, Sanctum para autenticación y tests con Pest.

### 3.1 Cuentas

- Registro, inicio de sesión, verificación de correo y recuperación de contraseña.
- Autenticación con **tokens de Sanctum** (`Authorization: Bearer`). La PWA guarda el token en IndexedDB (en `settings`, sin sincronizar).
- Se puede usar la app sin cuenta: la cuenta sólo hace falta para crear o abrir rifas en la nube.

### 3.2 Modelo en el servidor

Todas las tablas sincronizables tienen `id` UUID (el que manda el cliente), `version` (bigint, tomado de una secuencia global y actualizado en **cada** cambio) y `deleted_at` (soft deletes, para que las bajas lleguen en el pull).

```
users
raffles        id, owner_id, config (json), share (json), last_seq, created_at, version, deleted_at
raffle_user    raffle_id, user_id, role (owner | seller | viewer), archived_at   ← archivar pasa a ser personal
invitations    id, raffle_id, email?, token, role, expires_at, accepted_by, accepted_at
people         id, raffle_id, name, key, phone, email, referrer, created_at, version, deleted_at   UNIQUE(raffle_id, key)
sales          id, raffle_id, seq, participant_id, amount, created_by, created_at, version, deleted_at   UNIQUE(raffle_id, seq)
numbers        raffle_id, number, participant_id, sale_id, created_by, created_at, version, deleted_at   UNIQUE(raffle_id, number)
receipts       sale_id, path, name, type, size, thumb, version, deleted_at
operations     op_id (PK), raffle_id, user_id, type, payload, status, result, created_at   ← idempotencia y auditoría
```

- **Números liberados y vueltos a vender:** chocan con el `UNIQUE(raffle_id, number)` de la fila con soft delete. Al vender, hay que **reactivar y actualizar** esa fila en lugar de insertar una nueva.
- **Validaciones del servidor (es la autoridad):**
  - el número está dentro del total y libre;
  - el total no puede bajar por debajo de un número vendido;
  - el rol alcanza para la operación.
- Cada operación se aplica en una transacción con bloqueo por rifa (`SELECT … FOR UPDATE` sobre la fila de `raffles`), para que dos ventas simultáneas del mismo número se resuelvan en orden.

### 3.3 Endpoints

```
POST   /auth/register | /auth/login | /auth/logout | /auth/forgot-password …
GET    /raffles                         rifas del usuario con su rol
POST   /raffles                         subir una rifa local: snapshot completo (formato de respaldo 3, conservando ids)
GET    /raffles/{id}/snapshot           estado completo (primera descarga en un dispositivo nuevo)
POST   /raffles/{id}/ops                lote de operaciones → [{ opId, status: accepted|rejected, reason?, version }]
GET    /raffles/{id}/changes?since=V    filas con version > V, incluidas las bajas → { rows: {people, sales, numbers, receipts, raffle}, version }
PUT    /raffles/{id}/sales/{saleId}/receipt    subir archivo (multipart)
GET    /raffles/{id}/sales/{saleId}/receipt    bajar archivo (URL firmada)
GET    /raffles/{id}/members | PATCH …/members/{userId} | DELETE …/members/{userId}
POST   /raffles/{id}/invitations        → link con token
POST   /invitations/{token}/accept
```

### 3.4 Conflictos y casos borde

| Caso | Resolución |
|---|---|
| Mismo número vendido por dos personas sin conexión | Gana la primera operación que llega al servidor. La otra se rechaza y aparece como conflicto en ese teléfono. **Recomendado:** talonarios por vendedor (`raffle_user.ranges`, por ejemplo `[[1,100]]`): el servidor rechaza ventas fuera del rango propio y el conflicto no se produce. |
| La misma persona creada en dos teléfonos ("Ana" y "ana") | `UNIQUE(raffle_id, key)`: el servidor reutiliza la persona existente, reasigna las referencias y avisa del cambio de id en el pull. |
| `seq` repetido (dos ventas #12 sin conexión) | El servidor asigna el `seq` definitivo. El del cliente es provisorio y se corrige en el pull. Conviene marcarlo como provisorio en la UI mientras haya operaciones pendientes. |
| Ediciones de configuración simultáneas | Gana la última escritura, a nivel de documento entero. Es aceptable: sólo la toca quien organiza. |
| Rifa borrada por el dueño | Llega como baja en el pull. El cliente ofrece guardar una copia local antes de quitarla. |
| Se pierde el acceso (lo sacaron de la rifa, 403) | Igual que el caso anterior: ofrecer conservar una copia local. |

### 3.5 Roles

| Rol | Puede |
|---|---|
| `owner` | Todo: configuración, borrar la rifa, invitar, cambiar roles, asignar rangos |
| `seller` | Vender, liberar y transferir números (dentro de su rango, si tiene), anular **sus** ventas, adjuntar comprobantes |
| `viewer` | Sólo leer |

El cliente oculta lo que el rol no permite, pero **el servidor valida siempre**.

### 3.6 Comprobantes adjuntos

- Se suben aparte del outbox, con su propia cola local que se procesa cuando hay red. Se guardan en `storage` de Laravel (disco local o S3).
- El pull trae sólo la metadata y la miniatura (`thumb`, que ya es un data URL chico). El archivo se baja cuando alguien lo abre y queda guardado en IndexedDB.

### 3.7 UI de la etapa 3

- Pantalla de inicio de sesión y registro, accesible desde "Mis rifas" y desde Ajustes.
- En "Mis rifas": un distintivo "En la nube" o "Local" por rifa, la acción "Subir a la nube" para una rifa local y la lista de rifas compartidas con el usuario.
- Pantalla de miembros: invitar (copiar link o compartir por WhatsApp), cambiar rol, asignar talonario y quitar miembros.
- Ruta de invitación (`/invitacion/:token`): pide iniciar sesión, acepta la invitación y descarga el snapshot.
- En cada venta, quién la hizo (`created_by`).

### 3.8 Tiempo real (opcional, después)

Laravel Reverb (WebSockets): el servidor avisa "la rifa X cambió" y el cliente hace un pull en el momento. El polling queda como respaldo. No cambia el protocolo.

## Decisiones abiertas (consultar al usuario)

1. ¿Talonarios por vendedor obligatorios u opcionales?
2. ¿El `seq` lo asigna siempre el servidor, o se reservan bloques por dispositivo?
3. ¿Archivar es personal (`raffle_user`) o de la rifa?
4. Datos personales: los teléfonos y correos de los participantes pasan a estar en un servidor. Hace falta un aviso o consentimiento (Ley 25.326 en Argentina) y definir cuánto tiempo se conservan.
5. Dónde se hospeda la API y el storage de los archivos.

## Restricciones que no hay que romper

- Una rifa local tiene que funcionar exactamente igual que hoy, sin cuenta y sin red.
- Nunca se puede vender dos veces el mismo número: localmente lo impide la clave; en la nube, el servidor.
- Nada de ids autoincrementales ni claves globales en datos que se sincronizan.
- Cada acción deja una confirmación clara, y lo destructivo pide confirmación (ver `PRODUCT.md`). Los errores de sincronización se explican en lenguaje llano y en castellano (ver `src/lib/errors.js`).
- Mantener la cobertura de tests: unitarios para `db.js` y el motor de sincronización, e2e para los flujos visibles.
