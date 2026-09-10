# Estructura del Proyecto

Monorepo con **pnpm workspaces + Turborepo**. La razón de ser del monorepo es `packages/core-domain`: el motor de precios e impuestos que se ejecuta idéntico en el servidor y en el cliente offline.

```
oc-pos/
├── apps/
│   ├── api/                 # Backend NestJS
│   ├── web/                 # PWA Next.js (POS + back office)
│   ├── storefront/          # Tienda online multi-tenant
│   ├── admin/               # Back office de la plataforma (interno)
│   └── mobile/              # Flutter — Fase 4
├── packages/
│   ├── core-domain/         # ★ Dominio puro compartido
│   ├── profile-engine/      # ★ Manifiestos y resolución de config
│   ├── contracts/           # Esquemas Zod + tipos DTO
│   ├── sync-client/         # Motor de sync del navegador
│   ├── escpos/              # Generación de comandos de impresora térmica
│   ├── ui/                  # Design system
│   └── config/              # tsconfig, eslint, tailwind compartidos
├── services/
│   ├── forecaster/          # Worker Python de pronóstico de demanda
│   └── einvoice/            # Adaptadores de facturación electrónica por país
├── db/
│   ├── schema/              # DDL (fuente de verdad del modelo)
│   ├── migrations/          # Migraciones versionadas (drizzle-kit)
│   └── seeds/               # Países, impuestos, permisos, perfiles
├── config/
│   ├── profiles/            # ★ Manifiestos de nicho (JSON)
│   └── schemas/             # JSON Schema que valida los manifiestos
├── infra/                   # Terraform, Docker, CI/CD
└── docs/
```

---

## Backend — `apps/api/`

Arquitectura limpia dentro de cada módulo. La regla: `domain/` no importa nada de infraestructura.

```
apps/api/src/
├── main.ts
├── app.module.ts
│
├── shared/
│   ├── tenancy/
│   │   ├── tenant-context.service.ts     # AsyncLocalStorage con tenant/user/branch
│   │   ├── tenant.middleware.ts          # resuelve por subdominio/header
│   │   └── rls-transaction.ts            # ★ abre tx + SET LOCAL app.tenant_id
│   ├── rbac/
│   │   ├── require-permission.decorator.ts
│   │   ├── permission.guard.ts
│   │   └── permission-resolver.service.ts # rol + extras − revocados
│   ├── audit/
│   │   ├── audit.interceptor.ts          # escribe audit_logs automáticamente
│   │   └── auditable.decorator.ts        # @Auditable({ action, severity })
│   ├── plan-limits/
│   ├── events/                           # bus de eventos de dominio en proceso
│   ├── errors/
│   └── money/                            # aritmética decimal, jamás float
│
├── modules/
│   ├── identity/            # auth, identidades, membresías, sesiones, devices
│   ├── tenancy/             # tenants, sucursales, almacenes, planes
│   ├── profiles/            # ★ ENGINE DE NICHO
│   │   ├── domain/
│   │   │   ├── manifest.schema.ts        # Zod del manifiesto
│   │   │   └── config-resolver.ts        # merge profundo de las 4 capas
│   │   ├── application/
│   │   │   ├── provision-tenant.usecase.ts   # siembra al elegir rubro
│   │   │   ├── switch-profile.usecase.ts
│   │   │   └── upgrade-profile-version.usecase.ts
│   │   └── interface/profiles.controller.ts  # GET /config/effective
│   ├── catalog/             # productos, variantes, atributos dinámicos, UoM
│   │   └── domain/
│   │       ├── attribute-validator.ts    # manifiesto → validador runtime
│   │       ├── variant-generator.ts      # producto cartesiano de ejes
│   │       └── uom-converter.ts
│   ├── inventory/           # ledger de stock, CPP, transferencias, conteos
│   │   └── domain/
│   │       ├── stock-ledger.ts           # ★ el corazón conmutativo
│   │       └── weighted-average-cost.ts
│   ├── sales/               # POS, ventas, pagos, devoluciones, promociones
│   ├── credit/              # ★ fiado, CXC, cronogramas, mora, cobranza
│   │   └── domain/
│   │       ├── interest-calculator.ts    # flat, simple, francés
│   │       ├── late-fee-engine.ts
│   │       └── amortization-schedule.ts
│   ├── agro/                # ★ AGRO ENGINE
│   │   ├── domain/
│   │   │   ├── lot-costing.ts            # costo por animal vivo / por kg
│   │   │   ├── fcr-calculator.ts         # conversión alimenticia
│   │   │   ├── mortality-tracker.ts
│   │   │   └── harvest-allocator.ts      # reparto de costo a los productos
│   │   └── application/
│   │       ├── record-daily.usecase.ts   # registro diario → eventos + costos
│   │       ├── consume-input.usecase.ts  # stock_event + biological_cost
│   │       └── post-harvest.usecase.ts   # faena → SKU vendibles
│   ├── purchasing/          # proveedores, PO, recepciones, CXP, reabastecimiento
│   ├── finance/             # caja, arqueo, gastos, P&L, cuentas financieras
│   ├── fiscal/              # impuestos, comprobantes, folios, e-factura
│   │   └── domain/
│   │       ├── tax-engine.ts             # inclusive/exclusive, compuestos
│   │       └── fiscal-sequence.ts        # bloques por dispositivo
│   ├── crm/                 # clientes, fidelización, segmentos, campañas
│   ├── operations/          # citas, mesas, órdenes de servicio, empleados
│   ├── storefront/          # tienda online, pedidos, zonas de entrega
│   ├── sync/                # ★ push/pull, idempotencia, conflictos
│   ├── messaging/           # WhatsApp API, plantillas, outbox
│   ├── analytics/           # dashboards, KPIs, exportaciones
│   └── health/
│
├── infrastructure/
│   ├── database/
│   │   ├── drizzle/schema/           # espejo tipado del DDL
│   │   ├── connection.factory.ts
│   │   └── repositories/
│   ├── cache/
│   ├── queue/                        # BullMQ
│   ├── storage/
│   └── integrations/
│       ├── whatsapp/
│       ├── payments/                 # stripe, azul, wompi, mercadopago
│       └── einvoice/                 # dgii-do, dian-co, sat-mx
│
└── jobs/
    ├── accrue-interest.job.ts        # devengo diario de interés y mora
    ├── collection-reminders.job.ts   # cobranza por WhatsApp
    ├── expiry-alerts.job.ts
    ├── agro-daily-check.job.ts       # alerta de registro diario faltante
    ├── reproject-ledgers.job.ts      # reconstrucción y detección de deriva
    └── verify-audit-chain.job.ts
```

