/**
 * Subconjunto de psql suficiente para este proyecto: expande \i / \ir,
 * reporta \echo y ubica los errores en el archivo y línea correctos.
 *
 * Lo usan db/run-pglite.mjs (verificación) y apps/web-demo/server.mjs
 * (arranque de la demo), para que ambos carguen el esquema igual.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** Expande un .sql en fragmentos {file, startLine, sql} | {echo}. */
export function expand(file, chunks = [], seen = new Set()) {
  const abs = resolve(file);
  if (!existsSync(abs)) throw new Error(`No existe: ${abs}`);
  if (seen.has(abs)) throw new Error(`Inclusión circular: ${abs}`);

  const lines = readFileSync(abs, 'utf8').split('\n');
  const base = dirname(abs);
  let buffer = [];
  let bufferStart = 1;

  const flush = () => {
    const sql = buffer.join('\n');
    if (sql.trim()) chunks.push({ file: abs, startLine: bufferStart, sql });
    buffer = [];
  };

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    // \ir resuelve relativo al archivo que incluye (igual que psql);
    // \i resuelve relativo al directorio de trabajo.
    const inc = trimmed.match(/^\\(ir|i|include_relative|include)\s+(.+)$/);
    if (inc) {
      flush();
      const target = inc[2].trim();
      const fileRelative = inc[1] === 'ir' || inc[1] === 'include_relative';
      expand(fileRelative ? join(base, target) : resolve(process.cwd(), target),
             chunks, new Set([...seen, abs]));
      bufferStart = i + 2;
    } else if (trimmed.startsWith('\\echo')) {
      flush();
      const m = trimmed.match(/^\\echo\s+'(.*)'$/) ?? trimmed.match(/^\\echo\s+(.*)$/);
      chunks.push({ echo: m ? m[1] : '' });
      bufferStart = i + 2;
    } else if (trimmed.startsWith('\\')) {
      flush();                                  // \set, \timing… se ignoran
      bufferStart = i + 2;
    } else {
      if (buffer.length === 0) bufferStart = i + 1;
      buffer.push(line);
    }
  });
  flush();
  return chunks;
}

/** Formatea un error de Postgres apuntando a la línea del archivo fuente. */
export function formatError(chunk, err, root = process.cwd()) {
  const rel = relative(root, chunk.file).replace(/\\/g, '/');
  const out = [`ERROR en ${rel}`, `  ${err.message}`];
  if (err.detail) out.push(`  DETALLE: ${err.detail}`);
  if (err.hint) out.push(`  PISTA:   ${err.hint}`);

  const pos = Number(err.position ?? err.cause?.position ?? 0);
  if (pos > 0) {
    const before = chunk.sql.slice(0, pos - 1);
    const lineInChunk = before.split('\n').length;
    const absLine = chunk.startLine + lineInChunk - 1;
    const col = pos - (before.lastIndexOf('\n') + 1);
    out.push('', `  ${rel}:${absLine}:${col}`, '');
    const src = readFileSync(chunk.file, 'utf8').split('\n');
    for (let l = Math.max(1, absLine - 3); l <= Math.min(src.length, absLine + 2); l++) {
      out.push(`  ${l === absLine ? '>' : ' '} ${String(l).padStart(5)} | ${src[l - 1]}`);
    }
  }
  return out.join('\n');
}

/** Crea una instancia de PGlite con las extensiones que exige el esquema. */
export async function createDb() {
  const { PGlite } = await import('@electric-sql/pglite');
  const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const { btree_gist } = await import('@electric-sql/pglite/contrib/btree_gist');
  const { citext } = await import('@electric-sql/pglite/contrib/citext');
  return PGlite.create({ extensions: { pgcrypto, pg_trgm, btree_gist, citext } });
}

/** Aplica un archivo .sql (con sus includes) sobre una conexión. */
export async function applyFile(db, file, { quiet = false, onEcho, onResult } = {}) {
  let applied = 0;
  for (const chunk of expand(file)) {
    if (chunk.echo !== undefined) {
      if (!quiet) (onEcho ?? console.log)(chunk.echo);
      continue;
    }
    try {
      const results = await db.exec(chunk.sql);
      applied++;
      if (onResult) for (const r of results) onResult(r);
    } catch (err) {
      err.formatted = formatError(chunk, err);
      throw err;
    }
  }
  return applied;
}
