/**
 * OC POS · demo del Engine de Nicho
 * =====================================================================
 * Busca en este archivo el nombre de un rubro. No está.
 * Ni "vape", ni "granja", ni "barbería". Todo lo que ves en pantalla
 * sale del manifiesto que devuelve /api/config.
 */
const $  = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const api = async (path, opts) =>
  (await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts })).json();

const state = { slug: null, cfg: null, products: [], cart: [], method: 'CASH', filter: null };

const money = (n) =>
  `${state.cfg?.currency ?? '$'}${Number(n).toLocaleString('es-DO', {
    minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${kind}`;
  setTimeout(() => t.classList.add('hidden'), 4200);
}

// ═══ Pantalla 1 · Rubros ═══════════════════════════════════════════
async function loadProfiles() {
  const profiles = await api('/api/profiles');
  $('#profiles').innerHTML = '';
  for (const p of profiles) {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.innerHTML = `
      <span class="mode">${p.primary_mode}</span>
      <h3>${p.name}</h3>
      <p>${p.description ?? ''}</p>
      <div class="facts">
        <span><b>${p.attributes}</b> atributos</span>
        <span><b>${p.modules}</b> módulos</span>
        <span><b>${p.roles}</b> roles</span>
      </div>`;
    btn.onclick = () => open(p.slug, btn);
    $('#profiles').append(btn);
  }
  $('#boot-status').textContent =
    `${profiles.length} manifiestos cargados · PostgreSQL en WASM · RLS activo`;
}

async function open(slug, btn) {
  $$('.card').forEach((b) => (b.disabled = true));
  if (btn) btn.innerHTML = '<h3>Configurando negocio…</h3><p>Sembrando el manifiesto en la base…</p>';

  const prov = await api('/api/provision', { method: 'POST', body: JSON.stringify({ slug }) });
  state.slug = slug;
  state.cfg = await api(`/api/config?slug=${slug}`);
  state.products = await api(`/api/products?slug=${slug}`);
  state.cart = []; state.filter = null;

  render();
  $('#picker').classList.add('hidden');
  $('#app').classList.remove('hidden');
  toast(`${state.cfg.tenant} listo · ${prov.attributes} atributos y ${prov.products} productos sembrados en ${prov.ms} ms`);
}

// ═══ Render general ════════════════════════════════════════════════
const VIEWS = {
  pos: '#view-pos', inventory: '#view-stock', reports: '#view-reports',
  __catalog: '#view-catalog', __manifest: '#view-manifest',
};

function render() {
  const { manifest: m, attributes, roles } = state.cfg;

  $('#tenant-name').textContent = state.cfg.tenant;
  $('#tenant-mode').textContent = m.profile.primary_mode;
  $('#stat-attrs').textContent =
    new Set(attributes.map((a) => a.scope + '.' + a.key)).size;
  $('#stat-roles').textContent = roles.length;
  $('#stat-mods').textContent = Object.values(m.modules).filter((x) => x.enabled).length;

  // ── Navegación: viene del manifiesto, no del código ──────────────
  const nav = $('#nav');
  nav.innerHTML = '';
  const addItem = (key, label, target, extra = '') => {
    const b = document.createElement('button');
    b.className = 'nav-item';
    b.dataset.target = target;
    b.innerHTML = `<span class="dot"></span><span>${label}</span>${extra}`;
    b.onclick = () => show(target, b);
    nav.append(b);
    return b;
  };

  let first = null;
  for (const item of m.ui.navigation) {
    const target = VIEWS[item.key] ?? '#view-placeholder';
    const b = addItem(item.key, item.label, target);
    if (!first && VIEWS[item.key]) first = b;
    if (!VIEWS[item.key]) b.dataset.label = item.label;
  }

  const sep = document.createElement('div');
  sep.style.cssText = 'height:1px;background:var(--line);margin:10px 4px';
  nav.append(sep);
  addItem('__catalog', 'Formulario dinámico', '#view-catalog');
  addItem('__manifest', 'El manifiesto', '#view-manifest');

  renderPOS();
  renderForm();
  renderStock();
  renderManifest();
  show(first?.dataset.target ?? '#view-pos', first ?? nav.firstChild);
}

