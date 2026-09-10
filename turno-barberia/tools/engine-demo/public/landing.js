/**
 * Landing de OC POS.
 * Los rubros y los planes NO están escritos aquí: se leen de la misma base
 * de datos que usa el producto. Si mañana se publica un rubro nuevo o cambia
 * un precio, esta página lo refleja sin tocarla.
 */
const $ = (s) => document.querySelector(s);
const api = async (p) => (await fetch(p)).json();

// ── Rotador del titular ───────────────────────────────────────────
const RUBROS = ['colmado', 'barbería', 'farmacia', 'granja', 'ferretería',
                'restaurante', 'taller', 'supermercado', 'panadería', 'boutique', 'veterinaria'];
let ri = 0;
setInterval(() => {
  const el = $('#rubro');
  ri = (ri + 1) % RUBROS.length;
  el.style.opacity = 0;
  setTimeout(() => { el.textContent = RUBROS[ri]; el.style.opacity = 1; }, 180);
}, 2400);
$('#rubro').style.transition = 'opacity .18s';

// ── Qué cambia en cada rubro ──────────────────────────────────────
// Texto de venta por rubro; los datos duros vienen del manifiesto.
const PITCH = {
  vape_shop:      ['Sabor y nivel de nicotina como ejes de variante', 'Verificación de edad obligatoria en el cobro', 'Series y garantía de dispositivos'],
  supermercado:   ['Balanza y código de barras con peso incluido', 'Libreta de fiado del barrio', 'Alertas de vencimiento y stock mínimo'],
  farmacia:       ['Búsqueda por principio activo, no por marca', 'Lote y vencimiento obligatorios (vende primero lo que vence antes)', 'Control de medicamentos con receta'],
  barberia:       ['Agenda por profesional sin doble reserva', 'Comisión automática por servicio', 'Tarjeta de sellos para clientes frecuentes'],
  granja_avicola: ['Lote de crianza con mortalidad diaria', 'Conversión alimenticia y costo por libra producida', 'Venta por peso con balanza'],
  restaurante:    ['Plano de mesas y comandas por estación de cocina', 'Modificadores por plato y cuentas divididas', 'Control de alérgenos en el ticket'],
  ferreteria:     ['Vende por metro, rollo, quintal o cuñete', 'Variantes por medida, material y color', 'Cotizaciones con seguimiento'],
  taller:         ['Orden de servicio con fotos del estado de ingreso', 'Repuestos originales o alternos', 'Garantía por trabajo realizado'],
  prestamista:    ['Cronograma de cuotas con interés y mora', 'Rutas de cobro por cobrador', 'Cobranza automática por WhatsApp'],
  panaderia:      ['Vencimiento corto por lote de horneado', 'Encargos personalizados de tortas', 'Venta por unidad, docena o bandeja'],
  moda:           ['Variantes por talla y color en una sola matriz', 'Apartado sin cronograma de cuotas', 'Control de temporada y colección'],
  veterinaria:    ['Agenda por veterinario con historial clínico', 'Ficha de mascota con vacunas y alergias', 'Recordatorio automático de refuerzos'],
};

const PREVIEW = {
  vape_shop: { title: 'Tienda de Vapes · punto de venta', items: [
    ['Desechables', 'Elf Bar BC5000', 'RD$1,450', ['Mango Ice', '50 mg', '5000 puffs']],
    ['Desechables', 'Lost Mary OS5000', 'RD$1,550', ['Blue Razz', '50 mg']],
    ['E-Líquidos', 'Nasty Juice 60ml', 'RD$950', ['Fresa Kiwi', '3 mg']],
    ['Dispositivos', 'Vaporesso XROS 4', 'RD$2,400', ['1000 mAh']]] },
  granja_avicola: { title: 'Granja Avícola · punto de venta', items: [
    ['Carne', 'Pollo entero fresco', 'RD$185 /lb', ['Entero', 'Lote G3']],
    ['Carne', 'Pechuga deshuesada', 'RD$295 /lb', ['Pechuga']],
    ['Huevos', 'Cartón huevos AA', 'RD$320', ['AA', '30 und']],
    ['Subproductos', 'Gallinaza (saco)', 'RD$150', ['45 kg']]] },
  farmacia: { title: 'Farmacia · punto de venta', items: [
    ['Medicamentos', 'Acetaminofén 500mg', 'RD$85', ['500 mg', 'Tableta', 'Libre']],
    ['Antibióticos', 'Amoxicilina 500mg', 'RD$310', ['500 mg', 'Con receta']],
    ['Vitaminas', 'Vitamina C 1000mg', 'RD$450', ['1000 mg']],
    ['Materno Infantil', 'Fórmula infantil 400g', 'RD$980', ['Vence 03/27']]] },
  barberia: { title: 'Barbería · cobro de servicios', items: [
    ['Cortes', 'Corte clásico', 'RD$600', ['30 min']],
    ['Cortes', 'Fade + diseño', 'RD$900', ['45 min']],
    ['Barba', 'Afeitado a navaja', 'RD$550', ['30 min']],
    ['Productos', 'Cera modeladora', 'RD$750', []]] },
};

let profiles = [];

async function initEngine() {
  profiles = await api('/api/profiles');
  const tabs = $('#rubro-tabs');
  tabs.innerHTML = '';
  profiles.forEach((p, i) => {
    const b = document.createElement('button');
    b.textContent = p.name;
    b.onclick = () => selectRubro(p.slug);
    b.dataset.slug = p.slug;
    tabs.append(b);
  });
  selectRubro('granja_avicola');
  rotatePreview();
}

