import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { hoyLocal, formatFechaLocal } from "../dateUtils";
import { useT } from "../i18n";

// Módulo COMPRAS (reposición de inventario desde proveedores). Dos pasos separados: crear la
// orden (todavía no toca stock) y recibirla cuando el pedido realmente llega (ahí sí entra al
// inventario) — o, para una compra de contado que ya se está llevando, registrarla recibida
// directamente, como antes.
interface Producto { id: string; nombre: string; costo: string | number | null }
interface LineaCompra { productoId?: string; nombre: string; cantidad: number; costoUnit: number }
interface Compra { id: string; proveedor: string | null; total: string | number; fecha: string; estado: "pendiente" | "recibida"; lineas: { nombre: string; cantidad: string | number; costoUnit: string | number }[] }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const hoy = hoyLocal;

export function ComprasView({ negocio, puedeCrear = true, puedeEliminar = true }: { negocio: Negocio; puedeCrear?: boolean; puedeEliminar?: boolean }) {
  const { t } = useT();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [fecha, setFecha] = useState(hoy());
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [l, setL] = useState({ productoId: "", nombre: "", cantidad: "1", costoUnit: "" });
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [recibiendo, setRecibiendo] = useState<string | null>(null);

  async function borrar(id: string) { await api.del(`/compras/${id}`); cargar(); }

  async function recibir(id: string) {
    setRecibiendo(id); setError("");
    try { await api.post(`/compras/${id}/recibir`, {}); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
    finally { setRecibiendo(null); }
  }

  function cargar() {
    api.get<{ productos: Producto[] }>(`/inventario?negocioId=${negocio.id}`).then((r) => setProductos(r.productos)).catch(() => {});
    api.get<{ compras: Compra[] }>(`/compras?negocioId=${negocio.id}`).then((r) => setCompras(r.compras)).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  function agregarLinea() {
    const nombre = l.productoId ? (productos.find((p) => p.id === l.productoId)?.nombre ?? l.nombre) : l.nombre;
    if (!nombre || !l.costoUnit) return;
    setLineas((xs) => [...xs, { productoId: l.productoId || undefined, nombre, cantidad: Number(l.cantidad), costoUnit: Number(l.costoUnit) }]);
    setL({ productoId: "", nombre: "", cantidad: "1", costoUnit: "" });
  }

  async function guardar(e: React.FormEvent, recibirAhora: boolean) {
    e.preventDefault(); setError(""); setMsg("");
    if (lineas.length === 0) { setError(t("compras.needLine")); return; }
    try {
      await api.post("/compras", { negocioId: negocio.id, proveedor, fecha, lineas, recibirAhora });
      setMsg(recibirAhora ? t("compras.registered") : t("compras.orderSaved"));
      setLineas([]); setProveedor(""); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  const total = lineas.reduce((s, x) => s + x.cantidad * x.costoUnit, 0);
  const pendientes = compras.filter((c) => c.estado === "pendiente");
  const recibidas = compras.filter((c) => c.estado === "recibida");

  return (
    <div className="card">
      <h2>{t("compras.title")}</h2>
      {puedeCrear && (
      <form onSubmit={(e) => guardar(e, true)}>
        <div className="grid grid-2">
          <div><label>{t("compras.supplier")}</label><input value={proveedor} onChange={(e) => setProveedor(e.target.value)} /></div>
          <div><label>{t("compras.date")}</label><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required /></div>
        </div>

        <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>{t("compras.product")}</label>
              <select value={l.productoId} onChange={(e) => setL({ ...l, productoId: e.target.value })}>
                <option value="">{t("compras.otherWriteBelow")}</option>
                {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div><label>{t("compras.nameIfOther")}</label><input value={l.nombre} onChange={(e) => setL({ ...l, nombre: e.target.value })} disabled={!!l.productoId} /></div>
            <div><label>{t("compras.quantity")}</label><input type="number" step="0.001" min="0" value={l.cantidad} onChange={(e) => setL({ ...l, cantidad: e.target.value })} /></div>
            <div><label>{t("compras.unitCost")}</label><input type="number" step="0.01" min="0" value={l.costoUnit} onChange={(e) => setL({ ...l, costoUnit: e.target.value })} /></div>
          </div>
          <button type="button" className="ghost" style={{ marginTop: 8 }} onClick={agregarLinea}>{t("compras.addLine")}</button>
        </div>

        {lineas.map((x, i) => (
          <div className="list-item" key={i}>
            <div>{x.cantidad}× {x.nombre} {x.productoId ? <span className="badge ok">{t("compras.stockUp")}</span> : null}</div>
            <div className="row"><strong>{money(x.cantidad * x.costoUnit)}</strong><button type="button" className="ghost small" onClick={() => setLineas((xs) => xs.filter((_, k) => k !== i))}>✕</button></div>
          </div>
        ))}
        {lineas.length > 0 && <div className="row spread" style={{ marginTop: 8, fontWeight: 800 }}><span>{t("compras.total")}</span><span className="grad-text">{money(total)}</span></div>}
        {error && <p className="error small">{error}</p>}
        {msg && <p className="success small">{msg}</p>}
        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" className="ghost" style={{ flex: 1 }} disabled={lineas.length === 0} onClick={(e) => guardar(e, false)}>{t("compras.saveOrderBtn")}</button>
          <button className="primary" style={{ flex: 1 }} disabled={lineas.length === 0}>{t("compras.registerBtn")}</button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>{t("compras.orderHelp")}</p>
      </form>
      )}

      {pendientes.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong className="small">{t("compras.pending")}</strong>
          {pendientes.map((c) => (
            <div key={c.id}>
              <div className="list-item">
                <span className="muted small">{formatFechaLocal(c.fecha)} · {c.proveedor ?? "—"} · {c.lineas.length} {t("compras.items")}</span>
                <div className="row">
                  <strong>{money(c.total)}</strong>
                  {puedeCrear && <button type="button" className="primary small" disabled={recibiendo === c.id} onClick={() => recibir(c.id)}>{t("compras.receive")}</button>}
                  {puedeEliminar && <button type="button" className="ghost small" onClick={() => borrar(c.id)}>✕</button>}
                </div>
              </div>
              <p className="muted small" style={{ margin: "0 0 6px" }}>{c.lineas.map((x) => `${x.cantidad}× ${x.nombre}`).join(" · ")}</p>
            </div>
          ))}
        </div>
      )}

      {recibidas.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong className="small">{t("compras.recent")}</strong>
          {recibidas.slice(0, 8).map((c) => (
            <div className="list-item" key={c.id}>
              <span className="muted small">{formatFechaLocal(c.fecha)} · {c.proveedor ?? "—"} · {c.lineas.length} {t("compras.items")}</span>
              <div className="row"><strong>{money(c.total)}</strong>{puedeEliminar && <button type="button" className="ghost small" onClick={() => borrar(c.id)}>✕</button>}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
