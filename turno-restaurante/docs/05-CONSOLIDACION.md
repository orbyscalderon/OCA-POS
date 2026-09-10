# Consolidación de los cuatro proyectos

Turno, OC Credit, Supermercado Silvia y Supermercado Marinero se unifican en un solo producto. Este documento registra **qué salió de dónde**, qué se descartó y por qué.

**Turno es el repo principal** porque es el que está desplegado (Railway + Supabase + Cloudflare + Backblaze) y el que tiene la fontanería de SaaS ya resuelta y probada. Todo lo demás se trae hacia aquí.

---

## 1. Las cuatro bases de datos

| Proyecto | Motor | Modelos/Tablas | Destino |
|---|---|---|---|
| **Turno** | PostgreSQL + Prisma | 13 modelos | Reconciliado con el esquema unificado |
| **OC Credit** | PostgreSQL + TypeORM | 17 tablas, 10 ENUMs, 7 migraciones | Reconciliado |
| **Supermercado Silvia** | PostgreSQL + Prisma | 5 modelos | Reconciliado |
| **Supermercado Marinero** | Firestore | — | **Descartado.** Un modelo de documentos no migra a uno relacional con RLS, transacciones y ledgers sin reescribirlo entero |

Los tres esquemas originales quedan íntegros en [`db/legacy/`](../db/legacy/) como referencia y para migrar datos de clientes que ya estén operando.

---

## 2. Mapeo tabla por tabla

### Desde Turno

| Turno | Destino | Nota |
|---|---|---|
| `Usuario` | `platform.identities` + `app.users` | Turno mezcla la persona y su rol en el negocio; aquí se separan porque un contador atiende a varios negocios |
| `Negocio` | `platform.tenants` | **El `Negocio` de Turno ES el tenant.** `categoria` pasa a ser `profile_id` |
| `PeluqueroEquipo` | `app.employees` + `app.user_branch_access` | |
| `Servicio` | `app.products` (`kind = 'service'`) | `duracionMin` pasa a ser atributo dinámico del perfil `barberia` |
| `Reservacion` | `app.appointments` | |
| `Disponibilidad` | **`app.availability`** ← creada | Faltaba |
| `Bloqueo` | **`app.schedule_blocks`** ← creada | Faltaba |
| `Resena` | **`app.reviews`** ← creada | Faltaba |
| `InvitacionNegocio` | **`app.invitations`** ← creada | Faltaba |
| `PasswordResetToken`, `EmailVerificationToken` | **`platform.verification_tokens`** ← creada | Unificadas |
| `RefreshToken` | `app.sessions` | Ya existía |
| `AuditLog` | `app.audit_logs` | Se le añade la cadena de hash |

### Desde OC Credit

| OC Credit | Destino | Nota |
|---|---|---|
| `tenants` | `platform.tenants` | |
| `tenant_settings` | `tenants.config_overrides` (JSONB) | |
| `usuarios`, `empleados` | `app.users`, `app.employees` | |
| `clientes` | `app.customers` | Las coordenadas pasan a `attributes` |
| `prestamos` | `app.credit_accounts` (`kind = 'loan'`) | **Se le añaden 12 columnas**: circuito de aprobación, capital solicitado/aprobado/entregado y renovaciones |
| `cuotas_amortizacion` | `app.credit_installments` | |
| `cargos_mora` | `app.credit_movements` (`late_fee`) | |
| `transacciones` | `app.credit_movements` + `app.cash_movements` | |
| `cajas` | `app.cash_sessions` | |
| `rutas` | **`app.collection_routes`** + **`app.route_customers`** ← creadas | Faltaba |
| `novedades_ruta` | **`app.route_events`** ← creada | Faltaba. Con GPS y foto |
| `feriados` | **`app.holidays`** ← creada | Faltaba. Una cuota no puede vencer en día no laborable |
| `webhooks_pagos_digitales` | **`app.payment_webhooks`** ← creada | Faltaba |
| `audit_log` (particionado) | `app.audit_logs` (particionado) | Misma idea, ya implementada |

### Desde Supermercado Silvia

| Silvia | Destino | Nota |
|---|---|---|
| `User` | `app.users` | |
| `Category` | `app.categories` | |
| `Product` | `app.products` + `app.product_variants` | `precioCentavos` → `numeric`; `stock` deja de ser columna y pasa a derivarse del ledger |
| `Order`, `OrderItem` | `app.online_orders`, `app.online_order_lines` | |
| Carrito (en memoria) | **`app.carts`** ← creada | Faltaba |
| `/devoluciones` | **`app.return_requests`** ← creada | Faltaba |