function selectRubro(slug) {
  const p = profiles.find((x) => x.slug === slug);
  if (!p) return;
  document.querySelectorAll('#rubro-tabs button')
    .forEach((b) => b.classList.toggle('on', b.dataset.slug === slug));

  const MODES = {
    quick_pos: 'Cobro rápido', variant_inventory: 'Inventario por variantes',
    appointments: 'Agenda de citas', lending: 'Control de préstamos',
    tables: 'Mesas y comandas', biological_lots: 'Lotes de crianza',
    search_first: 'Búsqueda primero',
  };

  $('#rubro-panel').innerHTML = `
    <div class="rp-grid">
      <div class="rp-block">
        <h4>Cómo se cobra</h4>
        <div class="rp-tags">
          <i class="hi">${MODES[p.primary_mode] ?? p.primary_mode}</i>
        </div>
        <p class="body" style="font-size:14px;margin-top:12px">${p.description ?? ''}</p>
      </div>
      <div class="rp-block">
        <h4>Lo que activa este rubro</h4>
        <div class="rp-list">
          ${(PITCH[p.slug] ?? []).map((t) => `<span>${t}</span>`).join('')}
        </div>
      </div>
      <div class="rp-block">
        <h4>Se configura solo</h4>
        <div class="rp-tags">
          <i><b>${p.attributes}</b> campos propios</i>
          <i><b>${p.modules}</b> módulos activos</i>
          <i><b>${p.roles}</b> roles de equipo</i>
        </div>
        <p class="body" style="font-size:13.5px;margin-top:12px">
          Todo listo desde el primer día. Puedes cambiarlo cuando quieras.
        </p>
      </div>
      <p class="rp-quote">
        Nada de esto se programó para <b>${p.name}</b> en particular:
        es el mismo sistema leyendo la configuración de este rubro.
      </p>
    </div>`;

  if (PREVIEW[slug]) paintPreview(slug);
}

// ── Vista previa del hero ─────────────────────────────────────────
function paintPreview(slug) {
  const pv = PREVIEW[slug];
  if (!pv) return;
  $('#frame-title').textContent = pv.title;
  $('#hero-preview').innerHTML = `<div class="hp-grid">${
    pv.items.map(([cat, name, price, tags]) => `
      <div class="hp-card">
        <span class="c" style="color:var(--accent)">${cat}</span>
        <span class="n">${name}</span>
        <div class="t">${tags.map((t) => `<span class="tag">${t}</span>`).join('')}</div>
        <span class="p">${price}</span>
      </div>`).join('')}</div>`;
}

let pi = 0;
const PV_KEYS = Object.keys(PREVIEW);
function rotatePreview() {
  paintPreview(PV_KEYS[pi]);
  setInterval(() => {
    pi = (pi + 1) % PV_KEYS.length;
    const b = $('#hero-preview');
    b.style.transition = 'opacity .25s';
    b.style.opacity = 0;
    setTimeout(() => { paintPreview(PV_KEYS[pi]); b.style.opacity = 1; }, 250);
  }, 3600);
}

// ── Planes: leídos de platform.plans ──────────────────────────────
const PLAN_COPY = {
  free:       { tag: 'Para empezar',   li: ['1 sucursal', '2 usuarios', 'Hasta 300 productos', 'Punto de venta y fiado', 'Funciona sin internet'], no: ['Tienda online', 'Facturación fiscal'] },
  pro:        { tag: 'Para crecer',    li: ['1 sucursal', '5 usuarios', 'Productos ilimitados*', 'Tienda online propia', 'WhatsApp: 500 mensajes/mes', 'Citas, mesas y órdenes'], no: ['Facturación fiscal', 'Módulo agropecuario'] },
  business:   { tag: 'Negocio serio',  li: ['Hasta 5 sucursales', '20 usuarios', 'Facturación fiscal', 'Módulo agropecuario', 'WhatsApp: 3.000 mensajes/mes', 'Predicción de reabastecimiento'], no: [] },
  enterprise: { tag: 'A la medida',    li: ['Sucursales ilimitadas', 'Base de datos dedicada', 'Rubros personalizados', 'Acceso por API', 'Soporte dedicado'], no: [] },
};

async function initPlans() {
  const plans = await api('/api/plans');
  $('#plans').innerHTML = plans.map((p) => {
    const c = PLAN_COPY[p.code] ?? { tag: '', li: [], no: [] };
    const monthly = Number(p.price_monthly);
    const price = p.code === 'enterprise'
      ? '<span class="price">A convenir</span>'
      : monthly === 0
        ? '<span class="price">Gratis</span>'
        : `<span class="price">$${monthly.toFixed(2)}<small> USD/mes</small></span>`;
    return `<div class="plan ${p.code === 'business' ? 'hot' : ''}">
      <h3>${p.name}</h3>
      <span class="muted" style="font-size:13px;margin-top:-8px">${c.tag}</span>
      ${price}
      <ul>${c.li.map((x) => `<li>${x}</li>`).join('')}
          ${c.no.map((x) => `<li class="no">${x}</li>`).join('')}</ul>
      <a href="/demo" class="btn ${p.code === 'business' ? 'btn-primary' : 'btn-ghost'}">
        ${monthly === 0 ? 'Empezar gratis' : 'Elegir plan'}</a>
    </div>`;
  }).join('');
}

initEngine();
initPlans();
