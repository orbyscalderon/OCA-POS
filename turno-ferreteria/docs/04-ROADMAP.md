# Roadmap de Desarrollo

## Nota previa sobre el plazo

El brief pide "MVP en 4 semanas hasta producción". **Cuatro semanas alcanzan para un MVP en producción con clientes reales, pero no para el alcance completo descrito** (Agro Engine + facturación electrónica + e-commerce + fidelización + WhatsApp API). Intentar todo en 4 semanas produce un sistema que hace 12 cosas a medias — y en un POS, "a medias" significa que alguien no puede cobrar.

El plan de abajo entrega en la **semana 4 un producto que un colmado o un vape shop puede usar para operar su día completo y por el que puede pagar**. El resto se apila encima sin refactor, porque el modelo de datos ya lo contempla.

**Supuestos:** 1 tech lead + 2 full-stack senior + 1 diseñador a medio tiempo. Con un solo desarrollador, multiplicar por 2.5.

---

## Fase 0 — Fundaciones (Semana 0, 5 días)

Antes de la primera pantalla. Si esto se salta, se paga con intereses en la semana 6.

Buena parte ya está escrita; lo que falta es ejecutarla y montar el andamiaje de aplicación.

| Entregable | Estado |
|---|---|
| DDL completo (`db/schema/`, 20 archivos) | ✅ escrito |
| Semillas: países, impuestos, 140 permisos, planes, plantillas, 9 perfiles | ✅ escritas |
| Tests: 105 aserciones (`db/tests/`) | ✅ escritas y **pasando** |
| Workflow de CI (`.github/workflows/ci.yml`) | ✅ escrito, matriz PG 15/16/17 |
| **Esquema aplicado en PostgreSQL real** | ✅ verificado sobre PG 18.3 (PGlite) |
| Confirmar en PostgreSQL 15/16/17 nativo (`./db/verify.sh`) | ⬜ **primer paso** |
| Monorepo: pnpm + Turborepo, tsconfig, ESLint, Prettier, Husky | ⬜ |
| Migraciones con drizzle-kit sobre `db/migrations/` | ⬜ |
| Infra: Postgres gestionado, Redis, S3/R2, wildcard `*.ocpos.app` | ⬜ |
| Observabilidad: OpenTelemetry con `tenant_id` en el baggage, Sentry | ⬜ |
| Deploy a staging | ⬜ |

**Definición de hecho:** el CI en verde con sus cinco barreras (manifiestos válidos, semillas al día, esquema aplicado, RLS sin fugas, ledger conmutativo e inmutable) y un tenant semilla creado por script.

---

## Fase 1 — MVP vendible (Semanas 1–4)

**Objetivo:** un negocio real opera su día completo — abre caja, vende, fía, cierra caja — y paga por ello.

**Perfiles en el MVP:** `vape_shop`, `colmado`, `barberia`. Tres nichos suficientemente distintos para validar que el engine funciona.

### Semana 1 — Núcleo y catálogo

- Auth: registro, login, JWT + refresh, PIN de cajero
- Multi-tenant: resolución por subdominio, `TenantContext`, guards
- **Engine de Nicho v1**: manifiesto, resolver, `ProvisionTenantUseCase`
- Onboarding: elegir rubro → sistema preconfigurado en < 3 min
- Catálogo: productos, variantes, `DynamicForm` leyendo `attribute_definitions`
- Ledger de inventario con CPP

**Hito:** crear un tenant "Vape Shop", ver el formulario de producto con sabor y nicotina *sin una línea de código específica de vapes*.

### Semana 2 — POS que cobra

- Pantalla de POS con layout `grid_with_images` y `service_first`
- Carrito, múltiples métodos de pago, cambio, descuentos con permiso
- Motor de impuestos (inclusive/exclusive) en `core-domain`
- Escáner de código de barras (HID + Bluetooth)
- Impresión térmica ESC/POS por WebBluetooth y WebUSB
- Caja: apertura, arqueo por denominación, cierre con descuadre

**Hito:** venta completa con ticket impreso en una impresora térmica física.

### Semana 3 — Fiado y offline

- **Fiado (`open_account`)**: cliente, límite, venta a crédito, abonos, libreta
- Vista de antigüedad de saldos y tablero de cobranza
- **Offline v1**: RxDB, replicación de productos/clientes/saldos
- Outbox local, push idempotente, pull incremental por `sync_seq`
- Detección de sobreventa y tablero de conflictos
- RBAC: 4 roles operativos, permisos granulares, PIN de supervisor
- **Auditoría con cadena de hash**

**Hito:** cortar el WiFi, hacer 20 ventas y 3 fiados, reconectar, todo cuadra.

### Semana 4 — Reportes, endurecimiento y salida a producción

- Dashboard: ventas del día, ticket promedio, top productos, margen bruto
- P&L diario, gastos operativos, horas pico
- Alertas de stock mínimo
- Suscripciones y límites de plan
- Pruebas de carga (100 tenants, 50 ventas/min)
- Pruebas en tablet Android real de gama baja
- **Piloto con 3 negocios reales**

