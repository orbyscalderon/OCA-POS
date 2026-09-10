# Engine de Nicho Dinámico

El diferenciador del producto. Explica cómo un mismo binario atiende a una tienda de vapes, una barbería y una granja avícola sin una sola rama `if (negocio === 'X')` en el código de dominio.

---

## 1. El principio: configuración como dato, no como código

La regla que gobierna todo el sistema:

> **Ninguna característica de nicho vive en el código. Toda característica de nicho vive en una fila de base de datos que el código sabe interpretar.**

Un competidor típico (incluida Treinta) construye "modo tienda", "modo restaurante" y "modo servicios" como tres productos internos que comparten login. Cada nicho nuevo cuesta un sprint. Aquí el nicho nuevo cuesta **un archivo JSON**.

Tres capas, de lo genérico a lo específico:

| Capa | Dónde vive | Quién la escribe | Ejemplo |
|---|---|---|---|
| **Kernel** | Código TypeScript/Python | Nosotros, una vez | "Una venta tiene líneas, las líneas descuentan stock, el stock es un ledger" |
| **Manifiesto de perfil** | `platform.business_profile_versions.manifest` (JSONB) | Nosotros, por nicho | "Un vape tiene sabor y nicotina; una granja tiene galpón y mortalidad" |
| **Overrides del tenant** | `platform.tenants.config_overrides` (JSONB) | El dueño del negocio | "Yo no uso fiado" / "Mi comisión es 45%, no 40%" |

La configuración efectiva es un **merge profundo**: `kernel_defaults ← manifest ← tenant_overrides ← branch_settings`. Se resuelve una vez por sesión y se cachea (Redis, TTL 5 min, invalidado por evento).

---

## 2. Anatomía del manifiesto

Un perfil (`config/profiles/*.json`) declara diez bloques. Cada bloque alimenta una parte distinta del sistema:

```
manifest
├── profile          → identidad y modo primario
├── modules          → qué se enciende (feature flags con forma)
├── operation_modes  → qué layouts de POS existen
├── uoms             → unidades de medida a sembrar
├── categories       → árbol inicial de categorías
├── attributes       → ★ campos dinámicos por entidad
├── product_defaults → banderas por defecto al crear productos
├── ui               → navegación, layout de POS, formularios, widgets
├── receipt          → plantilla de ticket ESC/POS
├── roles            → RBAC preconfigurado del nicho
├── automations      → jobs y alertas activas
└── reports          → reportes visibles en el menú
```

### El bloque que hace la magia: `attributes`

```json
{
  "key": "nicotine_mg",
  "label": "Nivel de nicotina",
  "data_type": "enum",
  "ui_widget": "segmented",
  "unit_suffix": "mg",
  "is_variant_axis": true,
  "is_filterable": true,
  "show_in_pos": true,
  "semantic_role": "potency",
  "options": [{ "value": "50", "label": "50 mg (5%)" }],
  "validation": { "required": true },
  "applies_to_categories": ["desechables", "liquidos"]
}
```

Al hacer onboarding, el `ProfileProvisioner` inserta esto en `app.attribute_definitions`. Desde ese momento:

| Campo del manifiesto | Efecto en el sistema |
|---|---|
| `data_type` + `validation` | Se compila a un esquema **Zod** (frontend) y **Valibot/Pydantic** (backend). Misma fuente, dos validadores. |
| `ui_widget` + `ui_group` | El `<DynamicForm>` decide qué componente montar y en qué acordeón. |
| `is_variant_axis` | El generador de SKU produce el producto cartesiano: 6 sabores × 5 nicotinas = 30 variantes con un clic. |
| `is_filterable` | Aparece como chip de filtro en el POS y como faceta en la tienda online. |
| `show_in_pos` | Se pinta en la tarjeta del producto en la grilla de cobro. |
| `show_in_receipt` | Se imprime en el ticket ESC/POS. |
| `semantic_role` | **Dispara comportamiento del kernel**, no solo dato. Ver abajo. |

### `semantic_role`: cuando un atributo cambia la lógica

Un atributo con `semantic_role` no es decorativo — le dice al kernel que active una máquina de estados:

| Rol | Lo que enciende |
|---|---|
| `expiry` | Fuerza `products.track_expiry = true`, activa picking FEFO, genera alertas `near_expiry` a 7/3/1 días |
| `batch` | Fuerza `track_lots = true`, exige lote en cada recepción y en cada venta, habilita trazabilidad y retiro de mercado |
| `serial` | Fuerza `track_serials = true`, exige escanear serie individual, habilita garantía y RMA |
| `weight` | Habilita el lector de balanza y las reglas `scale_barcode_rules` |
| `potency` | Se incluye en advertencias legales del ticket |

