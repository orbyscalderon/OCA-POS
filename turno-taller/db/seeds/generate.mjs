#!/usr/bin/env node
/**
 * Genera las semillas que derivan de archivos JSON, para que no exista
 * una segunda copia del catálogo mantenida a mano:
 *
 *   config/permissions.json   ->  db/seeds/03_permissions.generated.sql
 *   config/profiles/*.json    ->  db/seeds/06_business_profiles.generated.sql
 *
 * Uso:  node db/seeds/generate.mjs
 * CI:   se ejecuta y luego `git diff --exit-code` verifica que lo commiteado
 *       esté al día con los JSON.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const PROFILES_DIR = join(REPO, 'config', 'profiles');

/** Literal de texto SQL con comillas escapadas. */
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
/** Literal de array text[] de Postgres. */
const arr = (list) =>
  !list || list.length === 0
    ? `'{}'::text[]`
    : `ARRAY[${list.map(q).join(', ')}]::text[]`;

const BANNER = (src) =>
  `-- =====================================================================\n` +
  `-- ARCHIVO GENERADO — NO EDITAR A MANO\n` +
  `-- Fuente: ${src}\n` +
  `-- Regenerar: node db/seeds/generate.mjs\n` +
  `-- =====================================================================\n\n`;

// ---------------------------------------------------------------------
// 03 · Catálogo de permisos
// ---------------------------------------------------------------------
function generatePermissions() {
  const cat = JSON.parse(readFileSync(join(REPO, 'config', 'permissions.json'), 'utf8'));
  const rows = [];

  for (const [module, cfg] of Object.entries(cat.modules)) {
    for (const p of cfg.permissions) {
      rows.push(
        `  (${q(p.code)}, ${q(module)}, ${q(p.name)}, ${q(p.description ?? null)}, ` +
        `${p.sensitive ? 'true' : 'false'}, ${arr(p.requires_modules ?? cfg.requires_modules ?? [])})`,
      );
    }
  }

  const sql =
    BANNER('config/permissions.json') +
    `INSERT INTO platform.permissions\n` +
    `  (code, module, name, description, is_sensitive, requires_modules)\n` +
    `VALUES\n${rows.join(',\n')}\n` +
    `ON CONFLICT (code) DO UPDATE\n` +
    `  SET module = EXCLUDED.module,\n` +
    `      name = EXCLUDED.name,\n` +
    `      description = EXCLUDED.description,\n` +
    `      is_sensitive = EXCLUDED.is_sensitive,\n` +
    `      requires_modules = EXCLUDED.requires_modules;\n`;

  writeFileSync(join(HERE, '03_permissions.generated.sql'), sql, 'utf8');
  return rows.length;
}

// ---------------------------------------------------------------------
// 06 · Perfiles de negocio y sus manifiestos
// ---------------------------------------------------------------------
function generateProfiles() {
  const files = readdirSync(PROFILES_DIR).filter((f) => f.endsWith('.json')).sort();
  const parts = [BANNER('config/profiles/*.json')];
  let order = 10;

  for (const file of files) {
    const m = JSON.parse(readFileSync(join(PROFILES_DIR, file), 'utf8'));
    const p = m.profile;

    parts.push(
      `-- ── ${p.name} (${p.slug}) ${'─'.repeat(Math.max(0, 48 - p.name.length - p.slug.length))}\n` +
      `INSERT INTO platform.business_profiles\n` +
      `  (slug, name, description, icon, category, primary_mode, is_public, sort_order)\n` +
      `VALUES (${q(p.slug)}, ${q(p.name)}, ${q(p.description ?? null)}, ${q(p.icon ?? null)},\n` +
      `        ${q(p.category)}, ${q(p.primary_mode)}, true, ${order})\n` +
      `ON CONFLICT (slug) DO UPDATE\n` +
      `  SET name = EXCLUDED.name,\n` +
      `      description = EXCLUDED.description,\n` +
      `      icon = EXCLUDED.icon,\n` +
      `      category = EXCLUDED.category,\n` +
      `      primary_mode = EXCLUDED.primary_mode,\n` +
      `      sort_order = EXCLUDED.sort_order;\n`,
    );

    // El manifiesto va en dollar-quoting: no lleva escapes y se lee tal cual
    // en el archivo, lo que hace revisable el diff de un cambio de perfil.
    const manifest = JSON.stringify(m, null, 2);
    if (manifest.includes('$manifest$')) {
      throw new Error(`${file} contiene el delimitador $manifest$; cambia el tag del generador.`);
    }

    parts.push(
      `INSERT INTO platform.business_profile_versions\n` +
      `  (profile_id, version, manifest, status, published_at, changelog)\n` +
      `SELECT bp.id, ${p.version}, $manifest$${manifest}$manifest$::jsonb,\n` +
      `       'published', now(), 'Generado desde config/profiles/${file}'\n` +
      `  FROM platform.business_profiles bp WHERE bp.slug = ${q(p.slug)}\n` +
      `ON CONFLICT (profile_id, version) DO UPDATE\n` +
      `  SET manifest = EXCLUDED.manifest,\n` +
      `      status = 'published',\n` +
      `      published_at = COALESCE(platform.business_profile_versions.published_at, now()),\n` +
      `      changelog = EXCLUDED.changelog;\n`,
    );

    order += 10;
  }

  // Verificación: todo perfil publicado debe tener exactamente una versión activa
  parts.push(
    `-- Comprobación: ningún perfil puede quedar sin versión publicada\n` +
    `DO $check$\n` +
    `DECLARE v_orphans int;\n` +
    `BEGIN\n` +
    `  SELECT count(*) INTO v_orphans\n` +
    `    FROM platform.business_profiles bp\n` +
    `   WHERE NOT EXISTS (SELECT 1 FROM platform.business_profile_versions v\n` +
    `                      WHERE v.profile_id = bp.id AND v.status = 'published');\n` +
    `  IF v_orphans > 0 THEN\n` +
    `    RAISE EXCEPTION '% perfil(es) sin versión publicada', v_orphans;\n` +
    `  END IF;\n` +
    `END $check$;\n`,
  );

  writeFileSync(join(HERE, '06_business_profiles.generated.sql'), parts.join('\n'), 'utf8');
  return files.length;
}

const perms = generatePermissions();
const profiles = generateProfiles();
console.log(`03_permissions.generated.sql       ${perms} permisos`);
console.log(`06_business_profiles.generated.sql ${profiles} perfiles`);