---

## Frontend — `apps/web/`

```
apps/web/src/
├── app/
│   ├── (auth)/{login,onboarding}/
│   ├── (app)/
│   │   ├── pos/             # ★ punto de venta
│   │   ├── inventario/
│   │   ├── fiado/
│   │   ├── clientes/
│   │   ├── lotes/           # Agro — visible solo si modules.agro.enabled
│   │   ├── agenda/          # Citas — visible solo si modules.appointments
│   │   ├── mesas/
│   │   ├── compras/
│   │   ├── caja/
│   │   ├── reportes/
│   │   └── ajustes/
│   └── api/
│
├── components/
│   ├── dynamic/             # ★ RENDERIZADO DIRIGIDO POR CONFIGURACIÓN
│   │   ├── DynamicForm.tsx          # lee attribute_definitions → formulario
│   │   ├── DynamicField.tsx         # ui_widget → componente
│   │   ├── DynamicFilters.tsx
│   │   ├── DynamicTable.tsx
│   │   └── widget-registry.ts       # mapa ui_widget → React component
│   ├── layout/Nav.tsx               # ui.navigation, cero condicionales
│   └── ui/
│
├── features/
│   ├── pos/
│   │   ├── layouts/                 # ★ un layout por modo operativo
│   │   │   ├── GridWithImages.tsx   # vape shop, retail
│   │   │   ├── WeightFirst.tsx      # granja, carnicería, supermercado
│   │   │   ├── ServiceFirst.tsx     # barbería, spa
│   │   │   ├── SearchFirst.tsx      # farmacia, ferretería
│   │   │   └── TablesLayout.tsx     # restaurante
│   │   ├── layout-registry.ts
│   │   ├── hooks/{useCart,useScanner,useScale,usePrinter}.ts
│   │   └── components/
│   ├── agro/
│   │   ├── DailyRecordForm.tsx      # formulario grande, táctil, offline
│   │   ├── LotDashboard.tsx
│   │   ├── MortalityChart.tsx
│   │   ├── FcrGauge.tsx
│   │   └── HarvestWizard.tsx
│   ├── credit/{CreditBook,PaymentSchedule,CollectionBoard}.tsx
│   ├── inventory/ · sales/ · reports/ · settings/
│
├── lib/
│   ├── profile/
│   │   ├── ProfileProvider.tsx      # ★ contexto del manifiesto
│   │   ├── useProfileConfig.ts
│   │   ├── useModule.ts             # useModule('agro').enabled
│   │   └── useAttributes.ts
│   ├── db/                          # RxDB: colecciones, esquemas, migraciones
│   ├── sync/                        # cliente del motor de sync (Web Worker)
│   ├── hardware/
│   │   ├── printer/                 # WebBluetooth + WebUSB → ESC/POS
│   │   ├── scanner/                 # HID keyboard-wedge y Bluetooth
│   │   └── scale/                   # WebSerial, protocolos CAS/Toledo
│   ├── rbac/{can.ts,PermissionGate.tsx}
│   └── money/
│
└── workers/sync.worker.ts
```

---

## Paquetes compartidos clave

### `packages/core-domain/` — el que justifica el monorepo

```
core-domain/src/
├── pricing/       # lista de precios, descuentos por volumen, promociones
├── tax/           # inclusive/exclusive, compuestos, exenciones, redondeo
├── credit/        # interés, mora, amortización
├── inventory/     # aplicación de deltas, CPP, FEFO
├── uom/           # conversión multidimensional
├── agro/          # FCR, mortalidad, reparto de costo de faena
└── validation/    # manifiesto → esquema Zod
```

Sin dependencias de I/O. El mismo `calculateSaleTotals()` corre en el servidor y en la tablet sin internet. **Un ticket impreso offline y el registro en la nube no pueden diferir en un centavo.**

### `packages/profile-engine/`

```
profile-engine/src/
├── manifest.schema.ts     # Zod del manifiesto (fuente de verdad del formato)
├── resolver.ts            # merge: defaults ← manifest ← tenant ← branch
├── provisioner.ts         # manifiesto → sentencias de siembra
├── migrator.ts            # actualización de versión de perfil
└── profiles/              # los JSON, embebidos en el build
```

Los tests de este paquete cargan cada JSON de `config/profiles/` y verifican que cumpla el schema. Un manifiesto mal formado **rompe el build**, no la producción.