Así, "Farmacia" y "Granja" no comparten código de caducidad porque alguien lo programó dos veces: comparten el kernel FEFO porque ambos declararon `semantic_role: "expiry"`.

---

## 3. Cómo se transforma la BASE DE DATOS

**No hay migración de esquema por tenant.** Las tablas son las mismas; lo que cambia es el contenido de las columnas `jsonb` y las banderas de comportamiento.

### Mismo `INSERT`, dos negocios

```sql
-- VAPE SHOP
INSERT INTO app.products
  (tenant_id, category_id, name, kind, base_uom_id,
   track_lots, track_expiry, track_serials, age_restricted, attributes)
VALUES
  ($vape_tenant, $cat_desechables, 'Elf Bar BC5000', 'good', $uom_und,
   false, false, false, true,
   '{"flavor":"mango_ice","nicotine_mg":50,"puffs":5000,
     "volume_ml":13,"battery_mah":650}');

-- GRANJA AVÍCOLA
INSERT INTO app.products
  (tenant_id, category_id, name, kind, base_uom_id,
   track_lots, track_expiry, track_serials, is_weighted, attributes)
VALUES
  ($farm_tenant, $cat_carne, 'Pollo entero fresco', 'good', $uom_kg,
   true, true, false, true,
   '{"especie":"broiler","presentacion":"entero","dias_vida_util":5}');
```

Misma tabla. Distinto universo.

### Consultas por atributo dinámico, con índice

El índice GIN `products_attributes_gin` hace que esto sea rápido sin columnas dedicadas:

```sql
-- "Muéstrame todos los desechables de 50mg con más de 5000 puffs"
SELECT * FROM app.products
 WHERE attributes @> '{"nicotine_mg":50}'
   AND (attributes->>'puffs')::int > 5000;

-- "Lotes de pollo Cobb 500 en el galpón 3"
SELECT * FROM app.biological_lots
 WHERE attributes @> '{"linea_genetica":"cobb_500","galpon":"GALPON-3"}';
```

### Lo que cambia realmente entre perfiles

| Elemento | Vape Shop | Granja Avícola |
|---|---|---|
| Filas en `attribute_definitions` | 8 en scope `product`, 2 en `customer` | 7 en `product`, 2 en `inventory_lot`, 5 en `biological_lot`, 4 en `biological_daily`, 2 en `customer` |
| `products.track_lots` por defecto | `false` | `true` |
| `products.is_weighted` por defecto | `false` | `true` |
| UoMs sembradas | UND, CAJA, ML, L | UND, DOC, CARTÓN, CUBETA, KG, G, LB, QQ, SACO, TON |
| Tablas efectivamente usadas | `product_variants` (30+ SKU por producto), `serials` | `biological_lots`, `biological_events`, `biological_costs`, `harvests`, `uom_conversions`, `scale_barcode_rules` |
| Tablas presentes pero vacías | `biological_*`, `appointments`, `tables` | `appointments`, `tables`, `loyalty_*` |
| Roles creados | admin, cajero, inventariador, contador | admin, **galponero**, **veterinario**, cajero, contador |
| Alertas activas | `low_stock`, `dead_stock` | `high_mortality`, `fcr_deviation`, `feed_stock`, `near_expiry` |

---

## 4. Cómo se transforma la INTERFAZ

El frontend **no conoce ningún nicho**. Al montar la app pide `GET /api/v1/config/effective` y recibe el manifiesto resuelto. Todo se renderiza desde ahí.

### Navegación

```tsx
// apps/web/src/components/layout/Nav.tsx — el archivo completo, sin condicionales de nicho
const { ui } = useProfileConfig();
return ui.navigation.map(item => <NavLink key={item.key} {...item} />);
```

Vape shop ve `Vender · Inventario · Fiado · Clientes · Reportes · Mi Tienda`.
Granja ve `Mis Lotes · Registro Diario · Vender · Insumos · Fiado · Costos · Reportes`.
Mismo componente.

### El POS

`ui.pos.layout` selecciona el layout registrado:

