import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { useT } from "../i18n";

// Módulo POS + Inventario + Caja (rubros de retail/alimentos: supermercado, vape, ferretería, farmacia…).
interface Producto {
  id: string; nombre: string; sku: string | null; categoria: string | null; unidad: string;
  precioVenta: string | number; impuestoPct: string | number; costo: string | number | null;
  stock: string | number; stockMinimo: string | number; activo: boolean;
  // Líquidos de vapeo (opcionales).
  volumenMl: string | number | null; nicotinaMg: string | number | null;
  // Si este producto (p. ej. "Recarga") descuenta stock de OTRO producto (el pote) en vez de
  // llevar stock propio.
  productoFuenteId: string | null; rendimientoPorVenta: string | number | null;
}
interface Sesion { id: string; montoInicial: string | number; abiertaEn: string; estado: string }
interface Venta { id: string; total: string | number; metodoPago: string; createdAt: string }

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const num = (n: number | string | null) => Number(n ?? 0);

// ---------- VENDER (POS) ----------
interface LineaCarrito { productoId?: string; nombre: string; cantidad: number; precioUnit: number; impuestoPct: number }
interface ClienteLite { id: string; nombre: string; telefono: string | null; saldoFiado: string | number }

export function Vender({ negocio, credit }: { negocio: Negocio; credit: boolean }) {
  const { t } = useT();
  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [carrito, setCarrito] = useState<LineaCarrito[]>([]);
  const [metodoPago, setMetodoPago] = useState("efectivo");
  const [clienteQ, setClienteQ] = useState("");
  const [clienteResultados, setClienteResultados] = useState<ClienteLite[]>([]);
  const [clienteSel, setClienteSel] = useState<ClienteLite | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Búsqueda de cliente para fiar la venta (solo si el rubro tiene el módulo de crédito).
  useEffect(() => {
    if (!credit || metodoPago !== "fiado" || !clienteQ.trim()) { setClienteResultados([]); return; }
    const t2 = setTimeout(() => {
      api.get<{ clientes: ClienteLite[] }>(`/clientes?negocioId=${negocio.id}&q=${encodeURIComponent(clienteQ)}`)
        .then((r) => setClienteResultados(r.clientes)).catch(() => {});
    }, 200);
    return () => clearTimeout(t2);
  }, [credit, metodoPago, clienteQ, negocio.id]);

  // Busca productos por nombre o código de barras (un escáner escribe el código + Enter).
  useEffect(() => {
    if (!busqueda.trim()) { setResultados([]); return; }
    const t2 = setTimeout(() => {
      api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}&q=${encodeURIComponent(busqueda)}`)
        .then((r) => setResultados(r.productos)).catch(() => {});
    }, 200);
    return () => clearTimeout(t2);
  }, [busqueda, negocio.id]);

  function agregar(p: Producto) {
    setCarrito((c) => {
      const i = c.findIndex((l) => l.productoId === p.id);
      if (i >= 0) { const cp = [...c]; cp[i] = { ...cp[i], cantidad: cp[i].cantidad + 1 }; return cp; }
      return [...c, { productoId: p.id, nombre: p.nombre, cantidad: 1, precioUnit: num(p.precioVenta), impuestoPct: num(p.impuestoPct) }];
    });
    setBusqueda(""); setResultados([]); inputRef.current?.focus();
  }

  function setCant(i: number, cantidad: number) {
    setCarrito((c) => c.map((l, k) => (k === i ? { ...l, cantidad: Math.max(0, cantidad) } : l)).filter((l) => l.cantidad > 0));
  }

  // Al escanear un código de barras, el lector "escribe" el código muy rápido y termina con
  // Enter — mucho más rápido que el debounce de 200ms de arriba, así que acá no confiamos en
  // `resultados` (puede estar vacío o desactualizado): se busca de una y se agrega si hay
  // coincidencia exacta de SKU/código de barras, o si quedó un único resultado.
  async function onEnter(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const codigo = busqueda.trim();
    if (!codigo) return;
    try {
      const r = await api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}&q=${encodeURIComponent(codigo)}`);
      const exacto = r.productos.find((p) => p.sku && p.sku.toLowerCase() === codigo.toLowerCase());
      if (exacto) { agregar(exacto); return; }
      if (r.productos.length === 1) { agregar(r.productos[0]); return; }
      setResultados(r.productos);
    } catch {
      // sin conexión momentánea: se deja el texto para reintentar o elegir de la lista ya cargada
    }
  }

  const subtotal = carrito.reduce((s, l) => s + l.cantidad * l.precioUnit, 0);
  const impuesto = carrito.reduce((s, l) => s + (l.cantidad * l.precioUnit * l.impuestoPct) / 100, 0);
  const total = subtotal + impuesto;

  async function cobrar() {
    setError(""); setMsg("");
    if (carrito.length === 0) return;
    if (metodoPago === "fiado" && !clienteSel) { setError(t("pos.chooseCustomer")); return; }
    try {
      await api.post("/pos/ventas", { negocioId: negocio.id, metodoPago, clienteId: clienteSel?.id, lineas: carrito });
      setMsg(`${t("pos.saleRegistered")}: ${money(total)}`);
      setCarrito([]); setClienteSel(null); setClienteQ("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pos.chargeError"));
    }
  }

  return (
    <div>
      <input ref={inputRef} placeholder={t("pos.searchPh")} value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)} onKeyDown={onEnter} autoFocus />
      {resultados.length > 0 && (
        <div className="card" style={{ background: "var(--surface-2)", marginTop: 6, maxHeight: 220, overflowY: "auto" }}>
          {resultados.map((p) => (
            <div className="list-item" key={p.id} style={{ cursor: "pointer" }} onClick={() => agregar(p)}>
              <div><strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span><br /><span className="muted small">{t("pos.stock")}: {num(p.stock)} {p.unidad}</span></div>
              <strong>{money(p.precioVenta)}</strong>
            </div>
          ))}
        </div>
      )}

      {carrito.length === 0 ? (
        <p className="muted small" style={{ marginTop: 12 }}>{t("pos.emptyCart")}</p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {carrito.map((l, i) => (
            <div className="list-item" key={i}>
              <div style={{ flex: 1 }}>
                <strong>{l.nombre}</strong><br /><span className="muted small">{money(l.precioUnit)} {t("pos.each")}{l.impuestoPct > 0 ? ` · ITBIS ${l.impuestoPct}%` : ""}</span>
              </div>
              <input type="number" min="0" step="1" value={l.cantidad} onChange={(e) => setCant(i, Number(e.target.value))} style={{ width: 70 }} />
              <strong style={{ minWidth: 80, textAlign: "right" }}>{money(l.cantidad * l.precioUnit)}</strong>
            </div>
          ))}
          <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
            <div className="row spread"><span className="muted small">{t("pos.subtotal")}</span><span>{money(subtotal)}</span></div>
            {impuesto > 0 && <div className="row spread"><span className="muted small">{t("pos.tax")}</span><span>{money(impuesto)}</span></div>}
            <div className="row spread" style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}><span>{t("pos.total")}</span><span className="grad-text">{money(total)}</span></div>
            <label style={{ marginTop: 10 }}>{t("pos.paymentMethod")}</label>
            <select value={metodoPago} onChange={(e) => { setMetodoPago(e.target.value); if (e.target.value !== "fiado") { setClienteSel(null); setClienteQ(""); } }}>
              <option value="efectivo">{t("pos.cash")}</option>
              <option value="tarjeta">{t("pos.card")}</option>
              <option value="transferencia">{t("pos.transfer")}</option>
              {credit && <option value="fiado">{t("pos.credit")}</option>}
              <option value="otro">{t("pos.other")}</option>
            </select>
            {metodoPago === "fiado" && (
              <div style={{ marginTop: 8 }}>
                {clienteSel ? (
                  <div className="row spread">
                    <span className="small">{t("pos.creditTo")} <strong>{clienteSel.nombre}</strong> {Number(clienteSel.saldoFiado) > 0 && <span className="muted">({t("pos.alreadyOwes")} {money(clienteSel.saldoFiado)})</span>}</span>
                    <button type="button" className="ghost small" onClick={() => setClienteSel(null)}>{t("pos.change")}</button>
                  </div>
                ) : (
                  <>
                    <input placeholder={t("pos.searchCustomerPh")} value={clienteQ} onChange={(e) => setClienteQ(e.target.value)} />
                    {clienteResultados.length > 0 && (
                      <div className="card" style={{ background: "var(--surface-3)", marginTop: 6, maxHeight: 160, overflowY: "auto" }}>
                        {clienteResultados.map((c) => (
                          <div className="list-item" key={c.id} style={{ cursor: "pointer" }} onClick={() => { setClienteSel(c); setClienteQ(""); setClienteResultados([]); }}>
                            <span>{c.nombre}</span>
                            <span className="muted small">{c.telefono ?? ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            <button className="primary" style={{ width: "100%", marginTop: 12 }} onClick={cobrar}>{t("pos.charge")} {money(total)}</button>
          </div>
        </div>
      )}
      {msg && <p className="success" style={{ marginTop: 8 }}>{msg}</p>}
      {error && <p className="error" style={{ marginTop: 8 }}>{error}</p>}
    </div>
  );
}

// Campos editables de un producto (todo menos el stock, que se mueve por /stock).
interface FormProducto {
  nombre: string; sku: string; categoria: string; precioVenta: string; impuestoPct: string; stock: string; unidad: string; stockMinimo: string;
  volumenMl: string; nicotinaMg: string; productoFuenteId: string; rendimientoPorVenta: string;
}
const formVacio: FormProducto = {
  nombre: "", sku: "", categoria: "", precioVenta: "", impuestoPct: "0", stock: "0", unidad: "UND", stockMinimo: "0",
  volumenMl: "", nicotinaMg: "", productoFuenteId: "", rendimientoPorVenta: "",
};
function formDeProducto(p: Producto): FormProducto {
  return {
    nombre: p.nombre, sku: p.sku ?? "", categoria: p.categoria ?? "", precioVenta: String(num(p.precioVenta)), impuestoPct: String(num(p.impuestoPct)), stock: String(num(p.stock)), unidad: p.unidad, stockMinimo: String(num(p.stockMinimo)),
    volumenMl: p.volumenMl != null ? String(num(p.volumenMl)) : "", nicotinaMg: p.nicotinaMg != null ? String(num(p.nicotinaMg)) : "",
    productoFuenteId: p.productoFuenteId ?? "", rendimientoPorVenta: p.rendimientoPorVenta != null ? String(num(p.rendimientoPorVenta)) : "",
  };
}

// Campos comunes del formulario (nombre/sku/categoría/precio/impuesto/stock mínimo/ml/mg/recarga).
// `incluirStockInicial` solo aplica al crear: al editar el stock se mueve con +Entrada/−Salida.
// `otrosProductos` + `propioId`: para el selector "esto descuenta de" (recargas), excluyéndose
// a sí mismo para no poder apuntar un producto a sí mismo como fuente.
function CamposProducto({ f, onChange, incluirStockInicial, otrosProductos, propioId }: {
  f: FormProducto; onChange: (f: FormProducto) => void; incluirStockInicial: boolean; otrosProductos: Producto[]; propioId?: string;
}) {
  const { t } = useT();
  const candidatosFuente = otrosProductos.filter((p) => p.id !== propioId && !p.productoFuenteId);
  return (
    <>
      <label>{t("pos.name")}</label>
      <input value={f.nombre} onChange={(e) => onChange({ ...f, nombre: e.target.value })} required />
      <label>{t("pos.skuOpt")}</label>
      <input value={f.sku} onChange={(e) => onChange({ ...f, sku: e.target.value })} />
      <label>{t("pos.categoryOpt")}</label>
      <input value={f.categoria} onChange={(e) => onChange({ ...f, categoria: e.target.value })} />
      <div className="grid grid-2">
        <div><label>{t("pos.salePrice")}</label><input type="number" step="0.01" min="0" value={f.precioVenta} onChange={(e) => onChange({ ...f, precioVenta: e.target.value })} required /></div>
        <div><label>{t("pos.taxPct")}</label><input type="number" step="0.01" min="0" value={f.impuestoPct} onChange={(e) => onChange({ ...f, impuestoPct: e.target.value })} /></div>
        {incluirStockInicial && <div><label>{t("pos.initialStock")}</label><input type="number" step="0.001" value={f.stock} onChange={(e) => onChange({ ...f, stock: e.target.value })} /></div>}
        <div><label>{t("pos.minStock")}</label><input type="number" step="0.001" min="0" value={f.stockMinimo} onChange={(e) => onChange({ ...f, stockMinimo: e.target.value })} /></div>
        <div><label>{t("pos.volumeMl")}</label><input type="number" step="0.01" min="0" value={f.volumenMl} onChange={(e) => onChange({ ...f, volumenMl: e.target.value })} placeholder="30" /></div>
        <div><label>{t("pos.nicotineMg")}</label><input type="number" step="0.01" min="0" value={f.nicotinaMg} onChange={(e) => onChange({ ...f, nicotinaMg: e.target.value })} placeholder="6" /></div>
      </div>

      {candidatosFuente.length > 0 && (
        <>
          <label style={{ marginTop: 8 }}>{t("pos.sourceProduct")}</label>
          <p className="muted small" style={{ margin: "0 0 6px" }}>{t("pos.sourceProductHelp")}</p>
          <select value={f.productoFuenteId} onChange={(e) => onChange({ ...f, productoFuenteId: e.target.value })}>
            <option value="">{t("pos.sourceProductNone")}</option>
            {candidatosFuente.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.unidad ? ` (${p.unidad})` : ""}</option>)}
          </select>
          {f.productoFuenteId && (
            <div style={{ marginTop: 6 }}>
              <label>{t("pos.yieldPerSale")}</label>
              <input type="number" step="0.001" min="0" value={f.rendimientoPorVenta} onChange={(e) => onChange({ ...f, rendimientoPorVenta: e.target.value })} placeholder="3" />
            </div>
          )}
        </>
      )}
    </>
  );
}

// ---------- PRODUCTOS (Inventario) ----------
export function Productos({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState<FormProducto>(formVacio);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [fe, setFe] = useState<FormProducto>(formVacio);
  const [error, setError] = useState("");

  function cargar() { api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}`).then((r) => setProductos(r.productos)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  // Los campos opcionales llegan como string vacío desde el form (input vacío) — hay que
  // mandarlos como null, si no z.coerce.number() del backend falla al intentar convertir "".
  function paraEnviar(datos: FormProducto) {
    return {
      ...datos,
      volumenMl: datos.volumenMl === "" ? null : datos.volumenMl,
      nicotinaMg: datos.nicotinaMg === "" ? null : datos.nicotinaMg,
      productoFuenteId: datos.productoFuenteId === "" ? null : datos.productoFuenteId,
      rendimientoPorVenta: datos.rendimientoPorVenta === "" ? null : datos.rendimientoPorVenta,
    };
  }

  function validarFuente(datos: FormProducto): string | null {
    if (datos.productoFuenteId && !datos.rendimientoPorVenta) return t("pos.yieldRequired");
    return null;
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const err0 = validarFuente(f);
    if (err0) { setError(err0); return; }
    try { await api.post("/inventario", { ...paraEnviar(f), negocioId: negocio.id }); setF(formVacio); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  function empezarEdicion(p: Producto) { setEditandoId(p.id); setFe(formDeProducto(p)); setError(""); }

  async function guardarEdicion(e: React.FormEvent) {
    e.preventDefault();
    if (!editandoId) return;
    setError("");
    const err0 = validarFuente(fe);
    if (err0) { setError(err0); return; }
    try {
      const { stock: _stock, ...cambios } = paraEnviar(fe); // el stock no se toca por acá
      await api.patch(`/inventario/${editandoId}`, cambios);
      setEditandoId(null); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function ajustar(p: Producto, tipo: "entrada" | "salida") {
    const etiqueta = tipo === "entrada" ? t("pos.stockInPrompt") : t("pos.stockOutPrompt");
    const v = prompt(`${etiqueta} ${t("pos.stockPromptSuffix")} "${p.nombre}" (${t("pos.quantity")}):`);
    if (!v) return;
    await api.post(`/inventario/${p.id}/stock`, { tipo, cantidad: Number(v), motivo: tipo });
    cargar();
  }

  return (
    <div>
      <div className="row spread">
        <span className="muted small">{productos.length} {t("pos.products")}</span>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => { setNuevo((v) => !v); setEditandoId(null); }}>{nuevo ? t("common.cancel") : t("pos.newProduct")}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <CamposProducto f={f} onChange={setF} incluirStockInicial otrosProductos={productos} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>{t("pos.saveProduct")}</button>
        </form>
      )}
      {productos.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>{t("pos.noProducts")}</p>
      ) : (
        productos.map((p) => {
          const bajo = num(p.stock) <= num(p.stockMinimo);
          if (editandoId === p.id) {
            return (
              <form key={p.id} onSubmit={guardarEdicion} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
                <CamposProducto f={fe} onChange={setFe} incluirStockInicial={false} otrosProductos={productos} propioId={p.id} />
                {error && <p className="error small">{error}</p>}
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary">{t("pos.saveChanges")}</button>
                  <button type="button" className="ghost" onClick={() => setEditandoId(null)}>{t("common.cancel")}</button>
                </div>
              </form>
            );
          }
          const fuente = p.productoFuenteId ? productos.find((x) => x.id === p.productoFuenteId) : null;
          const atributos = [p.volumenMl != null ? `${num(p.volumenMl)}ml` : null, p.nicotinaMg != null ? `${num(p.nicotinaMg)}mg` : null].filter(Boolean).join(" · ");
          return (
            <div className="list-item" key={p.id}>
              <div>
                <strong>{p.nombre}</strong> <span className="muted small">{p.sku ?? ""}</span>{atributos && <span className="muted small"> · {atributos}</span>}<br />
                {fuente ? (
                  <span className="badge">{t("pos.refillOf")} {fuente.nombre}</span>
                ) : (
                  <span className={`badge ${bajo ? "err" : "ok"}`}>{t("pos.stock")}: {num(p.stock)} {p.unidad}</span>
                )}
                <span className="muted small"> · {money(p.precioVenta)}</span>
              </div>
              <div className="row">
                <button className="ghost small" onClick={() => empezarEdicion(p)}>{t("pos.edit")}</button>
                {!fuente && <button className="ghost small" onClick={() => ajustar(p, "entrada")}>{t("pos.stockIn")}</button>}
                {!fuente && <button className="ghost small" onClick={() => ajustar(p, "salida")}>{t("pos.stockOut")}</button>}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ---------- CAJA ----------
export function Caja({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [resumen, setResumen] = useState<{ conteo: number; total: number; porMetodo: Record<string, number> } | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");

  function cargar() {
    api.get<{ sesion: Sesion | null }>(`/pos/caja/actual?negocioId=${negocio.id}`).then((r) => setSesion(r.sesion)).catch(() => {});
    api.get<{ ventas: Venta[]; resumen: { conteo: number; total: number; porMetodo: Record<string, number> } }>(`/pos/ventas?negocioId=${negocio.id}`)
      .then((r) => { setVentas(r.ventas); setResumen(r.resumen); }).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  async function abrir() { await api.post("/pos/caja/abrir", { negocioId: negocio.id, montoInicial: monto || 0 }); setMonto(""); setMsg(t("pos.cashOpened")); cargar(); }
  async function cerrar() {
    const r = await api.post<{ esperado: number; descuadre: number }>("/pos/caja/cerrar", { negocioId: negocio.id, montoFinal: monto || 0 });
    setMsg(`${t("pos.cashClosed")} ${t("pos.expected")}: ${money(r.esperado)} · ${t("pos.discrepancy")}: ${money(r.descuadre)}`); setMonto(""); cargar();
  }

  return (
    <div>
      {resumen && (
        <div className="card" style={{ background: "var(--surface-2)" }}>
          <div className="row spread"><strong>{t("pos.salesToday")}</strong><span className="grad-text" style={{ fontWeight: 800 }}>{money(resumen.total)}</span></div>
          <span className="muted small">{resumen.conteo} {t("pos.sales")} · {Object.entries(resumen.porMetodo).map(([m, t2]) => `${m}: ${money(t2)}`).join(" · ") || "—"}</span>
        </div>
      )}
      <div className="card" style={{ marginTop: 10 }}>
        {sesion ? (
          <>
            <p className="small">🟢 {t("pos.cashOpenSince")} <strong>{t("pos.open")}</strong> {t("pos.since")} {new Date(sesion.abiertaEn).toLocaleString()} · {t("pos.initial")} {money(sesion.montoInicial)}</p>
            <label>{t("pos.finalAmountCount")}</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={cerrar}>{t("pos.closeCash")}</button>
          </>
        ) : (
          <>
            <p className="small">🔴 {t("pos.noOpenCash")}</p>
            <label>{t("pos.initialAmount")}</label>
            <input type="number" step="0.01" min="0" value={monto} onChange={(e) => setMonto(e.target.value)} />
            <button className="primary" style={{ marginTop: 10 }} onClick={abrir}>{t("pos.openCash")}</button>
          </>
        )}
        {msg && <p className="success small" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
      {ventas.length > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <strong className="small">{t("pos.recentSales")}</strong>
          {ventas.slice(0, 10).map((v) => (
            <div className="list-item" key={v.id}><span className="muted small">{new Date(v.createdAt).toLocaleTimeString()} · {v.metodoPago}</span><strong>{money(v.total)}</strong></div>
          ))}
        </div>
      )}
    </div>
  );
}
