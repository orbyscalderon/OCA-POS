import { useEffect, useState } from "react";
import { api, ApiError, type Negocio, type RolNegocio } from "../api";
import { Stat } from "./Ui";
import { hoyLocal, formatFechaLocal } from "../dateUtils";

// Módulo AGRO (granja avícola): lotes/camadas con mortalidad, alimento, conversión (FCR)
// y costeo real (alimento, sanidad, mano de obra…) para saber el margen de cada venta.
interface LoteResumen {
  id: string; nombre: string; especie: string; tipoProduccion: string; cantidadInicial: number;
  estado: string; avesVivas: number; mortalidadPct: number; alimentoTotalKg: number; produccionTotal: number; edadDias: number; fcr: number | null;
  costoTotal: number; costoPorAve: number; costoPorKg: number | null; ingresoTotal: number; margen: number; margenPct: number | null;
}
interface Registro { id: string; fecha: string; mortalidad: number; alimentoKg: string | number; pesoPromedioG: string | number | null; produccion: number; notas: string | null }
interface Costo { id: string; tipoCosto: string | null; categoria: string | null; descripcion: string; monto: string | number; fecha: string }
interface ProductoLote { id: string; nombre: string; precioVenta: string | number; stock: string | number }
interface TipoCosto { value: string; label: string }
const hoy = hoyLocal;
const fecha = formatFechaLocal;
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function AgroView({ negocio, miRol }: { negocio: Negocio; miRol?: RolNegocio }) {
  void miRol; // el acceso al módulo ya se filtra en AdminView; acá todo el que entra ve todo el módulo.
  const [lotes, setLotes] = useState<LoteResumen[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [f, setF] = useState({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy(), costoInicial: "" });
  const [error, setError] = useState("");

  function cargar() { api.get<{ lotes: LoteResumen[] }>(`/agro/lotes?negocioId=${negocio.id}`).then((r) => setLotes(r.lotes)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      await api.post("/agro/lotes", { ...f, negocioId: negocio.id, costoInicial: f.costoInicial || undefined });
      setF({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy(), costoInicial: "" });
      setNuevo(false); cargar();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>🥚 Producción avícola</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? "Cerrar" : "+ Nuevo lote"}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <label>Nombre del lote/camada</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required placeholder="Ej: Galpón 3 — Agosto" />
          <div className="grid grid-2">
            <div><label>Especie</label>
              <select value={f.especie} onChange={(e) => setF({ ...f, especie: e.target.value })}>
                <option value="broiler">Pollo de engorde (broiler)</option>
                <option value="layer">Gallina ponedora (layer)</option>
              </select>
            </div>
            <div><label>Producción</label>
              <select value={f.tipoProduccion} onChange={(e) => setF({ ...f, tipoProduccion: e.target.value })}>
                <option value="meat">Carne</option>
                <option value="eggs">Huevos</option>
              </select>
            </div>
            <div><label>Cantidad inicial de aves</label><input type="number" min="1" value={f.cantidadInicial} onChange={(e) => setF({ ...f, cantidadInicial: e.target.value })} required /></div>
            <div><label>Fecha de ingreso</label><input type="date" value={f.fechaInicio} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} required /></div>
            <div><label>Costo de los pollitos BB (opcional)</label><input type="number" step="0.01" min="0" value={f.costoInicial} onChange={(e) => setF({ ...f, costoInicial: e.target.value })} placeholder="0.00" /></div>
          </div>
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>Crear lote</button>
        </form>
      )}

      {lotes.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>Aún no hay lotes.</p>
      ) : (
        lotes.map((l) => (
          <div className="list-item" key={l.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{l.nombre}</h3>
                <span className="muted small">{l.especie === "broiler" ? "Engorde" : "Ponedora"} · {l.tipoProduccion === "meat" ? "carne" : "huevos"} · {l.edadDias} días</span>
              </div>
              <span className={`badge ${l.estado === "cerrado" ? "" : "ok"}`}>{l.estado}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="badge ok">Vivas: {l.avesVivas}/{l.cantidadInicial}</span>
              <span className={`badge ${l.mortalidadPct > 5 ? "err" : "warn"}`}>Mortalidad: {l.mortalidadPct}%</span>
              <span className="badge">Alimento: {l.alimentoTotalKg} kg</span>
              {l.tipoProduccion === "eggs" && <span className="badge">Huevos: {l.produccionTotal}</span>}
              {l.fcr != null && <span className="badge">FCR: {l.fcr}</span>}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="badge">Costo total: {money(l.costoTotal)}</span>
              {l.costoPorKg != null && <span className="badge">Costo/kg: {money(l.costoPorKg)}</span>}
              <span className="badge">Costo/ave: {money(l.costoPorAve)}</span>
              <span className="badge ok">Ingreso: {money(l.ingresoTotal)}</span>
              {l.margenPct != null && (
                <span className={`badge ${l.margen >= 0 ? "ok" : "err"}`}>Margen: {money(l.margen)} ({l.margenPct}%)</span>
              )}
            </div>
            <div className="row spread">
              <span className="muted small" />
              <button className="ghost small" onClick={() => setAbierto(abierto === l.id ? null : l.id)}>{abierto === l.id ? "Ocultar" : "Ver detalle, costos y registro diario"}</button>
            </div>
            {abierto === l.id && <DetalleLote loteId={l.id} negocioId={negocio.id} onCambio={cargar} />}
          </div>
        ))
      )}
    </div>
  );
}

