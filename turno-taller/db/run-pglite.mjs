#!/usr/bin/env node
/**
 * Aplica el esquema y las semillas sobre PGlite — PostgreSQL compilado a
 * WASM que corre dentro de Node, sin Docker ni servidor.
 *
 *   npm run db:verify        # esquema + semillas
 *   npm run db:test          # + las 105 aserciones
 *   node db/run-pglite.mjs --file <ruta.sql>
 *
 * Por qué existe: verificar el esquema no debería exigir infraestructura.
 * Un colaborador clona el repo, corre `npm ci && npm run check` y en
 * ~30 segundos sabe si el DDL está sano. El CI lo repite sobre
 * PostgreSQL nativo 15/16/17 (ver .github/workflows/ci.yml).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb, applyFile } from './lib/psql-lite.mjs';

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);

function table(rows) {
  if (!rows.length) return '    (0 filas)';
  const cols = Object.keys(rows[0]);
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => '    ' + cells.map((v, i) => String(v).padEnd(w[i])).join('  ');
  return [line(cols), '    ' + w.map((n) => '-'.repeat(n)).join('  '),
    ...rows.map((r) => line(cols.map((c) => r[c] ?? '')))].join('\n');
}

const t0 = Date.now();
const db = await createDb();
const { rows: [{ version }] } = await db.query('select version()');
console.log(`\n${version.split(' on ')[0]}\n`);

try {
  const applied = await applyFile(db, opt('--file') ?? join(DB_DIR, 'run_all.sql'), {
    onResult: (r) => { if (r.rows?.length !== undefined && r.fields?.length) console.log(table(r.rows)); },
  });
  console.log(`\n✓ ${applied} archivo(s) aplicados en ${((Date.now() - t0) / 1000).toFixed(1)}s sobre PGlite`);
} catch (err) {
  console.error(`\n${'━'.repeat(72)}`);
  console.error(err.formatted ?? err.message);
  console.error(`${'━'.repeat(72)}\n`);
  process.exit(1);
}

await db.close();
