#!/usr/bin/env node
/**
 * Validador de manifiestos de perfil de negocio — gate de CI.
 *
 * Nota: implementa a mano las reglas de business-profile.schema.json que
 * importan en tiempo de build, sin dependencias externas. Cuando el monorepo
 * exista, esto se reemplaza por Ajv sobre el JSON Schema completo y por los
 * tests de `packages/profile-engine`.
 *
 *   node config/validate-profiles.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PROFILES_DIR = join(ROOT, 'profiles');

// Registro maestro de módulos: un manifiesto no puede encender un módulo
// que no exista, ni dejar sin declarar uno que el sistema espera.
const MODULE_REGISTRY = JSON.parse(readFileSync(join(ROOT, 'modules.json'), 'utf8'));
const KNOWN_MODULES = new Set(Object.keys(MODULE_REGISTRY.modules));
const CORE_MODULES = new Set(
  Object.entries(MODULE_REGISTRY.modules).filter(([, m]) => m.core).map(([k]) => k));

// Catálogo maestro de permisos: fuente única de verdad compartida con
// db/seeds/03_permissions.generated.sql. Un permiso fuera de aquí no existe.
const PERM_CATALOG = JSON.parse(readFileSync(join(ROOT, 'permissions.json'), 'utf8'));
const PERM_CODES = new Set();
const PERM_MODULES = new Set();
for (const [mod, cfg] of Object.entries(PERM_CATALOG.modules)) {
  PERM_MODULES.add(mod);
  for (const p of cfg.permissions) {
    PERM_CODES.add(p.code);
    PERM_MODULES.add(p.code.split('.')[0]);   // 'attendance' vive bajo 'employees'
  }
}

const OPERATION_MODES = new Set([
  'quick_pos', 'variant_inventory', 'appointments', 'lending',
  'tables', 'biological_lots', 'search_first',
]);
const POS_LAYOUTS = new Set([
  'grid_with_images', 'weight_first', 'service_first', 'search_first', 'tables',
]);
const DATA_TYPES = new Set([
  'text', 'number', 'integer', 'boolean', 'date', 'datetime',
  'enum', 'multi_enum', 'money', 'percent', 'uuid_ref', 'file',
]);
const UI_WIDGETS = new Set([
  'text', 'textarea', 'number', 'stepper', 'select', 'segmented',
  'chips', 'toggle', 'date_picker', 'datetime_picker', 'file_upload', 'color',
]);
const SEMANTIC_ROLES = new Set([
  'expiry', 'batch', 'serial', 'weight', 'volume', 'potency', 'origin', 'warranty',
]);
const ATTR_SCOPES = new Set([
  'product', 'variant', 'inventory_lot', 'customer', 'supplier',
  'biological_lot', 'biological_daily', 'service_order', 'employee',
]);
const UOM_DIMENSIONS = new Set(['unit', 'weight', 'volume', 'length', 'area', 'time']);

/** @param {string} file @param {any} m @returns {string[]} */
function validate(file, m) {
  const e = [];
  const err = (msg) => e.push(msg);

  // --- profile -------------------------------------------------------
  const p = m.profile ?? {};
  if (!/^[a-z][a-z0-9_]{2,40}$/.test(p.slug ?? '')) err(`profile.slug inválido: ${p.slug}`);
  if (!p.name) err('profile.name requerido');
  if (!Number.isInteger(p.version) || p.version < 1) err('profile.version debe ser entero >= 1');
  if (!OPERATION_MODES.has(p.primary_mode)) err(`profile.primary_mode desconocido: ${p.primary_mode}`);

  // El modo primario debe estar declarado entre los modos soportados
  const modes = m.operation_modes ?? [];
  if (!modes.length) err('operation_modes no puede estar vacío');
  for (const mode of modes) {
    if (!OPERATION_MODES.has(mode)) err(`operation_modes contiene modo desconocido: ${mode}`);
  }
  if (p.primary_mode && !modes.includes(p.primary_mode)) {
    err(`profile.primary_mode "${p.primary_mode}" no está en operation_modes`);
  }

  // --- modules -------------------------------------------------------
  const declared = new Set(Object.keys(m.modules ?? {}));
  for (const [key, cfg] of Object.entries(m.modules ?? {})) {
    if (typeof cfg?.enabled !== 'boolean') err(`modules.${key}.enabled debe ser booleano`);
    if (!KNOWN_MODULES.has(key)) {
      err(`modules.${key} no existe en config/modules.json`);
    }
  }
  // Un módulo marcado core debe estar declarado y encendido en todo rubro
  for (const key of CORE_MODULES) {
    if (!declared.has(key)) {
      err(`falta el módulo core "${key}" (decláralo en modules)`);
    } else if (m.modules[key].enabled !== true) {
      err(`el módulo core "${key}" no puede estar apagado`);
    }
  }

  // --- uoms ----------------------------------------------------------
  const uomCodes = new Set();
  const basePerDimension = {};
  for (const u of m.uoms ?? []) {
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(u.code ?? '')) err(`uom.code inválido: ${u.code}`);
    if (uomCodes.has(u.code)) err(`uom.code duplicado: ${u.code}`);
    uomCodes.add(u.code);
    if (!UOM_DIMENSIONS.has(u.dimension)) err(`uom ${u.code}: dimension inválida "${u.dimension}"`);
    if (!(u.factor_to_base > 0)) err(`uom ${u.code}: factor_to_base debe ser > 0`);
    if (u.is_base) {
      if (basePerDimension[u.dimension]) {
        err(`dimensión "${u.dimension}" tiene dos unidades base: ${basePerDimension[u.dimension]} y ${u.code}`);
      }
      basePerDimension[u.dimension] = u.code;
      if (u.factor_to_base !== 1) err(`uom base ${u.code} debe tener factor_to_base = 1`);
    }
  }
  // Toda dimensión usada necesita su unidad base (el conversor la requiere)
  for (const u of m.uoms ?? []) {
    if (!basePerDimension[u.dimension]) err(`dimensión "${u.dimension}" no declara unidad base`);
  }
  // Las UoM referenciadas por uom_policy deben existir
  const pol = m.uom_policy ?? {};
  for (const ref of [pol.purchase_default, pol.consumption_default, ...Object.values(pol.sale_defaults ?? {})]) {
    if (ref && !uomCodes.has(ref)) err(`uom_policy referencia UoM inexistente: ${ref}`);
  }

  // --- categories ----------------------------------------------------
  const catSlugs = new Set();
  for (const c of m.categories ?? []) {
    if (!/^[a-z0-9-]+$/.test(c.slug ?? '')) err(`category.slug inválido: ${c.slug}`);
    if (catSlugs.has(c.slug)) err(`category.slug duplicado: ${c.slug}`);
    catSlugs.add(c.slug);
    if (c.color && !/^#[0-9A-Fa-f]{6}$/.test(c.color)) err(`category ${c.slug}: color inválido ${c.color}`);
  }

  // --- attributes ----------------------------------------------------
  for (const [scope, list] of Object.entries(m.attributes ?? {})) {
    if (!ATTR_SCOPES.has(scope)) err(`attributes: scope desconocido "${scope}"`);
    const keys = new Set();
    for (const a of list ?? []) {
      const at = `attributes.${scope}.${a.key}`;
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(a.key ?? '')) err(`${at}: key inválida`);
      if (keys.has(a.key)) err(`${at}: key duplicada en el scope`);
      keys.add(a.key);
      if (!a.label) err(`${at}: label requerido`);
      if (!DATA_TYPES.has(a.data_type)) err(`${at}: data_type inválido "${a.data_type}"`);
      if (a.ui_widget && !UI_WIDGETS.has(a.ui_widget)) err(`${at}: ui_widget inválido "${a.ui_widget}"`);
      if (a.semantic_role && !SEMANTIC_ROLES.has(a.semantic_role)) {
        err(`${at}: semantic_role inválido "${a.semantic_role}"`);
      }
      // enum / multi_enum exigen opciones
      if (['enum', 'multi_enum'].includes(a.data_type) && !(a.options?.length > 0)) {
        err(`${at}: data_type "${a.data_type}" requiere options`);
      }
      // uuid_ref exige entidad destino
      if (a.data_type === 'uuid_ref' && !a.ref_entity) err(`${at}: uuid_ref requiere ref_entity`);
      // Un eje de variante no puede ser un tipo no discreto
      if (a.is_variant_axis && !['enum', 'text', 'integer', 'number'].includes(a.data_type)) {
        err(`${at}: is_variant_axis no admite data_type "${a.data_type}"`);
      }
      if (a.is_variant_axis && scope !== 'product' && scope !== 'variant') {
        err(`${at}: is_variant_axis solo aplica a scope product/variant`);
      }
      // Las categorías referenciadas deben existir
      for (const c of a.applies_to_categories ?? []) {
        if (!catSlugs.has(c)) err(`${at}: applies_to_categories referencia categoría inexistente "${c}"`);
      }
      // Opciones con valores únicos
      const vals = new Set();
      for (const o of a.options ?? []) {
        if (o.value === undefined || o.label === undefined) err(`${at}: option requiere value y label`);
        if (vals.has(o.value)) err(`${at}: option.value duplicado "${o.value}"`);
        vals.add(o.value);
      }
    }
  }

  // --- ui ------------------------------------------------------------
  const ui = m.ui ?? {};
  if (!(ui.navigation?.length > 0)) err('ui.navigation no puede estar vacío');
  const navKeys = new Set();
  for (const n of ui.navigation ?? []) {
    if (!n.key || !n.label || !n.route) err(`ui.navigation: key, label y route son requeridos (${n.key})`);
    if (navKeys.has(n.key)) err(`ui.navigation: key duplicada "${n.key}"`);
    navKeys.add(n.key);
    if (n.route && !n.route.startsWith('/')) err(`ui.navigation.${n.key}: route debe empezar con "/"`);
  }
  if (!POS_LAYOUTS.has(ui.pos?.layout)) err(`ui.pos.layout desconocido: ${ui.pos?.layout}`);

  // Los ejes declarados en el POS deben existir como atributos variant_axis
  const axisKeys = new Set(
    Object.values(m.attributes ?? {}).flat().filter((a) => a?.is_variant_axis).map((a) => a.key),
  );
  for (const axis of ui.pos?.variant_axes ?? []) {
    if (!axisKeys.has(axis)) err(`ui.pos.variant_axes: "${axis}" no está declarado con is_variant_axis`);
  }
  // Los filtros rápidos deben existir y ser filtrables
  const filterable = new Set(
    Object.values(m.attributes ?? {}).flat().filter((a) => a?.is_filterable || a?.is_variant_axis).map((a) => a.key),
  );
  for (const f of ui.pos?.quick_filters ?? []) {
    if (!filterable.has(f)) err(`ui.pos.quick_filters: "${f}" no existe o no es filtrable`);
  }
  // Los atributos del ticket deben existir
  const allKeys = new Set(Object.values(m.attributes ?? {}).flat().map((a) => a?.key));
  for (const k of m.receipt?.show_attributes ?? []) {
    if (!allKeys.has(k)) err(`receipt.show_attributes: atributo inexistente "${k}"`);
  }
  if (m.receipt?.width_mm && ![58, 80].includes(m.receipt.width_mm)) {
    err(`receipt.width_mm debe ser 58 u 80 (recibido ${m.receipt.width_mm})`);
  }

  // --- roles ---------------------------------------------------------
  if (!(m.roles?.length > 0)) err('roles no puede estar vacío');
  const roleCodes = new Set();
  let hasAdmin = false;
  for (const r of m.roles ?? []) {
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(r.code ?? '')) err(`role.code inválido: ${r.code}`);
    if (roleCodes.has(r.code)) err(`role.code duplicado: ${r.code}`);
    roleCodes.add(r.code);
    if (r.permissions?.includes('*')) hasAdmin = true;
    for (const perm of r.permissions ?? []) {
      if (!/^(\*|[a-z_]+(\.([a-z_]+|\*)){1,2})$/.test(perm)) {
        err(`role ${r.code}: permiso mal formado "${perm}"`);
        continue;
      }
      if (perm === '*') continue;
      // Comodín de módulo: 'agro.*' exige que el módulo exista en el catálogo
      if (perm.endsWith('.*')) {
        const mod = perm.slice(0, -2);
        if (!PERM_MODULES.has(mod)) {
          err(`role ${r.code}: "${perm}" apunta a un módulo inexistente en config/permissions.json`);
        }
        continue;
      }
      if (!PERM_CODES.has(perm)) {
        err(`role ${r.code}: permiso "${perm}" no existe en config/permissions.json`);
      }
    }
    const maxD = r.constraints?.max_discount_pct;
    if (maxD !== undefined && (maxD < 0 || maxD > 100)) {
      err(`role ${r.code}: max_discount_pct fuera de rango (${maxD})`);
    }
  }
  if (!hasAdmin) err('debe existir al menos un rol con permiso "*" (administrador)');

  // --- coherencia módulos <-> resto ----------------------------------
  const mod = (k) => m.modules?.[k]?.enabled === true;
  if (mod('agro') && !m.agro) err('modules.agro está activo pero falta el bloque "agro"');
  if (!mod('agro') && m.agro) err('bloque "agro" presente pero modules.agro está desactivado');
  if (mod('appointments') && !m.appointments) {
    err('modules.appointments está activo pero falta el bloque "appointments"');
  }
  if (p.primary_mode === 'biological_lots' && !mod('agro')) {
    err('primary_mode "biological_lots" exige modules.agro.enabled = true');
  }
  if (p.primary_mode === 'appointments' && !mod('appointments')) {
    err('primary_mode "appointments" exige modules.appointments.enabled = true');
  }
  if (p.primary_mode === 'tables' && !mod('tables')) {
    err('primary_mode "tables" exige modules.tables.enabled = true');
  }
  if (p.primary_mode === 'lending' && !mod('lending')) {
    err('primary_mode "lending" exige modules.lending.enabled = true');
  }
  if (ui.pos?.require_employee_per_line && !mod('employees')) {
    err('ui.pos.require_employee_per_line exige modules.employees.enabled = true');
  }
  // Una balanza necesita o bien el layout de peso, o bien reglas de código de
  // barras con peso embebido (el supermercado usa el escáner, no la balanza directa).
  if (pol.scale_integration?.enabled
      && ui.pos?.primary_action !== 'scale'
      && ui.pos?.layout !== 'weight_first'
      && !(pol.scale_integration.barcode_rules?.length > 0)) {
    err('AVISO: scale_integration activa sin layout de peso ni reglas de código de barras');
  }
  // Un módulo declarado con label pero deshabilitado suele ser un olvido
  for (const [key, cfg] of Object.entries(m.modules ?? {})) {
    if (cfg?.required && cfg?.enabled === false) {
      err(`modules.${key} está marcado required pero enabled = false`);
    }
  }

  return e;
}

