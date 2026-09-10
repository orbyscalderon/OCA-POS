# Arquitectura General — OC POS

SaaS B2B multi-tenant, offline-first y agnóstico al nicho, para MiPyMEs de LatAm.

---

## 1. Decisiones de stack (y por qué)

### Backend: **Node.js 22 / TypeScript + NestJS + Drizzle ORM**

Se evaluó FastAPI (Python). La decisión es TypeScript por **una razón que domina a todas las demás**:

> El motor de precios, impuestos, promociones y validación debe ejecutarse **idéntico** en el servidor y en el navegador offline. En TypeScript es un paquete compartido (`packages/core-domain`). En Python serían dos implementaciones que divergen en el trimestre tres, y la divergencia se manifiesta como un ticket impreso con un total distinto al registrado en la nube.

Argumentos secundarios:

| Criterio | TypeScript | FastAPI |
|---|---|---|
| Código de dominio compartido con la PWA | ✅ Nativo | ❌ Duplicado |
| Tipos extremo a extremo (Zod → cliente) | ✅ | Parcial |
| Contratación en LatAm | ✅ Amplia | ✅ Amplia |
| Cargas de ML (pronóstico de demanda) | ❌ Débil | ✅ Fuerte |

El punto débil se resuelve aislando el forecasting en un **worker Python** independiente (`services/forecaster`), que consume de la cola y escribe en `app.demand_forecasts`. Es el único servicio no-TS, y su frontera es una tabla.

**Por qué Drizzle y no Prisma:** RLS exige controlar la conexión y ejecutar `SET LOCAL app.tenant_id` dentro de la misma transacción que las queries. Drizzle expone la conexión y emite SQL predecible; Prisma abstrae el pool de forma que hace frágil ese contrato. Además, buena parte del sistema (ledgers, vistas de costeo) es SQL que se escribe a mano.

**Por qué NestJS y no Fastify pelado:** la modularidad por bounded context, la inyección de dependencias y los guards declarativos para RBAC dan estructura a un equipo que va a crecer. Se usa NestJS con adaptador Fastify (no Express).

### Base de datos: **PostgreSQL 16 + RLS compartido**

Se evaluaron tres modelos de aislamiento:

| Modelo | Aislamiento | Costo operativo | Veredicto |
|---|---|---|---|
| Base por tenant | Máximo | Inviable con 10.000 MiPyMEs | ❌ |
| Schema por tenant | Alto | Migraciones × N schemas; `pg_dump` lento; catálogo enorme | ❌ para el core |
| **Fila con RLS** | Alto si se implementa bien | Una migración, un backup, un pool | ✅ |

Se elige **RLS compartido** con tres salvaguardas no negociables:

1. La app se conecta con `ocpos_app`, rol **sin** `BYPASSRLS` y que **no** es dueño de las tablas.
2. `FORCE ROW LEVEL SECURITY` en todas las tablas con `tenant_id`.
3. Un test de CI recorre `app.v_rls_coverage` y **falla el build** si alguna tabla con `tenant_id` quedó sin policy.

El campo `tenants.isolation_mode` deja la puerta abierta a promover un cliente Enterprise a base dedicada reusando el mismo DDL, sin refactor.

### Frontend: **Next.js 15 (PWA) primero, Flutter después**

El hardware real de una MiPyME en LatAm es una tablet Android de gama baja o el teléfono del dueño. Una PWA instalable:

- se distribuye sin fricción de app store (crítico para iterar semanalmente),
- comparte el 100 % del dominio con el backend,
- funciona en el desktop de la caja sin construir un cliente Electron.

Flutter entra en la **Fase 4** para el cliente móvil nativo, cuando la superficie de negocio esté estable y el driver sea el acceso a hardware (impresora Bluetooth nativa, cámara, NFC). El backend no cambia.

### Otros componentes

| Pieza | Elección | Motivo |
|---|---|---|
| Cache y locks | Redis 7 | Config efectiva, rate limit, locks de arqueo |
| Colas | BullMQ | WhatsApp, e-factura, forecasting, reportes |
| Almacenamiento | S3 / Cloudflare R2 | Imágenes, PDFs, adjuntos |
| Persistencia local | RxDB + Dexie (IndexedDB) | Ver [02-SYNC-OFFLINE](02-SYNC-OFFLINE.md) |
| Observabilidad | OpenTelemetry + Grafana | Traza con `tenant_id` en el baggage |
| Auth | JWT corto + refresh rotativo, PIN local | Cambio rápido de cajero sin re-login |

---

## 2. Arquitectura limpia — capas y regla de dependencia

```
┌────────────────────────────────────────────────────────────┐
│  interface/    controllers HTTP, WS, jobs, CLI             │
│                ↓ depende de                                │
│  application/  casos de uso, orquestación, transacciones   │
│                ↓ depende de                                │
│  domain/       entidades, value objects, reglas puras      │
│                ↑ NO depende de nada externo                │
│  infrastructure/  repositorios Drizzle, WhatsApp, Stripe   │
│                ↑ implementa los puertos de domain          │
└────────────────────────────────────────────────────────────┘
```

`domain/` no importa NestJS, ni Drizzle, ni `fetch`. Es TypeScript puro y testeable sin base de datos — y es exactamente lo que se empaqueta en `packages/core-domain` para que corra en el navegador.