| `layout` | Perfil | Cómo se ve |
|---|---|---|
| `grid_with_images` | Vape Shop | Grilla táctil con foto, chips de sabor/nicotina arriba, botón de escáner grande |
| `weight_first` | Granja | Pantalla con lectura de balanza en tipografía gigante, selector de UoM (LB/KG/QQ), cliente obligatorio |
| `service_first` | Barbería | Lista de servicios con duración, selector de profesional obligatorio por línea, presets de propina |
| `search_first` | Farmacia | Buscador dominante con autocompletado por principio activo |

```tsx
// apps/web/src/features/pos/POSScreen.tsx
const { ui } = useProfileConfig();
const Layout = POS_LAYOUTS[ui.pos.layout] ?? POS_LAYOUTS.grid_with_images;
return <Layout config={ui.pos} />;
```

Añadir un layout nuevo es registrar una entrada en `POS_LAYOUTS`. Nada más toca.

### Formularios

`<DynamicForm scope="product" categoryId={...} />` consulta `attribute_definitions`, agrupa por `ui_group`, ordena por `position`, mapea `ui_widget → componente` y construye el esquema Zod al vuelo. El formulario de producto de una granja y el de un vape shop son **la misma instancia del mismo componente** con datos distintos.

### Comparación lado a lado

| Aspecto | 🌬️ Vape Shop | 🐔 Granja Avícola |
|---|---|---|
| Pantalla de inicio | Grilla de productos con foto | Tarjetas de lotes activos con curva de mortalidad |
| Acción primaria del POS | Escanear código de barras | Leer peso de la balanza |
| Selector de producto | Matriz sabor × nicotina en modal | Lista con selector de unidad (LB / KG / QQ / cartón) |
| Cliente en la venta | Opcional | **Obligatorio** (mayoreo, se fía) |
| Campo estrella del formulario | Nivel de nicotina | Galpón y línea genética |
| Pantalla diaria del operario | — | **Registro diario**: bajas, alimento, peso, huevos |
| KPI principal del dashboard | Margen bruto y rotación | **FCR vs objetivo** y costo por kg |
| Alerta crítica | Stock bajo de sabor top | **Mortalidad diaria > 0.5 %** |
| Ticket | 58 mm con sabor y advertencia legal | 80 mm con peso, lote y temperatura de conservación |
| Rol operativo distintivo | Inventariador | Galponero (solo su galpón) / Veterinario |

---

## 5. Provisioning: qué pasa al elegir el rubro

Transacción única, ~800 ms, ejecutada por `ProfileProvisioner.apply(tenantId, profileVersionId)`:

```
1.  Resolver manifiesto        (perfil + versión publicada)
2.  Sembrar UoMs               → app.uoms, app.uom_conversions
3.  Sembrar categorías         → app.categories (árbol con path materializado)
4.  Sembrar atributos          → app.attribute_definitions (source='profile')
5.  Sembrar impuestos          → app.taxes, app.tax_groups
                                 (desde platform.tax_templates del país del tenant)
6.  Sembrar tipos fiscales     → app.fiscal_document_types (según country.fiscal_config)
7.  Crear roles y permisos     → app.roles, app.role_permissions
                                 (filtrando permisos cuyo requires_modules no esté activo)
8.  Crear sucursal y almacenes → app.branches, app.warehouses
                                 (+ 'production'/'livestock' si modules.agro.enabled)
9.  Crear métodos de pago      → app.payment_methods
10. Crear caja y lista precios → app.cash_registers, app.price_lists
11. Clonar plantillas de msj   → app.message_templates
                                 (desde platform.message_template_library,
                                  filtrando por profile_slugs y país)
12. Programar automatizaciones → registro en el scheduler
13. Crear storefront borrador  → app.storefronts (is_published=false)
14. Sembrar catálogo demo      → productos de ejemplo del nicho (borrables)
15. Crear suscripción trial    → platform.subscriptions (14 días, plan pro)
16. Persistir vínculo          → tenants.profile_version_id
```

### Versionado y migración de perfiles

Publicar `vape_shop v2` **no toca a nadie**. Cada tenant apunta a su `profile_version_id`. La migración es opt-in:

- Atributos **nuevos** en v2 → se ofrecen como "hay 3 campos nuevos disponibles, ¿los agregas?"
- Atributos **eliminados** en v2 → se marcan `is_active = false`; los datos históricos en JSONB **nunca se borran**
- Atributos que el tenant editó (`source = 'tenant'`) → intocables por la actualización

### Cambiar de rubro después