function show(target, btn) {
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $$('.nav-item').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');

  if (target === '#view-placeholder') {
    const v = $('#view-pos');
    v.classList.remove('hidden');
    toast(`"${btn.dataset.label}" existe en el manifiesto y en el modelo de datos, pero no está construido en esta demo.`, 'warn');
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    return;
  }
  $(target).classList.remove('hidden');
  if (target === '#view-reports') renderReports();
}

// ═══ POS ═══════════════════════════════════════════════════════════
// El layout lo elige el manifiesto. Cada uno es una función registrada:
// añadir un nicho nuevo con otra forma de vender es añadir una entrada.
const POS_LAYOUTS = {
  grid_with_images: { showAttrs: true,  showStock: true,  cols: '158px' },
  weight_first:     { showAttrs: true,  showStock: true,  cols: '190px', unit: true },
  service_first:    { showAttrs: true,  showStock: false, cols: '210px', duration: true },
  search_first:     { showAttrs: true,  showStock: true,  cols: '230px', dense: true },
  tables:           { showAttrs: true,  showStock: false, cols: '175px' },
};

function renderPOS() {
  const { manifest: m } = state.cfg;
  const pos = m.ui.pos;
  const L = POS_LAYOUTS[pos.layout] ?? POS_LAYOUTS.grid_with_images;

  $('#pos-title').textContent =
    m.ui.navigation.find((n) => n.key === 'pos')?.label ?? 'Vender';

  // Filtros rápidos: los declara el manifiesto en ui.pos.quick_filters
  const defs = Object.fromEntries(state.cfg.attributes.map((a) => [a.key, a]));
  const chips = $('#pos-filters');
  chips.innerHTML = `<span class="chip ${state.filter ? '' : 'on'}" data-f="">Todo</span>`;
  const cats = [...new Set(state.products.map((p) => p.category).filter(Boolean))];
  for (const c of cats) {
    chips.innerHTML += `<span class="chip ${state.filter === c ? 'on' : ''}" data-f="${c}">${c}</span>`;
  }
  chips.onclick = (e) => {
    if (!e.target.dataset.f && e.target.dataset.f !== '') return;
    state.filter = e.target.dataset.f || null;
    renderPOS();
  };

  const grid = $('#pos-grid');
  grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${L.cols}, 1fr))`;
  grid.innerHTML = '';

  const list = state.products.filter((p) => !state.filter || p.category === state.filter);
  for (const p of list) {
    const stock = Number(p.stock);
    const isService = p.kind === 'service';
    // Los atributos que se muestran los decide show_in_pos del manifiesto
    const tags = Object.entries(p.attributes ?? {})
      .filter(([k]) => defs[k]?.show_in_pos)
      .slice(0, 3)
      .map(([k, v]) => {
        const d = defs[k];
        const opt = (d.options ?? []).find((o) => String(o.value) === String(v));
        // La etiqueta de la opción suele traer ya la unidad ("50 mg (5%)").
        // Solo se añade el sufijo cuando el valor va crudo y no lo incluye.
        const label = opt?.label ?? v;
        const suffix = d.unit_suffix && !String(label).toLowerCase()
          .includes(d.unit_suffix.toLowerCase()) ? ' ' + d.unit_suffix : '';
        return `<span class="tag">${label}${suffix}</span>`;
      }).join('');

    const b = document.createElement('button');
    b.className = 'prod';
    b.innerHTML = `
      <span class="cat" style="color:${p.color ?? 'var(--muted)'}">${p.category ?? ''}</span>
      <span class="nm">${p.name}</span>
      ${L.showAttrs ? `<div class="attrs">${tags}</div>` : ''}
      <div class="price-row">
        <span class="price">${money(p.price)}</span>
        ${isService
          ? '<span class="stock">servicio</span>'
          : L.showStock
            ? `<span class="stock ${stock < 0 ? 'neg' : stock <= 5 ? 'low' : ''}">${stock} u.</span>`
            : ''}
      </div>`;
    b.onclick = () => addToCart(p);
    grid.append(b);
  }

  // Métodos de pago: también salen del manifiesto (el fiado solo si existe)
  const methods = [['CASH', 'Efectivo'], ['TRANSFER', 'Transferencia'], ['CARD', 'Tarjeta']];
  if (m.modules.credit?.enabled) methods.push(['CREDIT', m.modules.credit.label ?? 'Fiado']);
  $('#pay-methods').innerHTML = methods
    .map(([c, l]) => `<button class="${state.method === c ? 'on' : ''}" data-m="${c}">${l}</button>`)
    .join('');
  $('#pay-methods').onclick = (e) => {
    if (!e.target.dataset.m) return;
    state.method = e.target.dataset.m;
    renderPOS();
  };

  $('#tax-label').textContent = 'ITBIS 18% incl.';
  renderCart();
}

function addToCart(p) {
  const line = state.cart.find((l) => l.variant_id === p.variant_id);
  if (line) line.qty++;
  else state.cart.push({ variant_id: p.variant_id, name: p.name, price: Number(p.price), qty: 1 });
  renderCart();
}

function renderCart() {
  const box = $('#cart-lines');
  if (!state.cart.length) {
    box.innerHTML = '<p class="muted">Toca un producto para empezar.</p>';
  } else {
    box.innerHTML = state.cart.map((l, i) => `
      <div class="cart-line">
        <div>${l.name}<br><small>${l.qty} × ${money(l.price)}</small></div>
        <div style="display:flex;gap:8px;align-items:center">
          <b>${money(l.qty * l.price)}</b>
          <button data-i="${i}">×</button>
        </div>
      </div>`).join('');
    box.onclick = (e) => {
      if (e.target.dataset.i === undefined) return;
      state.cart.splice(Number(e.target.dataset.i), 1);
      renderCart();
    };
  }
  const total = state.cart.reduce((s, l) => s + l.qty * l.price, 0);
  const tax = Math.round((total * 0.18 / 1.18) * 100) / 100;
  $('#cart-sub').textContent = money(total - tax);
  $('#cart-tax').textContent = money(tax);
  $('#cart-total').textContent = money(total);
  $('#charge').disabled = !state.cart.length;
}

$('#charge').onclick = async () => {
  const btn = $('#charge');
  btn.disabled = true; btn.textContent = 'Cobrando…';
  const r = await api('/api/sale', {
    method: 'POST',
    body: JSON.stringify({
      slug: state.slug, lines: state.cart, method: state.method,
      offline: $('#offline').checked,
      operation_mode: state.cfg.manifest.profile.primary_mode,
    }),
  });
  btn.textContent = 'Cobrar';

  if (r.error) return toast(`Error: ${r.error}`, 'warn');
  state.cart = [];
  state.products = await api(`/api/products?slug=${state.slug}`);
  renderPOS();
  toast(`Venta ${r.local_number} · ${money(r.total)} — el ledger descontó el inventario`);
};

// ═══ Formulario dinámico ═══════════════════════════════════════════
// Ni un solo campo escrito a mano. Todo sale de attribute_definitions.
const WIDGETS = {
  text:      (a) => `<input type="text" placeholder="${a.label}">`,
  textarea:  (a) => `<textarea rows="3" placeholder="${a.label}"></textarea>`,
  number:    (a) => `<input type="number" placeholder="0">`,
  date_picker: () => `<input type="date">`,
  stepper:   (a) => `<div class="stepper"><button type="button">−</button>
                     <input type="number" value="${a.default_value ?? 0}" style="width:70px">
                     <button type="button">+</button>
                     ${a.unit_suffix ? `<span class="suffix">${a.unit_suffix}</span>` : ''}</div>`,
  toggle:    () => `<div class="toggle"><input type="checkbox"><span class="muted">Sí / No</span></div>`,
  select:    (a) => `<select><option value="">— elegir —</option>${
                      (a.options ?? []).map((o) => `<option>${o.label}</option>`).join('')}</select>`,
  segmented: (a) => `<div class="segmented">${
                      (a.options ?? []).map((o) => `<button type="button">${o.label}</button>`).join('')}</div>`,
  chips:     (a) => `<div class="chipset">${
                      (a.options ?? []).map((o) => `<button type="button">${o.label}</button>`).join('')}</div>`,
  file_upload: () => `<input type="file">`,
  color:     () => `<input type="text" placeholder="#000000">`,
};

function renderForm() {
  // Un atributo acotado a varias categorías existe como una definición por
  // categoría. Para el formulario es UN campo que aplica a varias, así que
  // se agrupan por clave y se acumulan las categorías.
  const byKey = new Map();
  for (const a of state.cfg.attributes.filter((x) => x.scope === 'product')) {
    const prev = byKey.get(a.key);
    if (prev) { if (a.category) prev.categories.push(a.category); }
    else byKey.set(a.key, { ...a, categories: a.category ? [a.category] : [] });
  }
  const attrs = [...byKey.values()].sort((x, y) => x.position - y.position);

  const groups = {};
  for (const a of attrs) (groups[a.ui_group ?? 'Detalles'] ??= []).push(a);

  const scopes = [...new Set(state.cfg.attributes.map((a) => a.scope))];
  const distinct = new Set(state.cfg.attributes.map((a) => a.scope + '.' + a.key)).size;
  let html = `<p class="muted" style="margin:0 0 20px;font-size:13px">
    Este negocio define <b>${distinct}</b> campos propios en
    <b>${scopes.length}</b> ámbitos (<code>${scopes.join('</code>, <code>')}</code>).
    Abajo, los del producto.</p>`;

  for (const [group, list] of Object.entries(groups)) {
    html += `<div class="fgroup"><h4>${group}</h4><div class="fields">`;
    for (const a of list) {
      const w = (WIDGETS[a.ui_widget] ?? WIDGETS.text)(a);
      html += `<div class="field">
        <label>${a.label}${a.is_required ? ' <span class="req">*</span>' : ''}
          ${a.is_variant_axis ? '<span class="meta"> · eje de variante</span>' : ''}
          ${a.semantic_role ? `<span class="meta"> · ${a.semantic_role}</span>` : ''}
        </label>
        ${w}
        ${a.help_text ? `<p class="hint">${a.help_text}</p>` : ''}
        ${a.categories?.length ? `<p class="hint">Solo en: ${a.categories.join(', ')}</p>` : ''}
      </div>`;
    }
    html += `</div></div>`;
  }
  $('#dynamic-form').innerHTML = html;

  $('#dynamic-form').onclick = (e) => {
    const b = e.target.closest('.segmented button, .chipset button');
    if (!b) return;
    if (b.parentElement.classList.contains('segmented')) {
      [...b.parentElement.children].forEach((x) => x.classList.remove('on'));
    }
    b.classList.toggle('on');
  };
}

// ═══ Inventario ════════════════════════════════════════════════════
function renderStock() {
  const goods = state.products.filter((p) => p.kind === 'good');
  if (!goods.length) {
    $('#stock-table').innerHTML =
      '<p class="muted">Este rubro vende servicios: no mueve inventario.</p>';
    return;
  }
  $('#stock-table').innerHTML = `<div class="tbl"><table>
    <thead><tr><th>SKU</th><th>Producto</th><th>Categoría</th>
      <th class="num">Stock</th><th class="num">Costo (CPP)</th>
      <th class="num">Precio</th><th class="num">Margen</th></tr></thead>
    <tbody>${goods.map((p) => {
      const cost = Number(p.cost), price = Number(p.price), st = Number(p.stock);
      const marg = price ? ((price - cost) / price * 100).toFixed(1) : '0.0';
      return `<tr>
        <td><code>${p.sku}</code></td>
        <td>${p.name}</td>
        <td class="muted">${p.category ?? ''}</td>
        <td class="num ${st < 0 ? 'neg' : ''}" style="${st < 0 ? 'color:var(--danger);font-weight:700' : ''}">${st}</td>
        <td class="num muted">${money(cost)}</td>
        <td class="num">${money(price)}</td>
        <td class="num" style="color:var(--accent-2)">${marg}%</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ═══ Reportes ══════════════════════════════════════════════════════
async function renderReports() {
  const { sales, conflicts, kpi } = await api(`/api/sales?slug=${state.slug}`);

  $('#kpis').innerHTML = [
    ['Ingresos', money(kpi.revenue)],
    ['Tickets', kpi.tickets],
    ['Ticket promedio', money(kpi.avg_ticket)],
    ['Margen bruto', money(kpi.margin)],
  ].map(([l, v]) => `<div class="kpi"><span>${l}</span><b>${v}</b></div>`).join('');

  $('#sales-table').innerHTML = sales.length
    ? `<div class="tbl"><table>
        <thead><tr><th>Comprobante</th><th>Hora</th><th class="num">Total</th>
          <th class="num">ITBIS</th><th class="num">Costo</th><th class="num">Margen</th><th>Origen</th></tr></thead>
        <tbody>${sales.map((s) => `<tr>
          <td><code>${s.local_number}</code></td>
          <td class="muted">${s.at}</td>
          <td class="num">${money(s.total)}</td>
          <td class="num muted">${money(s.tax_total)}</td>
          <td class="num muted">${money(s.cost_total)}</td>
          <td class="num" style="color:var(--accent-2)">${money(s.margin_total)}</td>
          <td>${s.is_offline_origin ? '<span class="tag">offline</span>' : '<span class="muted">en línea</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
    : '<p class="muted">Aún no hay ventas. Cobra algo en el POS.</p>';

  $('#conflicts').innerHTML = conflicts.length
    ? conflicts.map((c) => `<div class="conflict">
        <b>${c.kind}</b> — ${c.product ?? ''} · resolución: <code>${c.resolution}</code>
        <p>${c.resolution_note ?? ''}</p>
      </div>`).join('')
    : `<p class="muted">Ninguno. Vende más unidades de las que hay en stock
       (marca «cobrar sin internet») y el trigger lo registrará aquí.</p>`;
}

// ═══ Manifiesto + prueba de RLS ════════════════════════════════════
async function renderManifest() {
  $('#manifest-json').textContent = JSON.stringify(state.cfg.manifest, null, 2);
  const p = await api(`/api/rls-proof?slug=${state.slug}`);
  $('#rls-proof').innerHTML = `
    <b>Aislamiento multi-tenant, en vivo</b>
    <p class="muted" style="margin:6px 0 0;font-size:12.5px">
      La misma consulta <code>SELECT count(*) FROM app.products</code>, con el rol real
      <code>ocpos_app</code>. Hay ${p.tenants_demo} negocios sembrados en esta base.</p>
    <div class="pair">
      <div><b class="ok">${p.con_contexto}</b><span class="muted">con contexto de tenant</span></div>
      <div><b class="ok">${p.sin_contexto}</b><span class="muted">sin contexto → RLS devuelve cero</span></div>
    </div>`;
}

$('#back').onclick = () => {
  $('#app').classList.add('hidden');
  $('#picker').classList.remove('hidden');
  $$('.card').forEach((b) => (b.disabled = false));
  loadProfiles();
};

loadProfiles();
