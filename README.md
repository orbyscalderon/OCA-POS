# OC POS

SaaS B2B de gestión y punto de venta para MiPyMEs. **El rubro que elige el cliente al registrarse configura el sistema entero**: qué pantallas ve, qué campos tiene cada producto, qué roles existen y qué alertas se activan.

> Este repo nació como **Turno**, la plataforma de reservas para barberías. Barbería sigue siendo uno de los rubros soportados: su motor de agenda es ahora el módulo `appointments`. El README original está en [docs/99-README-TURNO-ORIGINAL.md](docs/99-README-TURNO-ORIGINAL.md).

---

## La idea en una frase

Un software genérico te obliga a trabajar como el software. Aquí eliges tu rubro y el sistema se arma solo — sin plantillas, sin campos que no usas, sin desarrollo por cliente.

Una farmacia ve principio activo, lote y vencimiento. Una granja ve mortalidad y conversión alimenticia. Una barbería ve agenda por profesional. **Es el mismo código leyendo un archivo de configuración distinto.**

---

## Cómo está armado

```
backend/     API Express + TypeScript + Prisma        ← de Turno, en producción
frontend/    React + Vite (Cloudflare Pages)          ← de Turno, en producción
mobile/      Expo + React Native                      ← de Turno
db/          Esquema PostgreSQL, semillas y tests     ← fuente de verdad del modelo
config/      Manifiestos de rubro, permisos, módulos  ← el Engine de Nicho
docs/        Arquitectura, engine, sync offline, roadmap
tools/       Demo interactiva del Engine de Nicho
_legacy/     Proyectos anteriores en proceso de port  (no versionado)
```

### Los tres pilares

**1 · El rubro es configuración, no código.** [`config/profiles/`](config/profiles/) tiene 12 manifiestos. Cada uno declara sus campos, módulos, roles, alertas y layout de POS. Un rubro nuevo es un archivo JSON, no una versión del programa.

**2 · El inventario es un ledger, no un número.** `stock_events` guarda deltas inmutables. Dos cajas vendiendo sin internet **convergen al saldo correcto** sin importar el orden de sincronización, y ninguna venta se pierde.

**3 · El aislamiento lo impone la base de datos.** Row Level Security con `FORCE`, rol de aplicación sin `BYPASSRLS`. Una consulta sin contexto de negocio devuelve cero filas — es una barrera técnica, no una promesa.

---

## Módulos y de dónde sale cada uno

El manifiesto del rubro enciende o apaga cada módulo. Si está apagado, sus rutas **no se registran** y sus permisos ni aparecen.

| Módulo | Origen | Rubros | Estado |
|---|---|---|---|
| `pos` | Supermercado Silvia | 9/9 | Port pendiente |
| `credit` | OC Credit | 9/9 | Port pendiente |
| `customers` | OC Credit | 9/9 | Port pendiente |
| `cash` | OC Credit | 9/9 | Port pendiente |
| `employees` | **Turno** | 9/9 | En producción |
| `inventory` | Supermercado Silvia | 8/9 | Port pendiente |
| `storefront` | Supermercado Silvia | 8/9 | Port pendiente |
| `appointments` | **Turno** | 2/9 | En producción |
| `lending` | OC Credit | 1/9 | Port pendiente |
| `taxes` `expenses` `loyalty` `purchasing` `tables` `service_orders` `agro` | — | varía | Por construir |

Mapeo completo con archivos concretos: [`config/modules.json`](config/modules.json).

Además, **15 piezas de plataforma** ya vienen de Turno y funcionan: auth con JWT y refresh, RBAC, audit log, jobs, Stripe y Stripe Connect, WhatsApp, email, almacenamiento en Backblaze con CDN, i18n, landing, precios, superadmin, límites por plan, Vitest, Playwright y el despliegue completo.

---

## Puesta en marcha

### Verificar el modelo de datos — sin Docker, sin servidor

```bash
npm ci
npm run check
```

Valida los 12 manifiestos, regenera las semillas, aplica los 20 archivos de esquema y corre **105 aserciones** sobre PostgreSQL real (PGlite, compilado a WASM). Tarda unos 30 segundos.

### Ver el Engine de Nicho funcionando

```bash
npm run demo          # http://localhost:5173
npm run demo:check    # verificación con navegador real
```

Elige un rubro y observa cómo cambia todo: navegación, campos, layout del POS, roles. Puedes cobrar de verdad y ver el inventario bajar.

### Levantar la aplicación

```bash
docker compose up -d           # PostgreSQL local
npm run backend:dev            # API en :4000
npm run frontend:dev           # app en :5173
```

Detalle completo en [docs/99-README-TURNO-ORIGINAL.md](docs/99-README-TURNO-ORIGINAL.md).

---

## Despliegue

Ya resuelto y documentado: **Supabase** (PostgreSQL) · **Railway** (API + jobs) · **Cloudflare Pages** (frontend + CDN) · **Backblaze B2** (imágenes).

- [DEPLOY-RAILWAY-SUPABASE-CLOUDFLARE.md](DEPLOY-RAILWAY-SUPABASE-CLOUDFLARE.md)
- [GO-LIVE.md](GO-LIVE.md)

⚠️ **Una regla que no se rompe:** el esquema SQL de `db/schema/` es la fuente de verdad. Prisma se genera con `prisma db pull`, **nunca** con `prisma migrate` — Migrate destruiría los triggers, las políticas RLS y las particiones de auditoría.

---

## Documentación

| Documento | Contenido |
|---|---|
| [docs/00-ARQUITECTURA.md](docs/00-ARQUITECTURA.md) | Multi-tenancy con RLS, arquitectura, seguridad, riesgos |
| [docs/01-ENGINE-NICHO.md](docs/01-ENGINE-NICHO.md) | Cómo un JSON transforma la base de datos y la interfaz |
| [docs/02-SYNC-OFFLINE.md](docs/02-SYNC-OFFLINE.md) | Offline-first, ledgers conmutativos, conflictos |
| [docs/03-ESTRUCTURA-PROYECTO.md](docs/03-ESTRUCTURA-PROYECTO.md) | Árbol de carpetas objetivo |
| [docs/04-ROADMAP.md](docs/04-ROADMAP.md) | Plan por fases |

---

## Estado

| | |
|---|---|
| Modelo de datos | ✅ 130 tablas, 9 vistas, 121 policies RLS · 105/105 tests |
| Manifiestos de rubro | ✅ 12 válidos, 140 permisos, 16 módulos registrados |
| Plataforma (auth, pagos, jobs, deploy) | ✅ En producción desde Turno |
| Módulo `appointments` | ✅ En producción |
| Módulos `pos` `credit` `inventory` `storefront` `cash` | ⬜ Port desde `_legacy/` |
| Conectar el Engine de Nicho al backend real | ⬜ **Siguiente paso** |