---

## 3. Lo que el modelo unificado no tenía

Revisar tus proyectos destapó **12 tablas** que faltaban. No son ideas nuevas: es funcionalidad que ya estaba en producción. Están en [`db/schema/19_from_legacy.sql`](../db/schema/19_from_legacy.sql).

| Tabla | De | Por qué importa |
|---|---|---|
| `app.availability` | Turno | Sin el horario del profesional no se pueden calcular huecos |
| `app.schedule_blocks` | Turno | Vacaciones y ausencias, con anti-solape en la base |
| `app.reviews` | Turno | Reseñas y respuesta del negocio |
| `app.invitations` | Turno | Invitar al equipo por enlace |
| `platform.verification_tokens` | Turno | Verificar email y recuperar contraseña |
| `app.collection_routes` | OC Credit | El préstamo de barrio se cobra en ruta |
| `app.route_customers` | OC Credit | Orden de visita del cobrador |
| `app.route_events` | OC Credit | Por qué no se cobró, con GPS y foto |
| `app.holidays` | OC Credit | Corre las cuotas que caen en feriado |
| `app.payment_webhooks` | OC Credit | Un webhook repetido no puede cobrar dos veces |
| `app.carts` | Silvia | El carrito antes de confirmar el pedido |
| `app.return_requests` | Silvia | Solicitud de devolución del cliente |

Más 12 columnas nuevas en `app.credit_accounts` para el circuito de aprobación y las renovaciones de préstamo.

---

## 4. Conflictos reales que hay que resolver al portar

Estos no son detalles: son puntos donde el código anterior **no se puede pegar tal cual**.

### 4.1 El stock deja de ser una columna

Silvia tiene `Product.stock: Int` y hace `UPDATE`. Aquí el stock se deriva de `app.stock_events`. Es lo que permite que dos cajas vendan sin internet sin perder ventas — **es la razón de ser del diseño**, así que el port toca reescribir esa parte, no adaptarla.

### 4.2 Los identificadores cambian

Turno usa `Int` autoincremental para `Usuario` y `cuid()` para `Negocio`. Silvia usa `cuid()`. Aquí todo es **UUID v7 generado en el cliente**, porque una tablet sin señal tiene que poder crear una venta sin pedirle un número al servidor. La migración de datos existentes necesita una tabla de equivalencias.

### 4.3 El aislamiento pasa de la aplicación a la base

Turno filtra por `negocioId` en cada consulta. Aquí lo impone PostgreSQL con RLS: si falta el contexto, la consulta devuelve cero filas en vez de devolverlo todo. Al portar hay que envolver cada request con `SET LOCAL app.tenant_id`, y **quitar** los filtros manuales para que no oculten un fallo del contexto.

### 4.4 Prisma no puede mandar sobre el esquema

`prisma migrate` destruiría los triggers, las políticas RLS y las particiones de auditoría. La regla es: **el SQL de `db/schema/` es la fuente de verdad** y Prisma se genera con `prisma db pull`.

### 4.5 El dinero deja de ser centavos enteros

Silvia usa `precioCentavos: Int`. Aquí es `numeric(18,4)` con dominios (`app.money`, `app.unit_cost`), porque hay costos promedio ponderados y conversiones de unidad donde dos decimales no alcanzan.

---

## 5. Estructura por módulos

Cada módulo tiene su carpeta, con un README que dice de dónde sale, qué se rescata y qué falta:

```
backend/src/modules/<módulo>/README.md
frontend/src/modules/<módulo>/
```

Los 16 módulos están registrados en [`config/modules.json`](../config/modules.json), que además es un **gate de CI**: un rubro que encienda un módulo inexistente rompe el build, y un módulo marcado `core` no se puede apagar.

---

## 6. Orden de trabajo propuesto

1. **Conectar el Engine de Nicho al backend real** — que registrarse y elegir rubro provisione el negocio contra la base de verdad, no contra la demo.
2. **Migrar el aislamiento a RLS** — envolver las peticiones con contexto de tenant y quitar los filtros manuales.
3. **Portar `pos` e `inventory`** desde Silvia, reescribiendo el stock como ledger.
4. **Portar `credit` y `lending`** desde OC Credit, incluyendo rutas de cobranza.
5. **Encajar `appointments`** — el motor de Turno ya funciona; se cambia el lock `SELECT FOR UPDATE` por la restricción `EXCLUDE` que ya está en el esquema.
6. **Portar `storefront`** desde Silvia.
7. Construir lo que no existe en ninguno: `taxes`, `expenses`, `loyalty`, `purchasing`, `tables`, `service_orders` y **`agro`**.