**Hito de la Fase 1:** tres negocios operando su día completo sin nuestra intervención.

### Fuera del MVP (deliberadamente)

Facturación electrónica · Agro Engine · e-commerce · fidelización · WhatsApp API · multi-sucursal · citas · mesas · Flutter · pronóstico de demanda.

---

## Fase 2 — Producto completo de gestión (Semanas 5–10)

| Semana | Entregable |
|---|---|
| 5–6 | **Fiscal**: impuestos por país, tipos de comprobante, folios con bloques por dispositivo, modo contingencia. Facturación electrónica **DGII (República Dominicana)** como primera integración |
| 6–7 | **Compras y CXP**: proveedores, órdenes de compra, recepciones parciales, facturas y pagos a proveedor |
| 7–8 | **WhatsApp Business API**: plantillas aprobadas, envío de facturas, recordatorios de cobro, links de pago (Stripe + una pasarela local) |
| 8–9 | **Crédito avanzado**: cronogramas, interés (flat/simple/francés), mora diaria, perfil `prestamista` completo |
| 9–10 | **Multi-sucursal**: transferencias con almacén de tránsito, alcance por sucursal, conteos cíclicos, consolidado |

**Hito:** un negocio con 3 sucursales factura electrónicamente y cobra su cartera por WhatsApp.

---

## Fase 3 — Agro Engine (Semanas 11–16)

El módulo que abre un mercado sin competencia digital real en LatAm.

| Semana | Entregable |
|---|---|
| 11 | **Multi-UoM**: dimensiones, conversiones por producto, presentaciones, integración con balanza (WebSerial + códigos de peso embebido) |
| 12 | **Lotes biológicos**: alta de lote, unidades productivas (galpones), ledger de población, perfil `granja_avicola` |
| 13 | **Registro diario**: formulario táctil offline — mortalidad por causa, alimento, pesaje, producción de huevos |
| 14 | **Costeo**: imputación de insumos al lote, mano de obra y gastos por centro de costo, costo por animal vivo, **FCR** |
| 15 | **Faena y cosecha**: conversión de población en SKU vendibles, reparto de costo por peso, **costo real por kg producido** |
| 16 | **Sanidad e inteligencia**: calendario de vacunación, alertas de mortalidad y desvío de FCR, comparación contra estándar de línea genética, reporte de cierre de lote |

**Hito:** una granja de 5.000 pollos cierra un ciclo completo de 42 días y obtiene su costo real por libra.

Perfiles adicionales: `granja_porcina`, `piscicultura`, `ganaderia_leche`.

---

## Fase 4 — Multicanalidad y crecimiento (Semanas 17–24)

| Semanas | Entregable |
|---|---|
| 17–18 | **Tienda online automática**: catálogo por tenant sincronizado en vivo, checkout por WhatsApp o pasarela, zonas de entrega |
| 19–20 | **Fidelización**: puntos, cashback, sellos, segmentos dinámicos, campañas |
| 21–22 | **Modos operativos restantes**: citas con anti-solape, mesas y comandas, órdenes de servicio, asistencia y comisiones |
| 23–24 | **App Flutter**: cliente móvil nativo con impresión Bluetooth nativa y cámara |

---

## Fase 5 — Escala e inteligencia (Meses 7–12)

- **Pronóstico de demanda** (`services/forecaster`): reabastecimiento y PO automáticas
- Facturación electrónica de Colombia (DIAN) y México (SAT)
- Archivado de `stock_events` a `archive.*` y retención por `DETACH PARTITION` en `audit_logs`; réplica de lectura para BI
- Marketplace de perfiles: consultores de rubro publican manifiestos
- API pública y webhooks
- Motor de reglas visual para automatizaciones sin código

---

## Criterios de calidad transversales

Aplican a **toda** fase; no son un sprint aparte.

| Criterio | Umbral |
|---|---|
| Cobertura de tests en `core-domain` | ≥ 90 % (es dinero) |
| Test de RLS en CI | Bloqueante |
| Validación de manifiestos contra JSON Schema | Bloqueante |
| Tiempo de cobro (escanear → ticket impreso) | < 3 s |
| Arranque en frío de la PWA en Android de gama baja | < 4 s |
| Tamaño de IndexedDB | < 40 MB |
| Reproyección de ledgers sin deriva | Job semanal, alerta ante cualquier diferencia |
| `verify_audit_chain()` sobre muestra de tenants | Semanal |

---

## Secuencia de riesgo

Lo que se ataca temprano por ser caro de arreglar tarde:

1. **RLS** (Fase 0) — una fuga entre tenants mata el producto
2. **Ledgers conmutativos** (Semanas 1 y 3) — cambiar el modelo de stock después es reescribir el sistema
3. **Bloques de folios por dispositivo** (Fase 2) — un error fiscal es responsabilidad legal
4. **Manifiesto del perfil** (Semana 1) — su formato es el contrato de todos los nichos futuros
5. **Hardware real** (Semana 2, no la 4) — impresoras y balanzas siempre tienen sorpresas
