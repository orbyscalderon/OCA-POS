# Arquitectura Offline-First y Resolución de Conflictos

El escenario real: un colmado en un barrio con internet intermitente, tres cajas, y un galponero en una finca sin señal. **La venta no puede esperar a la nube.**

---

## 1. Postura de diseño

> El servidor **no** es la fuente de verdad de lo que ocurrió. Es la fuente de verdad de lo que se **concilió**.

Cuando el cajero entrega el producto e imprime el ticket, el hecho ya sucedió en el mundo físico. Un servidor que dos horas después responde "rechazado, no había stock" no deshace nada: solo genera un descuadre invisible. Por eso el sistema **nunca rechaza una venta al sincronizar**. Registra, concilia y avisa.

De ahí se derivan tres reglas de modelado:

1. **Los hechos son inmutables y aditivos.** Se guardan deltas, no estados.
2. **Los IDs se generan en el cliente** (UUID v7). Nadie pide permiso para existir.
3. **El estado se deriva** de la suma de hechos. Nunca `UPDATE saldo = 5`.

---

## 2. Por qué los ledgers eliminan el conflicto

Este es el corazón del requisito *"dos dispositivos venden el mismo producto sin conexión al mismo tiempo"*.

### El enfoque ingenuo (roto)

```sql
UPDATE stock SET qty = 7 WHERE variant_id = 'X';  -- Caja A vendió 3 de 10
UPDATE stock SET qty = 8 WHERE variant_id = 'X';  -- Caja B vendió 2 de 10
```

Last-write-wins. Resultado: `qty = 8`. Se perdieron 3 unidades vendidas y el inventario miente. **Esto es lo que hacen la mayoría de los POS "con offline".**

### El enfoque del sistema

```sql
INSERT INTO app.stock_events (id, variant_id, delta_qty, ...) VALUES ('uuid-a', 'X', -3, ...);
INSERT INTO app.stock_events (id, variant_id, delta_qty, ...) VALUES ('uuid-b', 'X', -2, ...);
-- Saldo = 10 + (-3) + (-2) = 5. Correcto, sin importar el orden de llegada.
```

La suma es **conmutativa y asociativa**. Da igual qué caja sincronice primero, si llegan duplicados (la PK los rechaza), o si una tablet estuvo tres días sin señal. El resultado converge al mismo valor. Es la semántica de un **contador PN de CRDT**, implementada con lo que Postgres ya sabe hacer bien.

**Cuatro ledgers usan este patrón:**

| Tabla | Delta | Estado derivado |
|---|---|---|
| `app.stock_events` | `delta_qty` | `stock_balances.qty_on_hand`, `variant_costs.avg_cost` |
| `app.credit_movements` | `amount` | `credit_accounts.balance`, `customers.balance_due` |
| `app.biological_events` | `delta_qty` | `biological_lots.current_qty` |
| `app.loyalty_movements` | `points` / `cashback` | `loyalty_accounts.*_balance` |

Los cuatro tienen trigger `tg_append_only` (no admiten UPDATE/DELETE) y `REVOKE UPDATE, DELETE` al rol de la aplicación. Doble barrera.

---

## 3. Stack del cliente

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React / Next.js PWA · Flutter en fase 4)                │
├──────────────────────────────────────────────────────────────┤
│  TanStack Query      ← lee SIEMPRE de local, nunca de la red  │
├──────────────────────────────────────────────────────────────┤
│  Capa de dominio compartida  (packages/core-domain)           │
│  · motor de precios · impuestos · promociones · validación    │
│  El MISMO paquete corre en el servidor. Un solo cálculo.      │
├──────────────────────────────────────────────────────────────┤
│  RxDB + Dexie (IndexedDB)                                     │
│  · colecciones replicadas  · outbox local  · reloj Lamport    │
├──────────────────────────────────────────────────────────────┤
│  Sync Engine  (Web Worker, no bloquea la UI)                  │
│  push → pull → resolver → reproyectar                         │
└──────────────────────────────────────────────────────────────┘
```

**Por qué RxDB y no WatermelonDB:** WatermelonDB brilla en React Native; nuestro cliente primario es una PWA (una tablet Android barata con Chrome es el hardware real de una MiPyME). RxDB corre en ambos, tiene replicación con checkpoints y soporte de esquema versionado. La decisión se revisa si Flutter pasa a ser el cliente principal.

### Qué se replica al dispositivo

| Colección | Estrategia | Volumen típico |
|---|---|---|
| `products`, `variants`, `packagings` | Pull completo, delta por `sync_seq` | 300 – 5.000 filas |
| `stock_balances` | Pull completo del almacén de la sucursal | = variantes |
| `customers` | Pull completo (se necesitan offline para fiar) | 100 – 10.000 |
| `credit_accounts` + saldos | Pull completo | = clientes con deuda |
| `attribute_definitions`, config del perfil | Pull completo, cambia poco | ~50 |
| `sales`, `stock_events` | **Push únicamente**; pull solo de otros dispositivos | ilimitado |
| `biological_lots`, `daily_records` | Bidireccional, filtrado por galpón asignado | decenas |
| Históricos > 90 días | **No se replica** — se consulta online | — |

Presupuesto: **< 40 MB** de IndexedDB para un negocio mediano.

---

## 4. Protocolo de sincronización

### Push

```http
POST /api/v1/sync/push
Idempotency-Key: <batch_uuid>