let failed = 0;
const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json')).sort();

for (const file of files) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(PROFILES_DIR, file), 'utf8'));
  } catch (err) {
    console.log(`✗ ${file}\n    JSON inválido: ${err.message}`);
    failed++;
    continue;
  }
  const errors = validate(file, manifest);
  const hard = errors.filter((x) => !x.startsWith('AVISO'));
  const warn = errors.filter((x) => x.startsWith('AVISO'));

  if (hard.length === 0) {
    const attrCount = Object.values(manifest.attributes ?? {}).flat().length;
    const modCount = Object.values(manifest.modules ?? {}).filter((x) => x.enabled).length;
    console.log(
      `✓ ${file.padEnd(22)} modo=${manifest.profile.primary_mode.padEnd(18)}` +
      `módulos=${String(modCount).padStart(2)}  atributos=${String(attrCount).padStart(2)}  ` +
      `roles=${manifest.roles.length}`,
    );
  } else {
    console.log(`✗ ${file}`);
    failed++;
  }
  for (const x of hard) console.log(`    ERROR  ${x}`);
  for (const x of warn) console.log(`    ${x}`);
}

console.log(
  failed === 0
    ? `\n${files.length} manifiesto(s) válido(s).`
    : `\n${failed} de ${files.length} manifiesto(s) con errores.`,
);
process.exit(failed === 0 ? 0 : 1);