### Monolito modular, no microservicios

Un solo despliegue con módulos de frontera clara (`sales`, `inventory`, `credit`, `agro`, `fiscal`…). Se comunican por **eventos de dominio en proceso**, nunca importando repositorios ajenos. Cuando un módulo justifique escalado independiente, la extracción es mecánica porque la frontera ya existe.

Microservicios desde el día uno con un equipo pequeño es cómo se muere un SaaS antes de la primera venta.

---

## 3. Multi-tenancy en la práctica

Cada request atraviesa este pipeline:

```
1. AuthGuard          → valida JWT, extrae identity_id
2. TenantResolver     → resuelve tenant por subdominio / header / claim
3. MembershipGuard    → verifica platform.tenant_memberships activa
4. TenantContext      → abre transacción y ejecuta:
                          SET LOCAL app.tenant_id = '…';
                          SET LOCAL app.user_id   = '…';
                          SET LOCAL app.branch_id = '…';
5. PermissionGuard    → @RequirePermission('sales.void') contra el RBAC efectivo
6. PlanLimitGuard     → verifica límites del plan (usuarios, sucursales, SKU)
7. Handler            → caso de uso
8. AuditInterceptor   → escribe app.audit_logs si la acción es auditable
```

Si el paso 4 falla, **RLS devuelve cero filas**. Un bug en un repositorio no es una fuga de datos entre negocios: es una lista vacía.

---

## 4. Seguridad

- Contraseñas: **Argon2id**. PIN de cajero: Argon2id con pepper por tenant.
- Secretos de terceros (`provider_config`, `mfa_secret`): cifrados con **pgcrypto** usando una clave por tenant derivada de KMS.
- Auditoría con **cadena de hash SHA-256**; `REVOKE UPDATE, DELETE` sobre las tablas append-only.
- Rate limiting por tenant y por IP en Redis.
- PII (`doc_number`, teléfonos) marcada en el catálogo de datos para soportar borrado por solicitud del titular.
- El backup incluye verificación semanal de `verify_audit_chain()` sobre una muestra de tenants.

---

## 5. Riesgos asumidos y mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Un `SET LOCAL` faltante filtra datos entre tenants | Crítico | Test de CI sobre `v_rls_coverage` + test que consulta con el rol de la app sin contexto y exige 0 filas (`.github/workflows/ci.yml`) |
| Crecimiento de `stock_events` (tabla más grande) | Alto en 2-3 años | Índice BRIN sobre `occurred_at` + archivado a `archive.stock_events` (ver abajo) |
| Crecimiento de `audit_logs` (sin techo) | Alto | **Particionada por mes**; retención por `DETACH PARTITION`, instantáneo |
| WhatsApp Business API: aprobación de plantillas | Bloqueante para cobranza | Solicitar plantillas en la Fase 1; fallback a `wa.me` con mensaje pre-cargado |
| Facturación electrónica difiere por país | Alto | Adaptador por país detrás de un puerto único; solo DO y CO en el primer año |
| RxDB en tablets viejas (Android 8, 2 GB RAM) | Medio | Presupuesto de 40 MB, sin históricos, pruebas en dispositivo real desde la Fase 1 |
| Costo del CPP mal calculado por orden de sync | Medio | Job de reproyección semanal con reporte de deriva |

---

### Por qué `stock_events` NO está particionada

Es una decisión deliberada y vale explicarla, porque la intuición dice lo contrario.

Particionar exige que la clave primaria **incluya la clave de partición**. En `stock_events` la PK es un UUID de una sola columna **generado en el dispositivo**, y esa unicidad global es exactamente lo que hace idempotente al sync: si una tablet reenvía el mismo push cinco veces, la PK absorbe los duplicados. Con una PK compuesta `(id, occurred_at)` esa garantía desaparece y un reintento con una marca de tiempo distinta descontaría el stock dos veces.

Correctitud antes que operación. La escala se resuelve más barato:

- **Índice BRIN** sobre `occurred_at`. En una tabla append-only con inserciones cronológicas, un BRIN ocupa kilobytes donde un B-tree ocuparía gigabytes, y responde igual de bien a los rangos de fecha que usan los reportes.
- **Archivado** a `archive.stock_events` con `app.archive_stock_events(fecha)`, una vez cerrado el período contable y respetando la retención fiscal del país.

`audit_logs` sí se particiona porque no la referencia ninguna FK y su identidad operativa es `(tenant_id, seq)`, no `seq` a secas: no pierde nada al añadir la clave de partición a la PK.

## 6. Documentos relacionados

- [01-ENGINE-NICHO.md](01-ENGINE-NICHO.md) — el motor de perfiles de negocio
- [02-SYNC-OFFLINE.md](02-SYNC-OFFLINE.md) — sincronización y conflictos
- [03-ESTRUCTURA-PROYECTO.md](03-ESTRUCTURA-PROYECTO.md) — árbol de carpetas
- [04-ROADMAP.md](04-ROADMAP.md) — plan por fases
- [`db/schema/`](../db/schema/) — DDL completo
- [`config/profiles/`](../config/profiles/) — manifiestos de nicho
