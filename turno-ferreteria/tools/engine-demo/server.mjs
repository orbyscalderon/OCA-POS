#!/usr/bin/env node
/**
 * OC POS · Demo del Engine de Nicho
 * =====================================================================
 * Levanta el esquema REAL sobre PGlite y sirve una SPA que demuestra la
 * tesis del producto: la misma aplicación se reconfigura por completo
 * según el manifiesto del rubro, sin una sola rama de código por nicho.
 *
 *   npm run web        →  http://localhost:5173
 *
 * Qué es y qué no es:
 *   · SÍ  — base de datos real, manifiestos reales, RLS activo, ledger
 *           conmutativo de verdad. Las ventas escriben stock_events.
 *   · NO  — no es la PWA de producción. Sin build, sin React, sin
 *           offline. Es la prueba viva del Engine de Nicho.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, applyFile } from '../../db/lib/psql-lite.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PUBLIC = join(HERE, 'public');
const PORT = Number(process.env.PORT ?? 5173);

// =====================================================================
// Catálogo demo por rubro. Vive aquí y no en config/profiles porque son
// datos de ejemplo, no parte del contrato del manifiesto.
// =====================================================================
const DEMO_CATALOG = {
  vape_shop: [
    ['desechables', 'Elf Bar BC5000',        1450, { flavor: 'mango_ice',       nicotine_mg: '50', puffs: 5000, volume_ml: 13, battery_mah: 650 }],
    ['desechables', 'Lost Mary OS5000',      1550, { flavor: 'blue_razz',       nicotine_mg: '50', puffs: 5000, volume_ml: 13, battery_mah: 650 }],
    ['desechables', 'Geek Bar Pulse',        1950, { flavor: 'watermelon',      nicotine_mg: '50', puffs: 15000, volume_ml: 16, battery_mah: 650 }],
    ['liquidos',    'Nasty Juice 60ml',       950, { flavor: 'strawberry_kiwi', nicotine_mg: '3',  volume_ml: 60, vg_pg_ratio: '70_30' }],
    ['dispositivos','Vaporesso XROS 4',      2400, { battery_mah: 1000, warranty_days: 90 }],
    ['resistencias','Coil Vaporesso 0.8Ω',    350, { resistance_ohm: 0.8 }],
  ],
  granja_avicola: [
    ['carne',        'Pollo entero fresco',    185, { especie: 'broiler', presentacion: 'entero' }],
    ['carne',        'Pechuga deshuesada',     295, { especie: 'broiler', presentacion: 'pechuga' }],
    ['carne',        'Muslo y encuentro',      155, { especie: 'broiler', presentacion: 'muslo' }],
    ['huevos',       'Cartón huevos AA',       320, { clase_huevo: 'AA' }],
    ['huevos',       'Cartón huevos A',        280, { clase_huevo: 'A' }],
    ['subproductos', 'Gallinaza (saco)',       150, {}],
  ],
  barberia: [
    ['cortes', 'Corte clásico',            600, { duration_min: 30, commission_pct: 40, gender_target: 'hombre' }],
    ['cortes', 'Fade + diseño',            900, { duration_min: 45, commission_pct: 45, gender_target: 'hombre' }],
    ['cortes', 'Corte infantil',           450, { duration_min: 25, commission_pct: 35, gender_target: 'nino' }],
    ['barba',  'Arreglo de barba',         400, { duration_min: 20, commission_pct: 40 }],
    ['barba',  'Afeitado clásico a navaja',550, { duration_min: 30, commission_pct: 50 }],
    ['productos', 'Cera modeladora 100ml', 750, {}],
  ],
  supermercado: [
    ['granos',          'Arroz selecto (lb)',      42, { marca: 'La Garza', canasta_basica: true, origen: 'nacional' }],
    ['granos',          'Habichuela roja (lb)',    68, { marca: 'Bonao',    canasta_basica: true, origen: 'nacional' }],
    ['carnes',          'Pechuga de pollo (lb)',  135, { marca: 'Pollo Cibao', requiere_refrigeracion: true }],
    ['lacteos',         'Leche entera 1L',         95, { marca: 'Rica', contenido_neto: 1, unidad_contenido: 'l', requiere_refrigeracion: true }],
    ['bebidas',         'Refresco 2L',            120, { marca: 'Country Club', contenido_neto: 2, unidad_contenido: 'l' }],
    ['limpieza',        'Detergente 1kg',         185, { marca: 'Ace', contenido_neto: 1, unidad_contenido: 'kg' }],
  ],
  farmacia: [
    ['medicamentos', 'Acetaminofén 500mg',      85, { principio_activo: 'Acetaminofén', concentracion: '500', forma_farmaceutica: 'tableta', laboratorio: 'Genfar', registro_sanitario: 'RS-10234', condicion_venta: 'libre', es_generico: true }],
    ['medicamentos', 'Ibuprofeno 400mg',       120, { principio_activo: 'Ibuprofeno',   concentracion: '400', forma_farmaceutica: 'tableta', laboratorio: 'Bayer',  registro_sanitario: 'RS-11890', condicion_venta: 'libre', es_generico: false }],
    ['antibioticos', 'Amoxicilina 500mg',      310, { principio_activo: 'Amoxicilina',  concentracion: '500', forma_farmaceutica: 'capsula', laboratorio: 'Sanofi', registro_sanitario: 'RS-22110', condicion_venta: 'receta' }],
    ['vitaminas',    'Vitamina C 1000mg',      450, { principio_activo: 'Ácido ascórbico', concentracion: '1000', forma_farmaceutica: 'tableta', registro_sanitario: 'RS-33421', condicion_venta: 'libre' }],
    ['materno-infantil','Fórmula infantil 400g',980, { registro_sanitario: 'RS-44100', condicion_venta: 'libre' }],
    ['insumos-medicos','Jeringa 5ml',           25, { registro_sanitario: 'RS-55010', condicion_venta: 'libre' }],
  ],
  restaurante: [
    ['platos',    'Pollo guisado con moro',   380, { estacion_cocina: 'caliente', tiempo_preparacion: 20, nivel_picante: '0', alergenos: [] }],
    ['platos',    'Chuleta a la parrilla',    450, { estacion_cocina: 'parrilla', tiempo_preparacion: 25, nivel_picante: '1' }],
    ['platos',    'Pescado frito',            520, { estacion_cocina: 'caliente', tiempo_preparacion: 30, alergenos: ['mariscos'] }],
    ['entradas',  'Ensalada verde',           180, { estacion_cocina: 'fria', tiempo_preparacion: 8, apto_vegetariano: true }],
    ['bebidas',   'Jugo natural',             120, { estacion_cocina: 'barra', tiempo_preparacion: 5 }],
    ['licores',   'Cerveza Presidente',       150, { estacion_cocina: 'barra', tiempo_preparacion: 2 }],
  ],
  ferreteria: [
    ['cables',      'Cable THHN #12 (metro)',    38, { medida: '1_4', material: 'cobre', calibre: '12', marca: 'Phelps Dodge', se_vende_fraccionado: true }],
    ['cemento',     'Cemento gris (saco)',      420, { marca: 'Cemex' }],
    ['hierro',      'Varilla 1/2" (quintal)', 3200, { medida: '1_2', material: 'acero' }],
    ['pinturas',    'Pintura acrílica (galón)', 890, { color: 'blanco', marca: 'Popular', rendimiento_m2: 35 }],
    ['herramientas','Taladro 1/2" 650W',       3500, { medida: '1_2', marca: 'Truper', garantia_meses: 12 }],
    ['tornilleria', 'Tornillo drywall 1" (caja)',260, { medida: '1', material: 'acero' }],
  ],
  taller: [
    ['diagnostico',  'Diagnóstico computarizado', 1200, { duration_min: 45, nivel_tecnico: 'especialista', garantia_dias: 0, commission_pct: 20 }],
    ['mantenimiento','Cambio de aceite y filtro',  1800, { duration_min: 40, nivel_tecnico: 'tecnico', garantia_dias: 30, commission_pct: 25 }],
    ['mano-obra',    'Rectificado de discos',      2500, { duration_min: 90, nivel_tecnico: 'tecnico', garantia_dias: 90, commission_pct: 30 }],
    ['repuestos',    'Filtro de aceite',            450, { numero_parte: 'OF-1042', tipo_repuesto: 'original', compatibilidad: 'Toyota Corolla 2015-2022' }],
    ['repuestos',    'Pastillas de freno (juego)', 1950, { numero_parte: 'BP-3390', tipo_repuesto: 'alterno', compatibilidad: 'Honda Civic 2016-2021' }],
    ['lubricantes',  'Aceite sintético 5W-30 (gl)',2200, { viscosidad: '5w30' }],
  ],
  prestamista: [
    ['prestamos', 'Préstamo personal 30 días',  0, { tasa_interes: 10, periodicidad_interes: 'monthly',  metodo_amortizacion: 'flat',   plazo_cuotas: 1,  mora_diaria: 0.5, dias_gracia: 3, monto_min: 2000,  monto_max: 50000 }],
    ['prestamos', 'Préstamo quincenal x6',      0, { tasa_interes: 6,  periodicidad_interes: 'biweekly', metodo_amortizacion: 'french', plazo_cuotas: 6,  mora_diaria: 0.5, dias_gracia: 2, monto_min: 5000,  monto_max: 100000 }],
    ['prestamos', 'Préstamo semanal x12',       0, { tasa_interes: 4,  periodicidad_interes: 'weekly',   metodo_amortizacion: 'flat',   plazo_cuotas: 12, mora_diaria: 1.0, dias_gracia: 1, monto_min: 3000,  monto_max: 60000 }],
    ['cargos',    'Cargo por gestión de cobro', 250, {}],
    ['cargos',    'Cargo por reestructuración', 500, {}],
    ['cargos',    'Cargo por cheque devuelto',  750, {}],
  ],
  panaderia: [
    ['pan-salado',     'Pan de agua (und)',       15, { tipo_producto: 'pan', peso_g: 80, contiene_gluten: true, dias_vida_util: 1 }],
    ['pan-salado',     'Pan de agua (docena)',   160, { tipo_producto: 'pan', peso_g: 80, contiene_gluten: true, dias_vida_util: 1 }],
    ['pan-dulce',      'Pan de coco',             35, { tipo_producto: 'pan', peso_g: 120, contiene_gluten: true, dias_vida_util: 2 }],
    ['reposteria',     'Quesito',                 45, { tipo_producto: 'reposteria', contiene_gluten: true, dias_vida_util: 2 }],
    ['tortas-pasteles','Torta de chocolate (8p)', 950, { tipo_producto: 'torta', personalizable: true, contiene_gluten: true, dias_vida_util: 3 }],
    ['galletas',       'Galletas de avena (6u)',  90, { tipo_producto: 'galleta', apto_veganos: true, dias_vida_util: 7 }],
  ],
  moda: [
    ['ropa-hombre', 'Camisa manga larga',   1200, { talla: 'm',  color: 'azul',   marca: 'Basic', genero: 'hombre', temporada: 'Otoño 2026' }],
    ['ropa-mujer',  'Vestido casual',       1650, { talla: 's',  color: 'rojo',   marca: 'Luna',  genero: 'mujer',  temporada: 'Verano 2026' }],
    ['ropa-nino',   'Set niño 2 piezas',     850, { talla: 'm',  color: 'azul',   marca: 'KidsCo', genero: 'nino' }],
    ['calzado',     'Tenis urbanos',        2400, { talla_calzado: '40', color: 'negro', marca: 'Runfast', genero: 'unisex' }],
    ['calzado',     'Sandalias de mujer',   1100, { talla_calzado: '37', color: 'beige', marca: 'Luna', genero: 'mujer' }],
    ['accesorios',  'Correa de cuero',       650, { color: 'negro', marca: 'Basic', genero: 'unisex' }],
  ],
  veterinaria: [
    ['consultas', 'Consulta general',        850, { duration_min: 30, especie_objetivo: 'perro', skill_required: 'veterinario', commission_pct: 30 }],
    ['vacunas',   'Vacuna antirrábica',      650, { duration_min: 15, especie_objetivo: 'perro', skill_required: 'veterinario', commission_pct: 25 }],
    ['vacunas',   'Desparasitación',         450, { duration_min: 15, especie_objetivo: 'gato', skill_required: 'asistente', commission_pct: 20 }],
    ['estetica',  'Baño y corte (mediano)', 1200, { duration_min: 60, especie_objetivo: 'perro', skill_required: 'asistente', commission_pct: 30 }],
    ['alimento',  'Alimento seco perro 3kg',1450, {}],
    ['medicamentos','Antiparasitario oral',  380, { requiere_receta: true }],
  ],
};

// =====================================================================
// ProfileProvisioner: manifiesto -> tenant configurado.
// Es la implementación real de docs/01-ENGINE-NICHO.md §5, en JS.
// =====================================================================
async function provision(db, slug) {
  const { rows: [prof] } = await db.query(
    `SELECT bp.id, bp.slug, bp.name, v.id AS version_id, v.manifest
       FROM platform.business_profiles bp
       JOIN platform.business_profile_versions v
         ON v.profile_id = bp.id AND v.status = 'published'
      WHERE bp.slug = $1`, [slug]);
  if (!prof) throw new Error(`Perfil desconocido: ${slug}`);

  const m = prof.manifest;
  const tenantSlug = `demo-${slug}`;

  // Idempotente: si ya existe, se purga y se vuelve a sembrar.
  const { rows: prev } = await db.query(
    'SELECT id FROM platform.tenants WHERE slug = $1', [tenantSlug]);
  if (prev.length) {
    await db.query(`SELECT platform.purge_tenant($1, 'BORRAR DEFINITIVAMENTE', 'reseed demo')`,
      [prev[0].id]);
  }

  // 1 · Tenant vinculado a la versión del perfil
  const { rows: [tenant] } = await db.query(
    `INSERT INTO platform.tenants
       (slug, legal_name, trade_name, country_code, currency_code, profile_id,
        profile_version_id, onboarded_at, branding)
     SELECT $1::text, $2::text, $3::text, 'DO', c.currency_code, $4::uuid, $5::uuid, now(),
            jsonb_build_object('receipt_footer', $6::text)
       FROM platform.countries c WHERE c.code = 'DO'
     RETURNING id`,
    [tenantSlug, `${m.profile.name} Demo SRL`, m.profile.name,
     prof.id, prof.version_id, m.receipt?.footer ?? '']);
  const T = tenant.id;

  // 2 · Sucursal, almacenes y caja
  const { rows: [branch] } = await db.query(
    `INSERT INTO app.branches (tenant_id, code, name, is_primary)
     VALUES ($1,'M1','Sucursal Principal',true) RETURNING id`, [T]);
  const { rows: [wh] } = await db.query(
    `INSERT INTO app.warehouses (tenant_id, branch_id, code, name, is_default)
     VALUES ($1,$2,'ALM1','Almacén Principal',true) RETURNING id`, [T, branch.id]);
  const { rows: [reg] } = await db.query(
    `INSERT INTO app.cash_registers (tenant_id, branch_id, code, name)
     VALUES ($1,$2,'C1','Caja 1') RETURNING id`, [T, branch.id]);

  // El perfil agro añade el galpón como unidad productiva
  if (m.modules?.agro?.enabled) {
    const { rows: [awh] } = await db.query(
      `INSERT INTO app.warehouses (tenant_id, branch_id, code, name, kind)
       VALUES ($1,$2,'GALPON3','Galpón 3','livestock') RETURNING id`, [T, branch.id]);
    await db.query(
      `INSERT INTO app.farm_units (tenant_id, branch_id, warehouse_id, code, name, kind, capacity)
       VALUES ($1,$2,$3,'GALPON-3','Galpón 3','shed',1200)`, [T, branch.id, awh.id]);
  }

  // 3 · Unidades de medida del manifiesto
  const uom = {};
  for (const u of m.uoms ?? []) {
    const { rows: [r] } = await db.query(
      `INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base, precision)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [T, u.code, u.name, u.dimension, u.factor_to_base, !!u.is_base, u.precision ?? 2]);
    uom[u.code] = r.id;
  }

  // 4 · Categorías
  const cat = {};
  for (const [i, c] of (m.categories ?? []).entries()) {
    const { rows: [r] } = await db.query(
      `INSERT INTO app.categories (tenant_id, name, slug, color, icon, position)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [T, c.name, c.slug, c.color ?? null, c.icon ?? null, i]);
    cat[c.slug] = r.id;
  }

  // 5 · ★ Atributos dinámicos — el corazón del engine
  let attrCount = 0;
  for (const [scope, list] of Object.entries(m.attributes ?? {})) {
    for (const a of list) {
      // Un atributo acotado a categorías genera una fila por categoría
      const targets = a.applies_to_categories?.length
        ? a.applies_to_categories.map((s) => cat[s]).filter(Boolean)
        : [null];
      for (const categoryId of targets) {
        await db.query(
          `INSERT INTO app.attribute_definitions
             (tenant_id, scope, category_id, key, label, help_text, data_type, ui_widget,
              ui_group, unit_suffix, options, validation, default_value, is_required,
              is_variant_axis, is_filterable, show_in_pos, show_in_receipt,
              semantic_role, position, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'profile')
           ON CONFLICT (tenant_id, scope, category_id, key) DO NOTHING`,
          [T, scope, categoryId, a.key, a.label, a.help_text ?? null, a.data_type,
           a.ui_widget ?? 'text', a.ui_group ?? null, a.unit_suffix ?? null,
           JSON.stringify(a.options ?? []), JSON.stringify(a.validation ?? {}),
           a.default_value === undefined ? null : JSON.stringify(a.default_value),
           !!a.is_required, !!a.is_variant_axis, !!a.is_filterable,
           !!a.show_in_pos, !!a.show_in_receipt, a.semantic_role ?? null, a.position ?? 0]);
        attrCount++;
      }
    }
  }

  // 6 · Impuestos del país
  const { rows: [tax] } = await db.query(
    `INSERT INTO app.taxes (tenant_id, code, name, rate, kind, calculation, is_default)
     SELECT $1, t.code, t.name, t.rate, t.kind, 'inclusive', t.is_default
       FROM platform.tax_templates t
      WHERE t.country_code = 'DO' AND t.is_default
     RETURNING id`, [T]);
  const { rows: [tg] } = await db.query(
    `INSERT INTO app.tax_groups (tenant_id, code, name, is_default)
     VALUES ($1,'GENERAL','Impuesto general',true) RETURNING id`, [T]);
  await db.query(
    `INSERT INTO app.tax_group_items (tenant_id, tax_group_id, tax_id) VALUES ($1,$2,$3)`,
    [T, tg.id, tax.id]);

  // 7 · Roles y permisos, expandiendo comodines contra el catálogo
  for (const r of m.roles ?? []) {
    const { rows: [role] } = await db.query(
      `INSERT INTO app.roles (tenant_id, code, name, is_system, constraints)
       VALUES ($1,$2,$3,true,$4) RETURNING id`,
      [T, r.code, r.name, JSON.stringify(r.constraints ?? {})]);

    const exact = r.permissions.filter((p) => p !== '*' && !p.endsWith('.*'));
    const wild = r.permissions.filter((p) => p.endsWith('.*')).map((p) => p.slice(0, -2));
    const all = r.permissions.includes('*');

    await db.query(
      `INSERT INTO app.role_permissions (tenant_id, role_id, permission_code)
       SELECT $1, $2, p.code FROM platform.permissions p
        WHERE ($3::boolean
               OR p.code = ANY($4::text[])
               OR split_part(p.code,'.',1) = ANY($5::text[]))
       ON CONFLICT DO NOTHING`,
      [T, role.id, all, exact, wild]);
  }

  // 8 · Métodos de pago (el fiado solo si el perfil lo enciende)
  await db.query(
    `INSERT INTO app.payment_methods (tenant_id, code, name, kind, position)
     VALUES ($1,'CASH','Efectivo','cash',0),
            ($1,'TRANSFER','Transferencia','transfer',1),
            ($1,'CARD','Tarjeta','card',2)`, [T]);
  if (m.modules?.credit?.enabled) {
    await db.query(
      `INSERT INTO app.payment_methods
         (tenant_id, code, name, kind, affects_cash_drawer, creates_receivable, position)
       VALUES ($1,'CREDIT',$2,'credit',false,true,3)`,
      [T, m.modules.credit.label ?? 'Fiado']);
  }

  // 9 · Catálogo demo con los atributos del nicho, y su stock inicial
  const baseUomCode = m.uoms?.find((u) => u.is_base && u.dimension === 'unit')?.code
                   ?? m.uoms?.[0]?.code;
  let products = 0;
  for (const [catSlug, name, price, attrs] of DEMO_CATALOG[slug] ?? []) {
    const isService = ['cortes','barba','color','diagnostico','mano-obra',
                       'mantenimiento','prestamos','cargos'].includes(catSlug);
    const { rows: [p] } = await db.query(
      `INSERT INTO app.products
         (tenant_id, category_id, name, kind, base_uom_id, tax_group_id, attributes,
          track_inventory, track_lots, track_expiry, is_weighted, age_restricted, reorder_point)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [T, cat[catSlug] ?? null, name, isService ? 'service' : 'good',
       uom[baseUomCode], tg.id, JSON.stringify(attrs),
       !isService, !!m.product_defaults?.track_lots, !!m.product_defaults?.track_expiry,
       !!m.product_defaults?.is_weighted, !!m.product_defaults?.age_restricted,
       m.product_defaults?.reorder_point ?? 5]);

    const { rows: [v] } = await db.query(
      `INSERT INTO app.product_variants
         (tenant_id, product_id, sku, name, price, attributes, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
      [T, p.id, `${slug.slice(0,3).toUpperCase()}-${String(++products).padStart(3,'0')}`,
       name, price, JSON.stringify(attrs)]);

    if (!isService) {
      await db.query(
        `INSERT INTO app.stock_events
           (id, tenant_id, warehouse_id, variant_id, delta_qty, unit_cost, reason)
         VALUES (app.uuid_v7(),$1,$2,$3,$4,$5,'initial')`,
        [T, wh.id, v.id, 24, Math.round(price * 0.62)]);
    }
  }

  // 10 · Usuario operativo
  const { rows: [adminRole] } = await db.query(
    `SELECT id FROM app.roles WHERE tenant_id = $1 ORDER BY code LIMIT 1`, [T]);
  await db.query(
    `INSERT INTO app.users (tenant_id, role_id, display_name)
     VALUES ($1,$2,'Demo')`, [T, adminRole.id]);

  return { tenant_id: T, branch_id: branch.id, warehouse_id: wh.id,
           register_id: reg.id, attributes: attrCount, products };
}

// =====================================================================
// Ejecuta una consulta CON el pipeline de producción: rol de la
// aplicación + contexto de tenant. RLS activo de verdad.
// =====================================================================
async function asTenant(db, tenantId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE ocpos_app`);
    await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return fn(tx);
  });
}

// =====================================================================
// API
// =====================================================================
const json = (res, code, body) => {
  const s = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8',
                        'content-length': Buffer.byteLength(s) });
  res.end(s);
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
               '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
               '.json': 'application/json; charset=utf-8' };

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function routes(db, tenants) {
  return {
    // Rubros disponibles, leídos de la base
    'GET /api/profiles': async () => {
      const { rows } = await db.query(
        `SELECT bp.slug, bp.name, bp.category, bp.icon, bp.primary_mode, bp.description,
                jsonb_array_length(COALESCE(v.manifest->'roles','[]'::jsonb)) AS roles,
                (SELECT count(*) FROM jsonb_each(v.manifest->'attributes') e,
                        LATERAL jsonb_array_elements(e.value)) AS attributes,
                (SELECT count(*) FROM jsonb_each(v.manifest->'modules') mm
                  WHERE mm.value->>'enabled' = 'true') AS modules
           FROM platform.business_profiles bp
           JOIN platform.business_profile_versions v
             ON v.profile_id = bp.id AND v.status='published'
          ORDER BY bp.sort_order`);
      return rows;
    },

    // Planes reales: la landing muestra lo que hay en platform.plans
    'GET /api/plans': async () => {
      const { rows } = await db.query(
        `SELECT code, name, price_monthly, price_yearly, currency_code, limits, features
           FROM platform.plans WHERE is_active
          ORDER BY CASE code WHEN 'free' THEN 1 WHEN 'pro' THEN 2
                             WHEN 'business' THEN 3 ELSE 4 END`);
      return rows;
    },

    // Provisiona (o resiembra) el tenant demo del rubro
    'POST /api/provision': async (body) => {
      const t0 = Date.now();
      const info = await provision(db, body.slug);
      tenants.set(body.slug, info);
      return { ...info, ms: Date.now() - t0 };
    },

    // Configuración efectiva que consume el frontend
    'GET /api/config': async (_b, q) => {
      const info = tenants.get(q.slug);
      if (!info) return { error: 'no provisionado' };
      const { rows: [r] } = await db.query(
        `SELECT t.trade_name, t.currency_code, v.manifest,
                (SELECT c.currency_symbol FROM platform.countries c WHERE c.code=t.country_code) AS symbol
           FROM platform.tenants t
           JOIN platform.business_profile_versions v ON v.id = t.profile_version_id
          WHERE t.id = $1`, [info.tenant_id]);
      const attrs = await asTenant(db, info.tenant_id, (tx) => tx.query(
        `SELECT scope, key, label, data_type, ui_widget, ui_group, unit_suffix,
                options, validation, is_required, is_variant_axis, is_filterable,
                show_in_pos, semantic_role, position,
                (SELECT c.name FROM app.categories c WHERE c.id = ad.category_id) AS category
           FROM app.attribute_definitions ad
          WHERE is_active ORDER BY scope, position, key`));
      const roles = await asTenant(db, info.tenant_id, (tx) => tx.query(
        `SELECT r.code, r.name, r.constraints,
                (SELECT count(*) FROM app.role_permissions rp WHERE rp.role_id = r.id) AS permissions
           FROM app.roles r ORDER BY r.code`));
      return { ...info, tenant: r.trade_name, currency: r.symbol,
               manifest: r.manifest, attributes: attrs.rows, roles: roles.rows };
    },

    // Catálogo con su stock, leído bajo RLS
    'GET /api/products': async (_b, q) => {
      const info = tenants.get(q.slug);
      if (!info) return [];
      const { rows } = await asTenant(db, info.tenant_id, (tx) => tx.query(
        `SELECT v.id AS variant_id, p.id AS product_id, p.name, p.kind, v.sku, v.price,
                p.attributes, c.name AS category, c.color, c.slug AS category_slug,
                COALESCE(b.qty_on_hand, 0) AS stock,
                COALESCE(vc.avg_cost, 0)   AS cost
           FROM app.product_variants v
           JOIN app.products p   ON p.id = v.product_id
      LEFT JOIN app.categories c ON c.id = p.category_id
      LEFT JOIN app.stock_balances b ON b.variant_id = v.id
      LEFT JOIN app.variant_costs vc ON vc.variant_id = v.id
          WHERE p.is_active
          ORDER BY c.position, p.name`));
      return rows;
    },

    // ★ Cobro real: venta + líneas + pagos + eventos de stock
    'POST /api/sale': async (body) => {
      const info = tenants.get(body.slug);
      if (!info) return { error: 'no provisionado' };

      return asTenant(db, info.tenant_id, async (tx) => {
        const { rows: [u] } = await tx.query(`SELECT id FROM app.users LIMIT 1`);
        const { rows: [pm] } = await tx.query(
          `SELECT id FROM app.payment_methods WHERE code = $1`, [body.method ?? 'CASH']);
        const { rows: [n] } = await tx.query(
          `SELECT count(*) + 1 AS n FROM app.sales`);
        const local = `M1-01-${String(n.n).padStart(6, '0')}`;

        const total = body.lines.reduce((s, l) => s + l.qty * l.price, 0);
        const taxTotal = Math.round(total * 0.18 / 1.18 * 100) / 100;   // ITBIS incluido

        const { rows: [sale] } = await tx.query(
          `INSERT INTO app.sales
             (id, tenant_id, branch_id, warehouse_id, user_id, local_number,
              operation_mode, currency_code, subtotal, tax_total, total, paid_total,
              occurred_at, is_offline_origin)
           VALUES (app.uuid_v7(),$1,$2,$3,$4,$5,$6,'DOP',$7,$8,$9,$9,now(),$10)
           RETURNING id, local_number`,
          [info.tenant_id, info.branch_id, info.warehouse_id, u.id, local,
           body.operation_mode ?? 'quick_pos', total - taxTotal, taxTotal, total,
           !!body.offline]);

        for (const [i, l] of body.lines.entries()) {
          const { rows: [c] } = await tx.query(
            `SELECT COALESCE(avg_cost,0) AS cost FROM app.variant_costs WHERE variant_id=$1`,
            [l.variant_id]);
          const cost = Number(c?.cost ?? 0);

          const { rows: [line] } = await tx.query(
            `INSERT INTO app.sale_lines
               (id, tenant_id, sale_id, position, variant_id, name_snapshot,
                attributes_snapshot, qty, qty_in_base, unit_price, line_subtotal,
                line_total, tax_amount, unit_cost, line_cost)
             SELECT app.uuid_v7(), $1::uuid, $2::uuid, $3::smallint, $4::uuid,
                    p.name, v.attributes,
                    $5::numeric, $5::numeric, $6::numeric,
                    $7::numeric, $7::numeric, round($7::numeric * 0.18 / 1.18, 2),
                    $8::numeric, ($8::numeric * $5::numeric)
               FROM app.product_variants v JOIN app.products p ON p.id=v.product_id
              WHERE v.id = $4::uuid
             RETURNING id`,
            [info.tenant_id, sale.id, i, l.variant_id, l.qty, l.price, l.qty * l.price, cost]);

          // Solo los bienes mueven inventario; los servicios no
          const { rows: [k] } = await tx.query(
            `SELECT p.kind FROM app.product_variants v JOIN app.products p ON p.id=v.product_id
              WHERE v.id=$1`, [l.variant_id]);
          if (k.kind === 'good') {
            await tx.query(
              `INSERT INTO app.stock_events
                 (id, tenant_id, warehouse_id, variant_id, delta_qty, cogs_unit_cost,
                  reason, ref_type, ref_id, ref_line_id, user_id, occurred_at)
               VALUES (app.uuid_v7(),$1,$2,$3,$4,$5,'sale','sale',$6,$7,$8,now())`,
              [info.tenant_id, info.warehouse_id, l.variant_id, -l.qty, cost,
               sale.id, line.id, u.id]);
          }
        }

        await tx.query(
          `INSERT INTO app.sale_payments (id, tenant_id, sale_id, payment_method_id, amount)
           VALUES (app.uuid_v7(),$1,$2,$3,$4)`,
          [info.tenant_id, sale.id, pm.id, total]);

        await tx.query(
          `INSERT INTO app.audit_logs (tenant_id, branch_id, user_id, action, entity_type,
                                       entity_id, amount, severity)
           VALUES ($1,$2,$3,'sale.create','sale',$4,$5,'info')`,
          [info.tenant_id, info.branch_id, u.id, sale.id, total]);

        return { id: sale.id, local_number: sale.local_number, total, tax_total: taxTotal };
      });
    },

    // Ventas recientes + conflictos de sobreventa detectados
    'GET /api/sales': async (_b, q) => {
      const info = tenants.get(q.slug);
      if (!info) return { sales: [], conflicts: [] };
      return asTenant(db, info.tenant_id, async (tx) => {
        const sales = await tx.query(
          `SELECT local_number, total, tax_total, cost_total, margin_total,
                  is_offline_origin, to_char(occurred_at,'HH24:MI:SS') AS at
             FROM app.sales ORDER BY occurred_at DESC LIMIT 12`);
        const conflicts = await tx.query(
          `SELECT c.kind, c.resolution, c.resolution_note, c.requires_action,
                  p.name AS product, c.server_state, c.client_state
             FROM app.sync_conflicts c
        LEFT JOIN app.product_variants v ON v.id = c.variant_id
        LEFT JOIN app.products p ON p.id = v.product_id
            ORDER BY c.created_at DESC LIMIT 10`);
        const kpi = await tx.query(
          `SELECT COALESCE(SUM(total),0) AS revenue, COALESCE(SUM(margin_total),0) AS margin,
                  count(*) AS tickets, COALESCE(AVG(total),0) AS avg_ticket
             FROM app.sales WHERE status='completed'`);
        return { sales: sales.rows, conflicts: conflicts.rows, kpi: kpi.rows[0] };
      });
    },

    // Demuestra el aislamiento: la misma consulta, sin contexto de tenant
    'GET /api/rls-proof': async (_b, q) => {
      const info = tenants.get(q.slug);
      if (!info) return { error: 'no provisionado' };
      const withCtx = await asTenant(db, info.tenant_id, (tx) =>
        tx.query('SELECT count(*)::int AS n FROM app.products'));
      const without = await db.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE ocpos_app`);
        await tx.query(`SELECT set_config('app.tenant_id','',true)`);
        return tx.query('SELECT count(*)::int AS n FROM app.products');
      });
      const other = await db.query(
        `SELECT count(*)::int AS n FROM platform.tenants WHERE slug LIKE 'demo-%'`);
      return { con_contexto: withCtx.rows[0].n, sin_contexto: without.rows[0].n,
               tenants_demo: other.rows[0].n };
    },
  };
}

// =====================================================================
// Arranque
// =====================================================================
console.log('OC POS · demo del Engine de Nicho');
console.log('Levantando PostgreSQL (WASM) y aplicando el esquema real…');

const t0 = Date.now();
const db = await createDb();
try {
  await applyFile(db, join(REPO, 'db', 'run_all.sql'), { quiet: true });
} catch (err) {
  console.error(err.formatted ?? err.message);
  process.exit(1);
}
const { rows: [{ version }] } = await db.query('select version()');
console.log(`${version.split(' on ')[0]} · esquema listo en ${((Date.now()-t0)/1000).toFixed(1)}s`);

const tenants = new Map();
const api = routes(db, tenants);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const key = `${req.method} ${url.pathname}`;

  if (api[key]) {
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await api[key](body, Object.fromEntries(url.searchParams));
      return json(res, 200, out);
    } catch (err) {
      console.error(`✗ ${key}:`, err.message);
      return json(res, 500, { error: err.message, detail: err.detail ?? null });
    }
  }

  // Estáticos. '/' es la landing; '/demo' es el sistema.
  const ROUTES = { '/': '/landing.html', '/demo': '/index.html' };
  const file = ROUTES[url.pathname] ?? url.pathname;
  try {
    const buf = await readFile(join(PUBLIC, file));
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
  }
}).listen(PORT, () => {
  console.log(`\n  ▸  http://localhost:${PORT}\n`);
});
