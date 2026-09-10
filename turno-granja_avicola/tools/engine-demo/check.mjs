#!/usr/bin/env node
/**
 * Verificación end-to-end de la web con un navegador real.
 *
 *   npm run web        (en otra terminal)
 *   npm run web:check
 *
 * Recorre landing y demo, provoca el flujo completo de venta, recoge
 * TODO error de consola o petición fallida, y deja capturas en .tmp/shots.
 * Sale con código 1 si algo falla: sirve como puerta de calidad.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = join(REPO, '.tmp', 'shots');
const BASE = process.env.BASE ?? 'http://localhost:5173';
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const ok = [];
const log = (pass, msg, extra = '') => {
  (pass ? ok : problems).push(msg + (extra ? ` — ${extra}` : ''));
  console.log(`  ${pass ? '✓' : '✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

// Cualquier error de consola o petición rota es un fallo, no un aviso.
const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

// ═══ LANDING ═══════════════════════════════════════════════════════
console.log('\n── Landing ──────────────────────────────────────────');
await page.goto(BASE, { waitUntil: 'networkidle' });

log(await page.locator('h1').isVisible(), 'El titular se muestra',
    (await page.locator('h1').innerText()).replace(/\n/g, ' ').slice(0, 58));

// Los estilos cargaron de verdad (no un HTML pelado)
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
log(bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)', 'El CSS se aplicó', `body ${bg}`);

// Contenido que llega por API
await page.waitForSelector('#rubro-tabs button', { timeout: 5000 }).catch(() => {});
const tabs = await page.locator('#rubro-tabs button').count();
log(tabs === 12, 'Los 12 rubros se cargaron desde la API', `${tabs} pestañas`);

await page.waitForSelector('.plan', { timeout: 5000 }).catch(() => {});
const plans = await page.locator('.plan').count();
log(plans === 4, 'Los 4 planes se cargaron desde la base', `${plans} planes`);
const firstPlan = await page.locator('.plan h3').first().innerText().catch(() => '—');
log(firstPlan === 'Gratis', 'Los planes salen en orden', `primero: ${firstPlan}`);

const preview = await page.locator('#hero-preview .hp-card').count();
log(preview > 0, 'La vista previa del hero pinta productos', `${preview} tarjetas`);

await page.screenshot({ path: join(SHOTS, '01-landing-hero.png') });

// Cambiar de rubro debe repintar el panel
const before = await page.locator('#rubro-panel').innerText();
await page.locator('#rubro-tabs button', { hasText: 'Farmacia' }).click();
await page.waitForTimeout(320);
const after = await page.locator('#rubro-panel').innerText();
log(before !== after && after.includes('principio activo'),
    'Cambiar de rubro reconfigura el panel');

// Nada se desborda horizontalmente
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
log(overflow <= 1, 'La página no se desborda a lo ancho', `${overflow}px`);

await page.evaluate(() => document.querySelector('#engine').scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, '02-landing-engine.png') });
await page.evaluate(() => document.querySelector('#precios').scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: join(SHOTS, '03-landing-precios.png') });
await page.screenshot({ path: join(SHOTS, '00-landing-full.png'), fullPage: true });

// ═══ MÓVIL ═════════════════════════════════════════════════════════
console.log('\n── Móvil (390×844) ──────────────────────────────────');
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mob.goto(BASE, { waitUntil: 'networkidle' });
const mobOverflow = await mob.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
log(mobOverflow <= 1, 'Sin desbordamiento horizontal en móvil', `${mobOverflow}px`);
await mob.screenshot({ path: join(SHOTS, '04-movil.png') });
await mob.close();

// ═══ DEMO ══════════════════════════════════════════════════════════
console.log('\n── Demo ─────────────────────────────────────────────');
await page.goto(`${BASE}/demo`, { waitUntil: 'networkidle' });
await page.waitForSelector('#profiles .card', { timeout: 6000 }).catch(() => {});
const cards = await page.locator('#profiles .card').count();
log(cards === 12, 'El selector muestra los 12 rubros', `${cards} tarjetas`);
await page.screenshot({ path: join(SHOTS, '05-demo-selector.png') });

// Entrar a un rubro con inventario
await page.locator('#profiles .card', { hasText: 'Tienda de Vapes' }).click();
await page.waitForSelector('#app:not(.hidden)', { timeout: 20000 });
await page.waitForSelector('.prod', { timeout: 10000 });

const navItems = await page.locator('#nav .nav-item').count();
log(navItems >= 8, 'La navegación viene del manifiesto', `${navItems} entradas`);
const prods = await page.locator('.prod').count();
log(prods === 6, 'El catálogo se sembró', `${prods} productos`);
await page.screenshot({ path: join(SHOTS, '06-demo-pos.png') });

// Cobrar de verdad y comprobar que el stock baja
const stockBefore = await page.locator('.prod .stock').first().innerText();
await page.locator('.prod').first().click();
await page.locator('.prod').first().click();
log((await page.locator('.cart-line').count()) === 1, 'El carrito acumula la línea');
log(!(await page.locator('#charge').isDisabled()), 'El botón Cobrar se habilita');
await page.locator('#charge').click();
await page.waitForTimeout(1400);
const stockAfter = await page.locator('.prod .stock').first().innerText();
log(stockBefore !== stockAfter, 'La venta descontó inventario',
    `${stockBefore.trim()} → ${stockAfter.trim()}`);
await page.screenshot({ path: join(SHOTS, '07-demo-venta.png') });

// Formulario dinámico
await page.locator('.nav-item', { hasText: 'Formulario dinámico' }).click();
await page.waitForTimeout(350);
const fields = await page.locator('#dynamic-form .field').count();
log(fields > 5, 'El formulario dinámico se generó', `${fields} campos`);
await page.screenshot({ path: join(SHOTS, '08-demo-formulario.png') });

// Inventario y reportes
const goInv = page.locator('#nav .nav-item', { hasText: 'Inventario' }).first();
if (await goInv.count()) {
  await goInv.click(); await page.waitForTimeout(300);
  log((await page.locator('#stock-table table tbody tr').count()) > 0,
      'La tabla de inventario tiene filas');
  await page.screenshot({ path: join(SHOTS, '09-demo-inventario.png') });
}
const goRep = page.locator('#nav .nav-item', { hasText: 'Reportes' }).first();
if (await goRep.count()) {
  await goRep.click(); await page.waitForTimeout(800);
  log((await page.locator('#kpis .kpi').count()) === 4, 'Los KPIs se calcularon');
  await page.screenshot({ path: join(SHOTS, '10-demo-reportes.png') });
}

// El manifiesto y la prueba de RLS
await page.locator('.nav-item', { hasText: 'El manifiesto' }).click();
await page.waitForTimeout(700);
const rls = await page.locator('#rls-proof').innerText();
log(/\b0\b/.test(rls) && rls.includes('sin contexto'),
    'La prueba de RLS se muestra en vivo');
await page.screenshot({ path: join(SHOTS, '11-demo-manifiesto.png') });

// ═══ Resultado ═════════════════════════════════════════════════════
log(consoleErrors.length === 0, 'Sin errores de consola',
    consoleErrors.slice(0, 3).join(' | '));
log(failedRequests.length === 0, 'Sin peticiones fallidas',
    failedRequests.slice(0, 3).join(' | '));

await browser.close();

console.log(`\n${'═'.repeat(54)}`);
console.log(`  ${ok.length} comprobaciones OK · ${problems.length} fallos`);
console.log(`  capturas en .tmp/shots/`);
console.log('═'.repeat(54));
if (problems.length) {
  console.log('\nFALLOS:');
  problems.forEach((p) => console.log('  ✗ ' + p));
  process.exit(1);
}