Sí se puede. `ProfileProvisioner.switch()` desactiva los `attribute_definitions` con `source='profile'` del perfil viejo (sin borrarlos), siembra los del nuevo y **conserva todos los datos**. Los atributos huérfanos quedan visibles en una sección "Campos heredados". Un colmado que se vuelve minimercado no pierde su historial.

---

## 6. Perfiles del catálogo inicial

Los nueve están escritos, validados y sembrados. Cada uno es un JSON en [`config/profiles/`](../config/profiles/); ninguno es una rama de código.

| Slug | Modo primario | Atributos | Roles | Lo que lo distingue |
|---|---|---|---|---|
| `vape_shop` | `variant_inventory` | 10 | 4 | Variantes matriciales sabor × nicotina, verificación de edad, series y garantía |
| `barberia` | `appointments` | 11 | 4 | Agenda con anti-solape garantizado por la BD, comisiones, sellos de fidelidad |
| `granja_avicola` | `biological_lots` | 20 | 5 | **Agro Engine**, multi-UoM, balanza, FCR y costo real por kg |
| `supermercado` | `quick_pos` | 9 | 4 | Códigos de barras con peso/precio embebido, alta rotación, fiado de barrio |
| `farmacia` | `search_first` | 15 | 5 | Búsqueda por principio activo, FEFO obligatorio, receta y registro sanitario |
| `prestamista` | `lending` | 18 | 5 | Cronograma francés, mora diaria, rutas de cobro, cobranza por WhatsApp |
| `restaurante` | `tables` | 10 | 5 | Mesas, comandas por estación de cocina, modificadores, cuentas divididas |
| `ferreteria` | `variant_inventory` | 10 | 4 | Multi-UoM (metro, rollo, quintal, cuñete), venta fraccionada, cotizaciones |
| `taller` | `appointments` | 20 | 5 | Órdenes de servicio, recepción con fotos, repuestos OEM/alterno, garantía |

### El catálogo de permisos también es dato

[`config/permissions.json`](../config/permissions.json) define los **140 permisos** del sistema agrupados en 18 módulos. De ahí se genera `db/seeds/03_permissions.generated.sql`, y contra ahí se validan los roles de todos los manifiestos.

Un rol que pida `agro.inventado.permiso` **rompe el build**, no se descubre en producción cuando un galponero no puede guardar su jornada. La verificación corre en CI (`node config/validate-profiles.mjs`) y otra vez dentro de la base al final de `run_all.sql`.

Los permisos con `requires_modules` solo se ofrecen si el manifiesto enciende ese módulo: un vape shop nunca ve `agro.harvest.post` en su pantalla de roles.

---

## 7. Por qué esto gana

| | Enfoque tradicional | Engine de Nicho |
|---|---|---|
| Nicho nuevo | Sprint de 2-4 semanas | **Un JSON, 1-2 días** (mayormente investigación del rubro) |
| Campo nuevo para un cliente | Migración `ALTER TABLE`, deploy | Fila en `attribute_definitions`, **cero downtime** |
| Riesgo de regresión | Alto: el código de un nicho toca al otro | Nulo: el kernel no cambia |
| Escala del equipo | Un squad por vertical | Un squad de kernel + analistas de rubro |
| Onboarding del cliente | Formulario en blanco, abandono | Sistema preconfigurado en 3 minutos |

El último punto es el comercial. Una MiPyME que abre la app y ve **su** vocabulario — "galpón", "mortalidad", "conversión alimenticia" — ya no está evaluando software genérico: está viendo algo hecho para ella.

---

## 8. Límites honestos del enfoque

Vale declararlos porque condicionan el roadmap:

1. **JSONB no valida referencias.** Un `attributes.galpon` con un UUID inexistente no lo detecta la BD. Mitigación: validación en la capa de aplicación contra `attribute_definitions.ref_entity` + un job nocturno de integridad.
2. **Los reportes cross-tenant sobre JSONB son costosos.** Para BI agregado se materializan columnas en `analytics.*` vía CDC, no se consulta JSONB en caliente.
3. **`semantic_role` es un contrato del kernel.** Añadir uno nuevo *sí* es código. Es la superficie que deliberadamente no se puede configurar, y debe mantenerse pequeña (hoy: 8 roles).
4. **Un nicho con un flujo transaccional genuinamente nuevo** (ej. bolsa de valores) no cabe. El engine cubre variaciones sobre "comprar, guardar, transformar, vender, cobrar" — que es el 95 % del universo MiPyME, pero no el 100 %.