function DetalleLote({ loteId, negocioId, onCambio }: { loteId: string; negocioId: string; onCambio: () => void }) {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [costos, setCostos] = useState<Costo[]>([]);
  const [productosLote, setProductosLote] = useState<ProductoLote[]>([]);
  const [tiposCosto, setTiposCosto] = useState<TipoCosto[]>([]);
  const [metricas, setMetricas] = useState<LoteResumen | null>(null);
  const [tab, setTab] = useState<"diario" | "costos" | "productos">("diario");
  const [r, setR] = useState({ fecha: hoy(), mortalidad: "0", alimentoKg: "0", pesoPromedioG: "", produccion: "0" });
  const [c, setC] = useState({ tipoCosto: "feed", monto: "", fecha: hoy(), descripcion: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function cargar() {
    api.get<{
      lote: { registros: Registro[]; gastos: Costo[]; productos: ProductoLote[] };
      metricas: LoteResumen;
      tiposCosto: TipoCosto[];
    }>(`/agro/lotes/${loteId}`)
      .then((res) => {
        setRegistros(res.lote.registros); setCostos(res.lote.gastos);
        setProductosLote(res.lote.productos); setMetricas(res.metricas); setTiposCosto(res.tiposCosto);
      }).catch(() => {});
  }
  useEffect(cargar, [loteId]);

  const [productosNegocio, setProductosNegocio] = useState<ProductoLote[]>([]);
  useEffect(() => {
    api.get<{ productos: ProductoLote[] }>(`/inventario?negocioId=${negocioId}`).then((res) => setProductosNegocio(res.productos)).catch(() => {});
  }, [negocioId]);

  async function guardarRegistro(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    await api.post(`/agro/lotes/${loteId}/registros`, r);
    setMsg("Registro guardado.");
    cargar(); onCambio();
  }

  async function agregarCosto(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      await api.post(`/agro/lotes/${loteId}/costos`, c);
      setC({ tipoCosto: c.tipoCosto, monto: "", fecha: hoy(), descripcion: "" });
      cargar(); onCambio();
    } catch (err) { setError(err instanceof ApiError ? err.message : "Error"); }
  }

  async function borrarCosto(id: string) {
    await api.del(`/agro/lotes/${loteId}/costos/${id}`);
    cargar(); onCambio();
  }

  async function vincular(productoId: string) {
    if (!productoId) return;
    await api.post(`/agro/lotes/${loteId}/productos/${productoId}`, {});
    cargar(); onCambio();
  }
  async function desvincular(productoId: string) {
    await api.del(`/agro/lotes/${loteId}/productos/${productoId}`);
    cargar(); onCambio();
  }

  const vinculadosIds = new Set(productosLote.map((p) => p.id));
  const disponiblesParaVincular = productosNegocio.filter((p) => !vinculadosIds.has(p.id));

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
      {metricas && (
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <Stat label="Costo total" value={money(metricas.costoTotal)} icon="💸" />
          <Stat label="Ingreso por ventas" value={money(metricas.ingresoTotal)} icon="💰" variant="green" />
          <Stat label="Margen" value={`${money(metricas.margen)}${metricas.margenPct != null ? ` (${metricas.margenPct}%)` : ""}`} icon={metricas.margen >= 0 ? "📈" : "📉"} variant={metricas.margen >= 0 ? "green" : "accent"} />
          {metricas.costoPorKg != null && <Stat label="Costo por kg" value={money(metricas.costoPorKg)} icon="⚖️" />}
        </div>
      )}

      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tab ${tab === "diario" ? "active" : ""}`} onClick={() => setTab("diario")}>Registro diario</button>
        <button className={`tab ${tab === "costos" ? "active" : ""}`} onClick={() => setTab("costos")}>Costos</button>
        <button className={`tab ${tab === "productos" ? "active" : ""}`} onClick={() => setTab("productos")}>Productos vinculados</button>
      </div>

      {tab === "diario" && (
        <>
          <form onSubmit={guardarRegistro}>
            <div className="grid grid-2">
              <div><label>Fecha</label><input type="date" value={r.fecha} onChange={(e) => setR({ ...r, fecha: e.target.value })} required /></div>
              <div><label>Mortalidad (aves)</label><input type="number" min="0" value={r.mortalidad} onChange={(e) => setR({ ...r, mortalidad: e.target.value })} /></div>
              <div><label>Alimento (kg)</label><input type="number" step="0.001" min="0" value={r.alimentoKg} onChange={(e) => setR({ ...r, alimentoKg: e.target.value })} /></div>
              <div><label>Peso promedio (g)</label><input type="number" step="0.1" min="0" value={r.pesoPromedioG} onChange={(e) => setR({ ...r, pesoPromedioG: e.target.value })} /></div>
              <div><label>Producción (huevos)</label><input type="number" min="0" value={r.produccion} onChange={(e) => setR({ ...r, produccion: e.target.value })} /></div>
            </div>
            <button className="primary" style={{ marginTop: 10 }}>Guardar registro del día</button>
            {msg && <span className="success small" style={{ marginLeft: 10 }}>{msg}</span>}
          </form>

          {registros.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", color: "var(--faint)" }}>
                  <th style={{ padding: "4px 6px" }}>Fecha</th><th style={{ padding: "4px 6px", textAlign: "right" }}>Mort.</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Alim. kg</th><th style={{ padding: "4px 6px", textAlign: "right" }}>Peso g</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>Prod.</th>
                </tr></thead>
                <tbody>
                  {registros.map((x) => (
                    <tr key={x.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 6px" }}>{fecha(x.fecha)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.mortalidad}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{Number(x.alimentoKg)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.pesoPromedioG != null ? Number(x.pesoPromedioG) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.produccion}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "costos" && (
        <>
          <p className="muted small">Cada peso que gastas criando este lote (alimento, vacunas, mano de obra…) para saber el costo real y el margen cuando vendas.</p>
          <form onSubmit={agregarCosto} className="grid grid-2">
            <div><label>Tipo de costo</label>
              <select value={c.tipoCosto} onChange={(e) => setC({ ...c, tipoCosto: e.target.value })}>
                {tiposCosto.map((tc) => <option key={tc.value} value={tc.value}>{tc.label}</option>)}
              </select>
            </div>
            <div><label>Monto</label><input type="number" step="0.01" min="0.01" value={c.monto} onChange={(e) => setC({ ...c, monto: e.target.value })} required /></div>
            <div><label>Fecha</label><input type="date" value={c.fecha} onChange={(e) => setC({ ...c, fecha: e.target.value })} required /></div>
            <div><label>Descripción (opcional)</label><input value={c.descripcion} onChange={(e) => setC({ ...c, descripcion: e.target.value })} placeholder="Ej: 2 sacos de iniciador" /></div>
            {error && <p className="error small" style={{ gridColumn: "1 / -1" }}>{error}</p>}
            <button className="primary" style={{ gridColumn: "1 / -1", marginTop: 4 }}>+ Agregar costo</button>
          </form>

          {costos.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>Sin costos registrados todavía.</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              {costos.map((g) => (
                <div className="list-item" key={g.id}>
                  <div><strong>{g.categoria ?? "Costo"}</strong> {g.descripcion && <span className="muted small">· {g.descripcion}</span>}<br /><span className="muted small">{fecha(g.fecha)}</span></div>
                  <div className="row"><strong>{money(g.monto)}</strong><button className="ghost small" onClick={() => borrarCosto(g.id)}>✕</button></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "productos" && (
        <>
          <p className="muted small">Vincula los productos que salen de este lote (ej. "Pollo entero", "Menudencia"): sus ventas se suman como ingreso real de este lote.</p>
          {productosLote.length === 0 ? (
            <p className="muted small">Ningún producto vinculado todavía.</p>
          ) : (
            productosLote.map((p) => (
              <div className="list-item" key={p.id}>
                <div><strong>{p.nombre}</strong> <span className="muted small">· {money(p.precioVenta)} · stock {Number(p.stock)}</span></div>
                <button className="ghost small" onClick={() => desvincular(p.id)}>Desvincular</button>
              </div>
            ))
          )}
          {disponiblesParaVincular.length > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <select defaultValue="" onChange={(e) => { vincular(e.target.value); e.target.value = ""; }}>
                <option value="" disabled>Vincular producto existente…</option>
                {disponiblesParaVincular.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}
        </>
      )}
    </div>
  );
}