{
  "device_id": "…",
  "batch_id": "…",
  "operations": [
    { "id": "…", "device_lamport": 1042, "entity_type": "sale",
      "op": "insert", "client_time": "2026-08-20T14:03:11Z", "payload": { … } },
    { "id": "…", "device_lamport": 1043, "entity_type": "stock_event",
      "op": "insert", "client_time": "2026-08-20T14:03:11Z", "payload": { … } }
  ]
}
```

- El lote entero se aplica en **una transacción**. O entra completo o no entra.
- `UNIQUE (device_id, device_lamport)` en `app.sync_operations` garantiza que un reintento sea **no-op**, no un duplicado.
- El orden dentro del dispositivo se respeta por `device_lamport` (contador monótono local, inmune a que el usuario cambie la hora de la tablet).
- Respuesta: por operación → `applied` | `duplicate` | `conflict` | `rejected`, más el `server_seq` alcanzado.

### Pull

```http
GET /api/v1/sync/pull?since=<sync_seq>&entities=products,customers,stock_balances
```

Cada fila sincronizable lleva `sync_seq` estampado por trigger desde una secuencia global. El cliente guarda su cursor por entidad en `app.sync_cursors`. Paginado a 500 filas; se repite hasta que `has_more = false`.

### Cadencia

- **Inmediata** al recuperar conectividad (evento `online`).
- **Cada 30 s** con red disponible.
- **Al cerrar caja** — sincronización forzada y bloqueante, con barra de progreso.
- **Backoff exponencial** con jitter ante fallo: 2 s → 4 s → … → 5 min máx.

---

## 5. Taxonomía de conflictos y su resolución

Registrados en `app.sync_conflicts`. **Cada conflicto se guarda aunque se resuelva solo**: el dueño tiene derecho a saber qué pasó.

### 5.1 `oversell` — el caso estrella

**Escenario:** quedan 10 unidades. Sin internet, la Caja A vende 7 y la Caja B vende 5. Ambos tickets se imprimieron.

**Resolución: `accepted_both`.** Se insertan ambos eventos. El saldo queda en **−2**. El trigger `detect_oversell` registra el conflicto con `requires_action = true`.

Es la única respuesta honesta: el cliente ya se llevó el producto. Lo que el sistema hace es **hacer visible el faltante** en vez de esconderlo con un `qty = max(0, …)`.

La app muestra: *"⚠️ Sobreventa detectada: Elf Bar Mango Ice quedó en −2 unidades. Ventas #A-431 (Caja 1) y #B-118 (Caja 2) el 20/08 a las 14:03. Acciones: reponer stock · convertir en pedido pendiente · anular una venta con nota de crédito."*

**Mitigación preventiva** (reduce la frecuencia, no la elimina):
- Reserva blanda por dispositivo: con `stock ≤ 5`, cada caja opera contra una cuota proporcional del saldo.
- Badge visual: el POS muestra "stock estimado — última sync hace 12 min" cuando lleva > 5 min offline.
- Productos con `allow_negative_stock = true` (servicios, alimentos preparados) nunca generan este conflicto.

### 5.2 `credit_limit_exceeded`

**Escenario:** cliente con límite de 5.000 y deuda de 4.000. Dos cajas le fían 800 cada una offline.

**Resolución: `accepted_both`.** Los `credit_movements` se suman: deuda 5.600. Se marca la cuenta y se notifica al dueño por WhatsApp. Nadie va a perseguir al cliente para devolverle un producto por 600 de exceso.

### 5.3 `concurrent_update` — entidades de estado

Productos, clientes y precios **no** son ledgers: son estado mutable. Aquí sí hay conflicto real.

**Resolución: merge campo a campo con LWW por campo.** Implementado en [`db/schema/15_sync_lww.sql`](../db/schema/15_sync_lww.sql).

Cada entidad replicada lleva una columna `sync_meta jsonb` con un reloj lógico **por campo**:

```json
{ "price": { "v": 1042, "d": 3 }, "name": { "v": 1039, "d": 1 } }
```

`v` es el contador Lamport del dispositivo que escribió ese campo; `d` es su `device_no`, usado como desempate determinista. La función `app.lww_merge(datos_actuales, meta_actual, datos_entrantes, meta_entrante, campos_protegidos)` devuelve `{data, meta, conflicts}`: la capa de aplicación aplica `data` y persiste `conflicts` en `app.sync_conflicts`.

Si la Caja A cambió el precio y la Caja B el nombre, **ambos cambios sobreviven**. Si ambas tocaron el mismo campo, gana el reloj mayor y el valor descartado queda registrado para ser recuperable.

**Excepción — campos monetarios sensibles.** `price`, `min_price`, `compare_at_price`, `credit_limit` y `default_cost` son el arreglo `p_server_wins` por defecto: gana el servidor siempre, sin importar el reloj, y se avisa al dispositivo. Un precio no puede quedar a merced del reloj de una tablet que estuvo cuatro días sin sincronizar.

### 5.4 `duplicate_document` — numeración fiscal

**No puede ocurrir**, por diseño. Cada dispositivo opera con un bloque disjunto de folios pre-asignado (`app.fiscal_sequence_blocks`), protegido por una restricción `EXCLUDE USING gist` que **la base de datos** garantiza. La numeración legible (`SD1-02-000431`) incluye el `device_no`, así que tampoco colisiona.

Si un bloque se agota offline, el POS pasa a **modo contingencia**: emite con folio provisional marcado `is_contingency = true` y lo regulariza al reconectar. Esto es exactamente lo que la mayoría de las autoridades tributarias contemplan para fallas de comunicación.

### 5.5 `closed_period`

**Escenario:** una tablet sincroniza una venta de ayer, pero la caja de ayer ya se cerró y arqueó.

**Resolución: `merged` con reapertura contable.** La venta se registra con su `occurred_at` real, se enlaza a la sesión cerrada, y se genera un ajuste `late_entry` que aparece en el arqueo del día siguiente con nota explicativa. El cierre original **no se reescribe** — eso rompería la cadena de auditoría.

### 5.6 `deleted_entity`

Un producto se archivó en la oficina mientras una caja offline lo vendía. **Resolución: `client_wins` parcial** — la venta vale (el snapshot en `sale_lines` conserva nombre, precio y atributos), el producto sigue archivado, y se avisa.

Es la razón por la que `sale_lines` guarda `name_snapshot` y `attributes_snapshot` en vez de solo el FK.

### Tabla resumen

| Conflicto | Resolución | ¿Requiere acción humana? |
|---|---|---|
| `oversell` | `accepted_both` | **Sí** |
| `credit_limit_exceeded` | `accepted_both` | Sí (notificación) |
| `concurrent_update` (general) | `merged` (LWW por campo) | No |
| `concurrent_update` (monetario) | `server_wins` | No |
| `duplicate_document` | Imposible por diseño | — |
| `closed_period` | `merged` + asiento tardío | Solo informativo |
| `deleted_entity` | `client_wins` parcial | No |
| `price_mismatch` | `server_wins`, se honra el ticket | No |

---

## 6. Integridad y auditoría del proceso

- **Reproyección:** `app.rebuild_stock_balances(tenant)` compara el saldo materializado contra la suma del ledger y devuelve solo las diferencias; debe devolver **cero filas**. `app.rebuild_variant_cost(variant)` recalcula el CPP reproduciendo el ledger en orden cronológico. El job semanal `reproject-ledgers` los ejecuta en una réplica: cualquier deriva es un bug del trigger detectado antes de convertirse en un descuadre.
- **Saldos de crédito:** `app.refresh_credit_status(tenant)` recalcula mora, días de atraso y `customers.overdue_amount` desde las cuentas y cuotas. Lo invoca el job diario antes de devengar intereses.
- **Auditoría encadenada:** cada fila de `app.audit_logs` incluye el SHA-256 de la anterior del mismo tenant. `app.verify_audit_chain(tenant)` recorre la cadena y devuelve la primera rotura. Si un empleado con acceso a la BD borra la anulación que hizo, la cadena lo delata.
- **Los conflictos también se auditan.** Cada resolución automática genera un `audit_log` con `severity = 'warning'`.

### Todo esto está bajo test

[`db/tests/test_ledger_commutativity.sql`](../db/tests/test_ledger_commutativity.sql) corre en CI y verifica, sobre una base real (`npm run db:test`):

1. El costo promedio ponderado (10 @ 5 + 10 @ 7 = 6.00).
2. **Conmutatividad**: dos ventas offline que llegan en orden invertido dan `20 − 12 − 14 = −6`; ninguna se pierde.
3. La sobreventa genera un `sync_conflict` con `requires_action`.
4. La reproyección no arroja deriva.
5. `UPDATE` y `DELETE` sobre `stock_events` son rechazados.
6. **Idempotencia**: reenviar el mismo evento no descuenta dos veces.

---

## 7. Lo que este diseño *no* resuelve

Honestidad sobre los límites:

1. **La sobreventa no se previene, se gestiona.** Prevenirla exigiría reserva distribuida con consenso, lo que significa exigir conectividad — precisamente lo que el producto promete no exigir.
2. **El costo promedio ponderado depende del orden de llegada.** Si una compra sincroniza después de una venta, el CPP de esa venta usó el costo anterior. El job de reproyección lo corrige y ajusta el margen histórico; la diferencia es material solo con alta volatilidad de costos.
3. **Un dispositivo offline > 30 días** puede quedar fuera de la ventana de retención de `sync_operations`. Se fuerza un reset completo con push previo de su outbox.
4. **El reloj del dispositivo no es confiable.** Por eso `occurred_at` se corrige con el offset NTP medido al último handshake, y el orden real lo dan `device_lamport` (intra-dispositivo) y `sync_seq` (servidor), nunca la hora de pared.
