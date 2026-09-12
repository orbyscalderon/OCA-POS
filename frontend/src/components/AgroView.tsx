import { useEffect, useState } from "react";
import { api, ApiError, type Negocio, type RolNegocio } from "../api";
import { Stat, usePrompt } from "./Ui";
import { hoyLocal, formatFechaLocal } from "../dateUtils";
import { useT, type TKey } from "../i18n";

// Módulo AGRO (granja avícola): lotes/camadas con mortalidad, alimento, conversión (FCR)
// y costeo real (alimento, sanidad, mano de obra…) para saber el margen de cada venta.
interface GalponRef { id: string; nombre: string; granja: { id: string; nombre: string } }
interface LoteResumen {
  id: string; nombre: string; especie: string; tipoProduccion: string; cantidadInicial: number;
  estado: string; lineaGenetica: string | null; galpon: GalponRef | null;
  avesVivas: number; mortalidadPct: number; alimentoTotalKg: number; produccionTotal: number; edadDias: number; fcr: number | null;
  gdp: number | null; iee: number | null; pesoEstandarG: number | null; desvioPesoPct: number | null;
  hdpPromedio: number | null; hhhPromedio: number | null; hdpEstandar: number | null;
  huevosBuenosTotal: number; huevosRotosTotal: number; huevosSuciosTotal: number;
  fechaLibreRetiro: string | null; enRetiro: boolean; alertaConsumo: boolean;
  costoTotal: number; costoPorAve: number; costoPorKg: number | null; ingresoTotal: number; margen: number; margenPct: number | null;
}
interface Galpon { id: string; nombre: string; capacidadAves: number | null; _count: { lotes: number } }
interface Granja { id: string; nombre: string; direccion: string | null; galpones: Galpon[] }
interface PuntoComparativa { edadDias: number; real: number | null; estandar: number | null }
interface Registro {
  id: string; fecha: string; mortalidad: number; alimentoKg: string | number; pesoPromedioG: string | number | null;
  produccion: number; notas: string | null;
  huevosJumbo: number; huevosExtra: number; huevosGrande: number; huevosMediano: number; huevosPequeno: number;
  huevosRotos: number; huevosSucios: number;
}
interface Costo { id: string; tipoCosto: string | null; categoria: string | null; descripcion: string; monto: string | number; fecha: string }
interface ProductoLote { id: string; nombre: string; precioVenta: string | number; stock: string | number }
interface TipoCosto { value: string; label: string }
interface Evento { id: string; tipo: string; nombre: string; fecha: string; diasRetiro: number | null; notas: string | null }
interface LineaGenetica { slug: string; nombre: string; especie: string }
const hoy = hoyLocal;
const fecha = formatFechaLocal;
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

// Gráfico de línea liviano sin dependencias — compara el valor real diario contra la curva
// estándar de la línea genética (peso para engorde, % de postura para ponedoras).
function MiniChart({ serie, labelReal, labelEstandar }: { serie: PuntoComparativa[]; labelReal: string; labelEstandar: string }) {
  const W = 600, H = 160, PAD = 22;
  const xs = serie.map((p) => p.edadDias);
  const ys = serie.flatMap((p) => [p.real, p.estandar]).filter((v): v is number => v != null);
  if (ys.length === 0) return null;
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const xScale = (x: number) => PAD + ((x - xMin) / Math.max(1, xMax - xMin)) * (W - PAD * 2);
  const yScale = (y: number) => H - PAD - ((y - yMin) / Math.max(1, yMax - yMin)) * (H - PAD * 2);
  const pathFor = (key: "real" | "estandar") => {
    const pts = serie.filter((p) => p[key] != null);
    if (pts.length < 2) return "";
    return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.edadDias).toFixed(1)} ${yScale(p[key]!).toFixed(1)}`).join(" ");
  };
  const dReal = pathFor("real");
  const dEstandar = pathFor("estandar");
  return (
    <div style={{ marginBottom: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block", background: "var(--surface)", borderRadius: 8 }}>
        {dEstandar && <path d={dEstandar} fill="none" stroke="var(--faint)" strokeWidth="2" strokeDasharray="5 4" />}
        {dReal && <path d={dReal} fill="none" stroke="var(--brand-400)" strokeWidth="2.5" />}
      </svg>
      <div className="row" style={{ gap: 14, marginTop: 4 }}>
        <span className="small"><span style={{ display: "inline-block", width: 10, height: 3, background: "var(--brand-400)", marginRight: 5 }} />{labelReal}</span>
        <span className="small muted"><span style={{ display: "inline-block", width: 10, height: 0, borderTop: "2px dashed var(--faint)", marginRight: 5 }} />{labelEstandar}</span>
      </div>
    </div>
  );
}

// El backend devuelve la etiqueta ya en español (categoria/label): la ignoramos y
// traducimos localmente a partir del código estable (tipoCosto/value), que no cambia.
const TIPO_COSTO_KEY: Record<string, TKey> = {
  livestock: "agro.tipoLivestock", feed: "agro.tipoFeed", medicine: "agro.tipoMedicine",
  supplies: "agro.tipoSupplies", labor: "agro.tipoLabor", utilities: "agro.tipoUtilities",
  transport: "agro.tipoTransport", other: "agro.tipoOther",
};

const TIPO_EVENTO_KEY: Record<string, TKey> = {
  vacuna: "agro.eventVaccine", vitamina: "agro.eventVitamin", tratamiento: "agro.eventTreatment",
  sintoma: "agro.eventSymptom", otro: "agro.eventOther",
};

export function AgroView({ negocio, miRol }: { negocio: Negocio; miRol?: RolNegocio }) {
  void miRol; // el acceso al módulo ya se filtra en AdminView; acá todo el que entra ve todo el módulo.
  const { t } = useT();
  const [lotes, setLotes] = useState<LoteResumen[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [f, setF] = useState({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy(), costoInicial: "", precioPollito: "", lineaGenetica: "", galponId: "" });
  const [lineas, setLineas] = useState<LineaGenetica[]>([]);
  const [granjas, setGranjas] = useState<Granja[]>([]);
  const [error, setError] = useState("");

  function cargar() { api.get<{ lotes: LoteResumen[] }>(`/agro/lotes?negocioId=${negocio.id}`).then((r) => setLotes(r.lotes)).catch(() => {}); }
  function cargarGranjas() { api.get<{ granjas: Granja[] }>(`/agro/granjas?negocioId=${negocio.id}`).then((r) => setGranjas(r.granjas)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);
  useEffect(cargarGranjas, [negocio.id]);
  useEffect(() => {
    api.get<{ lineas: LineaGenetica[] }>(`/agro/lineas-geneticas?especie=${f.especie}`).then((r) => setLineas(r.lineas)).catch(() => {});
    setF((prev) => ({ ...prev, lineaGenetica: "" }));
  }, [f.especie]);

  // Precio por pollito × cantidad = costo total de la cría — más fácil que sacar la cuenta a
  // mano cuando el proveedor cobra por unidad. Si no se usa, el costo total se escribe directo.
  const costoPollitosCalculado = f.precioPollito !== "" && f.cantidadInicial !== ""
    ? Number(f.precioPollito) * Number(f.cantidadInicial) : null;

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      const costoInicial = costoPollitosCalculado ?? (f.costoInicial ? Number(f.costoInicial) : undefined);
      await api.post("/agro/lotes", { ...f, negocioId: negocio.id, costoInicial, lineaGenetica: f.lineaGenetica || undefined, galponId: f.galponId || undefined });
      setF({ nombre: "", especie: "broiler", tipoProduccion: "meat", cantidadInicial: "", fechaInicio: hoy(), costoInicial: "", precioPollito: "", lineaGenetica: "", galponId: "" });
      setNuevo(false); cargar(); cargarGranjas();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("agro.title")}</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? t("common.cancel") : t("agro.newLot")}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <label>{t("agro.lotName")}</label>
          <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required placeholder={t("agro.lotNamePh")} />
          <div className="grid grid-2">
            <div><label>{t("agro.species")}</label>
              <select value={f.especie} onChange={(e) => setF({ ...f, especie: e.target.value })}>
                <option value="broiler">{t("agro.broiler")}</option>
                <option value="layer">{t("agro.layer")}</option>
              </select>
            </div>
            <div><label>{t("agro.production")}</label>
              <select value={f.tipoProduccion} onChange={(e) => setF({ ...f, tipoProduccion: e.target.value })}>
                <option value="meat">{t("agro.meat")}</option>
                <option value="eggs">{t("agro.eggs")}</option>
              </select>
            </div>
            <div><label>{t("agro.initialQty")}</label><input type="number" min="1" value={f.cantidadInicial} onChange={(e) => setF({ ...f, cantidadInicial: e.target.value })} required /></div>
            <div><label>{t("agro.entryDate")}</label><input type="date" value={f.fechaInicio} onChange={(e) => setF({ ...f, fechaInicio: e.target.value })} required /></div>
            <div><label>{t("agro.chickPrice")}</label><input type="number" step="0.01" min="0" value={f.precioPollito} onChange={(e) => setF({ ...f, precioPollito: e.target.value })} placeholder="0.00" /></div>
            {costoPollitosCalculado != null ? (
              <p className="small muted" style={{ gridColumn: "1 / -1", margin: "-4px 0 0" }}>{t("agro.chickCostTotal")}: {money(costoPollitosCalculado)}</p>
            ) : (
              <div><label>{t("agro.chickCost")}</label><input type="number" step="0.01" min="0" value={f.costoInicial} onChange={(e) => setF({ ...f, costoInicial: e.target.value })} placeholder="0.00" /></div>
            )}
            <div><label>{t("agro.geneticLine")}</label>
              <select value={f.lineaGenetica} onChange={(e) => setF({ ...f, lineaGenetica: e.target.value })}>
                <option value="">{t("agro.geneticLineNone")}</option>
                {lineas.map((ln) => <option key={ln.slug} value={ln.slug}>{ln.nombre}</option>)}
              </select>
            </div>
            <div><label>{t("agro.location")}</label>
              <select value={f.galponId} onChange={(e) => setF({ ...f, galponId: e.target.value })}>
                <option value="">{t("agro.noLocation")}</option>
                {granjas.map((g) => (
                  <optgroup key={g.id} label={g.nombre}>
                    {g.galpones.map((gp) => <option key={gp.id} value={gp.id}>{gp.nombre}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>{t("agro.createLot")}</button>
        </form>
      )}

      <GestionGranjas negocioId={negocio.id} granjas={granjas} onCambio={() => { cargarGranjas(); cargar(); }} />

      {lotes.length >= 2 && (
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <h3 style={{ margin: "0 0 6px" }}>{t("agro.compareTitle")}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: "var(--faint)" }}>
              <th style={{ padding: "4px 6px" }}>{t("agro.colLot")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.mortality")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colFcr")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colIee")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.costPerKg")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colMarginPct")}</th>
            </tr></thead>
            <tbody>
              {lotes.map((l) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px" }}>{l.nombre}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.mortalidadPct}%</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.fcr ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.iee ?? "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.costoPorKg != null ? money(l.costoPorKg) : "—"}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{l.margenPct != null ? `${l.margenPct}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lotes.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>{t("agro.noLots")}</p>
      ) : (
        lotes.map((l) => (
          <div className="list-item" key={l.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{l.nombre}</h3>
                <span className="muted small">
                  {l.especie === "broiler" ? t("agro.raising") : t("agro.laying")} · {l.tipoProduccion === "meat" ? t("agro.meat").toLowerCase() : t("agro.eggs").toLowerCase()} · {l.edadDias} {t("agro.days")}
                  {l.galpon && ` · ${l.galpon.granja.nombre} — ${l.galpon.nombre}`}
                </span>
              </div>
              <span className={`badge ${l.estado === "cerrado" ? "" : "ok"}`}>{l.estado}</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="badge ok">{t("agro.alive")}: {l.avesVivas}/{l.cantidadInicial}</span>
              <span className={`badge ${l.mortalidadPct > 5 ? "err" : "warn"}`}>{t("agro.mortality")}: {l.mortalidadPct}%</span>
              <span className="badge">{t("agro.feed")}: {l.alimentoTotalKg} kg</span>
              {l.tipoProduccion === "eggs" && <span className="badge">{t("agro.eggsLabel")}: {l.produccionTotal}</span>}
              {l.fcr != null && <span className="badge">FCR: {l.fcr}</span>}
              {l.gdp != null && <span className="badge">{t("agro.gdp")}: {l.gdp}</span>}
              {l.iee != null && <span className="badge">{t("agro.iee")}: {l.iee}</span>}
              {l.desvioPesoPct != null && (
                <span className={`badge ${Math.abs(l.desvioPesoPct) <= 5 ? "ok" : "warn"}`}>{t("agro.weightVsStandard")}: {l.desvioPesoPct > 0 ? "+" : ""}{l.desvioPesoPct}%</span>
              )}
              {l.hdpPromedio != null && <span className="badge ok">{t("agro.hdp")}: {l.hdpPromedio}%</span>}
              {l.hhhPromedio != null && <span className="badge">{t("agro.hhh")}: {l.hhhPromedio}%</span>}
              {l.hdpEstandar != null && <span className="badge">{t("agro.hdpStandard")}: {l.hdpEstandar}%</span>}
            </div>
            {l.tipoProduccion === "eggs" && (l.huevosBuenosTotal > 0 || l.huevosRotosTotal > 0 || l.huevosSuciosTotal > 0) && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <span className="badge ok">{t("agro.eggsGood")}: {l.huevosBuenosTotal}</span>
                {l.huevosRotosTotal > 0 && <span className="badge err">{t("agro.eggsBroken")}: {l.huevosRotosTotal}</span>}
                {l.huevosSuciosTotal > 0 && <span className="badge warn">{t("agro.eggsDirty")}: {l.huevosSuciosTotal}</span>}
              </div>
            )}
            {l.enRetiro && l.fechaLibreRetiro && (
              <div className="row"><span className="badge err">{t("agro.inWithdrawalUntil")} {fecha(l.fechaLibreRetiro)}</span></div>
            )}
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <span className="badge">{t("agro.totalCost")}: {money(l.costoTotal)}</span>
              {l.costoPorKg != null && <span className="badge">{t("agro.costPerKg")}: {money(l.costoPorKg)}</span>}
              <span className="badge">{t("agro.costPerBird")}: {money(l.costoPorAve)}</span>
              <span className="badge ok">{t("agro.income")}: {money(l.ingresoTotal)}</span>
              {l.margenPct != null && (
                <span className={`badge ${l.margen >= 0 ? "ok" : "err"}`}>{t("agro.margin")}: {money(l.margen)} ({l.margenPct}%)</span>
              )}
            </div>
            <div className="row spread">
              <span className="muted small" />
              <button className="ghost small" onClick={() => setAbierto(abierto === l.id ? null : l.id)}>{abierto === l.id ? t("agro.hide") : t("agro.viewDetail")}</button>
            </div>
            {abierto === l.id && <DetalleLote loteId={l.id} negocioId={negocio.id} onCambio={cargar} />}
          </div>
        ))
      )}
    </div>
  );
}

function GestionGranjas({ negocioId, granjas, onCambio }: { negocioId: string; granjas: Granja[]; onCambio: () => void }) {
  const { t } = useT();
  const { promptConfirmar, modal } = usePrompt();
  const [abierto, setAbierto] = useState(false);
  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");
  const [error, setError] = useState("");
  const [galponAbierto, setGalponAbierto] = useState<string | null>(null);
  const [gNombre, setGNombre] = useState("");
  const [gCapacidad, setGCapacidad] = useState("");

  async function crearGranja(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      await api.post("/agro/granjas", { negocioId, nombre, direccion: direccion || undefined });
      setNombre(""); setDireccion(""); onCambio();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function borrarGranja(id: string) {
    if (!(await promptConfirmar(t("agro.deleteFarmConfirm")))) return;
    await api.del(`/agro/granjas/${id}`);
    onCambio();
  }

  async function crearGalpon(e: React.FormEvent, granjaId: string) {
    e.preventDefault(); setError("");
    try {
      await api.post(`/agro/granjas/${granjaId}/galpones`, { nombre: gNombre, capacidadAves: gCapacidad || undefined });
      setGNombre(""); setGCapacidad(""); setGalponAbierto(null); onCambio();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function borrarGalpon(id: string) {
    if (!(await promptConfirmar(t("agro.deleteShedConfirm")))) return;
    await api.del(`/agro/galpones/${id}`);
    onCambio();
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="row spread">
        <div>
          <h3 style={{ margin: 0 }}>{t("agro.farms")}</h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>{t("agro.farmsHelp")}</p>
        </div>
        <button className="ghost small" onClick={() => setAbierto((v) => !v)}>{abierto ? "▲" : "▼"}</button>
      </div>
      {abierto && (
        <>
          {granjas.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>{t("agro.noFarms")}</p>
          ) : (
            granjas.map((g) => (
              <div key={g.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, marginTop: 8 }}>
                <div className="row spread">
                  <div><strong>{g.nombre}</strong> {g.direccion && <span className="muted small">· {g.direccion}</span>}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="ghost small" onClick={() => setGalponAbierto(galponAbierto === g.id ? null : g.id)}>{t("agro.newShed")}</button>
                    <button className="ghost small" onClick={() => borrarGranja(g.id)}>✕</button>
                  </div>
                </div>
                {g.galpones.length > 0 && (
                  <div style={{ paddingLeft: 10 }}>
                    {g.galpones.map((gp) => (
                      <div key={gp.id} className="row spread small muted" style={{ padding: "3px 0" }}>
                        <span>🏠 {gp.nombre}{gp.capacidadAves != null ? ` · ${gp.capacidadAves} aves` : ""} · {gp._count.lotes} {t("agro.shedsIn")}</span>
                        <button className="ghost small" onClick={() => borrarGalpon(gp.id)}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
                {galponAbierto === g.id && (
                  <form onSubmit={(e) => crearGalpon(e, g.id)} className="row" style={{ gap: 6, paddingLeft: 10 }}>
                    <input value={gNombre} onChange={(e) => setGNombre(e.target.value)} required placeholder={t("agro.shedNamePh")} style={{ flex: 2 }} />
                    <input type="number" min="0" value={gCapacidad} onChange={(e) => setGCapacidad(e.target.value)} placeholder={t("agro.shedCapacity")} style={{ flex: 1 }} />
                    <button className="primary small">{t("agro.addShed")}</button>
                  </form>
                )}
              </div>
            ))
          )}
          <form onSubmit={crearGranja} className="row" style={{ gap: 6, marginTop: 10 }}>
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder={t("agro.farmNamePh")} style={{ flex: 2 }} />
            <input value={direccion} onChange={(e) => setDireccion(e.target.value)} placeholder={t("agro.farmAddress")} style={{ flex: 2 }} />
            <button className="primary small">{t("agro.createFarm")}</button>
          </form>
          {error && <p className="error small">{error}</p>}
        </>
      )}
      {modal}
    </div>
  );
}

function DetalleLote({ loteId, negocioId, onCambio }: { loteId: string; negocioId: string; onCambio: () => void }) {
  const { t } = useT();
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [costos, setCostos] = useState<Costo[]>([]);
  const [productosLote, setProductosLote] = useState<ProductoLote[]>([]);
  const [tiposCosto, setTiposCosto] = useState<TipoCosto[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [tiposEvento, setTiposEvento] = useState<string[]>([]);
  const [metricas, setMetricas] = useState<LoteResumen | null>(null);
  const [serieComparativa, setSerieComparativa] = useState<PuntoComparativa[]>([]);
  const [tab, setTab] = useState<"diario" | "costos" | "productos" | "sanidad">("diario");
  const [r, setR] = useState({
    fecha: hoy(), mortalidad: "0", alimentoKg: "0", pesoPromedioG: "", produccion: "0",
    huevosJumbo: "0", huevosExtra: "0", huevosGrande: "0", huevosMediano: "0", huevosPequeno: "0",
    huevosRotos: "0", huevosSucios: "0",
  });
  const [c, setC] = useState({ tipoCosto: "feed", monto: "", fecha: hoy(), descripcion: "", cantidadSacos: "", costoPorSaco: "" });
  const [ev, setEv] = useState({ tipo: "vacuna", nombre: "", fecha: hoy(), diasRetiro: "", notas: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [errorEvento, setErrorEvento] = useState("");

  function cargar() {
    api.get<{
      lote: { registros: Registro[]; gastos: Costo[]; productos: ProductoLote[]; eventosSanitarios: Evento[] };
      metricas: LoteResumen;
      serieComparativa: PuntoComparativa[];
      tiposCosto: TipoCosto[];
      tiposEvento: string[];
    }>(`/agro/lotes/${loteId}`)
      .then((res) => {
        setRegistros(res.lote.registros); setCostos(res.lote.gastos);
        setProductosLote(res.lote.productos); setMetricas(res.metricas); setTiposCosto(res.tiposCosto);
        setEventos(res.lote.eventosSanitarios); setTiposEvento(res.tiposEvento);
        setSerieComparativa(res.serieComparativa);
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
    setMsg(t("agro.logSaved"));
    cargar(); onCambio();
  }

  const usaSacos = c.tipoCosto === "feed" && c.cantidadSacos !== "" && c.costoPorSaco !== "";
  const totalSacos = usaSacos ? Number(c.cantidadSacos) * Number(c.costoPorSaco) : null;

  async function agregarCosto(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try {
      const monto = usaSacos ? totalSacos! : Number(c.monto);
      const descripcion = c.descripcion || (usaSacos ? `${c.cantidadSacos} ${t("agro.sacks")} × ${money(c.costoPorSaco)}` : undefined);
      await api.post(`/agro/lotes/${loteId}/costos`, { tipoCosto: c.tipoCosto, monto, fecha: c.fecha, descripcion });
      setC({ tipoCosto: c.tipoCosto, monto: "", fecha: hoy(), descripcion: "", cantidadSacos: "", costoPorSaco: "" });
      cargar(); onCambio();
    } catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function borrarCosto(id: string) {
    await api.del(`/agro/lotes/${loteId}/costos/${id}`);
    cargar(); onCambio();
  }

  async function agregarEvento(e: React.FormEvent) {
    e.preventDefault(); setErrorEvento("");
    try {
      await api.post(`/agro/lotes/${loteId}/eventos`, { ...ev, diasRetiro: ev.diasRetiro || undefined });
      setEv({ tipo: ev.tipo, nombre: "", fecha: hoy(), diasRetiro: "", notas: "" });
      cargar(); onCambio();
    } catch (err) { setErrorEvento(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function borrarEvento(id: string) {
    await api.del(`/agro/lotes/${loteId}/eventos/${id}`);
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

  const [np, setNp] = useState({ nombre: "", precioVenta: "", stock: "" });
  const [errorProducto, setErrorProducto] = useState("");
  async function crearYVincularProducto(e: React.FormEvent) {
    e.preventDefault(); setErrorProducto("");
    try {
      await api.post("/inventario", { negocioId, nombre: np.nombre, precioVenta: np.precioVenta, stock: np.stock || 0, loteId });
      setNp({ nombre: "", precioVenta: "", stock: "" });
      cargar(); onCambio();
    } catch (err) { setErrorProducto(err instanceof ApiError ? err.message : t("common.error")); }
  }

  const vinculadosIds = new Set(productosLote.map((p) => p.id));
  const disponiblesParaVincular = productosNegocio.filter((p) => !vinculadosIds.has(p.id));
  const tipoLabel = (value: string) => (TIPO_COSTO_KEY[value] ? t(TIPO_COSTO_KEY[value]) : value);
  const tipoEventoLabel = (value: string) => (TIPO_EVENTO_KEY[value] ? t(TIPO_EVENTO_KEY[value]) : value);

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
      {metricas && (
        <div className="grid grid-2" style={{ marginBottom: 12 }}>
          <Stat label={t("agro.totalCost")} value={money(metricas.costoTotal)} icon="💸" />
          <Stat label={t("agro.incomeFromSales")} value={money(metricas.ingresoTotal)} icon="💰" variant="green" />
          <Stat label={t("agro.margin")} value={`${money(metricas.margen)}${metricas.margenPct != null ? ` (${metricas.margenPct}%)` : ""}`} icon={metricas.margen >= 0 ? "📈" : "📉"} variant={metricas.margen >= 0 ? "green" : "accent"} />
          {metricas.costoPorKg != null && <Stat label={t("agro.costPerKgStat")} value={money(metricas.costoPorKg)} icon="⚖️" />}
        </div>
      )}
      {metricas?.enRetiro && metricas.fechaLibreRetiro && (
        <p className="error small" style={{ marginBottom: 10 }}>{t("agro.inWithdrawalUntil")} {fecha(metricas.fechaLibreRetiro)}</p>
      )}
      {metricas?.alertaConsumo && (
        <p className="error small" style={{ marginBottom: 10 }}>{t("agro.feedDropAlert")}</p>
      )}
      {serieComparativa.length >= 2 && metricas && (
        <MiniChart
          serie={serieComparativa}
          labelReal={metricas.tipoProduccion === "meat" ? t("agro.chartRealWeight") : t("agro.chartRealHdp")}
          labelEstandar={metricas.tipoProduccion === "meat" ? t("agro.chartStandardWeight") : t("agro.chartStandardHdp")}
        />
      )}

      <div className="tabs" style={{ marginBottom: 10 }}>
        <button className={`tab ${tab === "diario" ? "active" : ""}`} onClick={() => setTab("diario")}>{t("agro.tabDaily")}</button>
        <button className={`tab ${tab === "sanidad" ? "active" : ""}`} onClick={() => setTab("sanidad")}>{t("agro.tabHealth")}</button>
        <button className={`tab ${tab === "costos" ? "active" : ""}`} onClick={() => setTab("costos")}>{t("agro.tabCosts")}</button>
        <button className={`tab ${tab === "productos" ? "active" : ""}`} onClick={() => setTab("productos")}>{t("agro.tabProducts")}</button>
      </div>

      {tab === "diario" && (
        <>
          <form onSubmit={guardarRegistro}>
            <div className="grid grid-2">
              <div><label>{t("agro.date")}</label><input type="date" value={r.fecha} onChange={(e) => setR({ ...r, fecha: e.target.value })} required /></div>
              <div><label>{t("agro.mortalityBirds")}</label><input type="number" min="0" value={r.mortalidad} onChange={(e) => setR({ ...r, mortalidad: e.target.value })} /></div>
              <div><label>{t("agro.feedKg")}</label><input type="number" step="0.001" min="0" value={r.alimentoKg} onChange={(e) => setR({ ...r, alimentoKg: e.target.value })} /></div>
              {metricas?.tipoProduccion === "meat" && (
                <div><label>{t("agro.avgWeightG")}</label><input type="number" step="0.1" min="0" value={r.pesoPromedioG} onChange={(e) => setR({ ...r, pesoPromedioG: e.target.value })} /></div>
              )}
              {metricas?.tipoProduccion === "eggs" ? (
                <div><label>{t("agro.productionEggs")}</label><input type="number" min="0" value={r.produccion} onChange={(e) => setR({ ...r, produccion: e.target.value })} placeholder={t("agro.eggBreakdown")} /></div>
              ) : (
                <div><label>{t("agro.productionEggs")}</label><input type="number" min="0" value={r.produccion} onChange={(e) => setR({ ...r, produccion: e.target.value })} /></div>
              )}
            </div>
            {metricas?.tipoProduccion === "eggs" && (
              <>
                <label className="muted small" style={{ marginTop: 8, display: "block" }}>{t("agro.eggBreakdown")}</label>
                <div className="grid grid-2">
                  <div><label>{t("agro.calJumbo")}</label><input type="number" min="0" value={r.huevosJumbo} onChange={(e) => setR({ ...r, huevosJumbo: e.target.value })} /></div>
                  <div><label>{t("agro.calExtra")}</label><input type="number" min="0" value={r.huevosExtra} onChange={(e) => setR({ ...r, huevosExtra: e.target.value })} /></div>
                  <div><label>{t("agro.calGrande")}</label><input type="number" min="0" value={r.huevosGrande} onChange={(e) => setR({ ...r, huevosGrande: e.target.value })} /></div>
                  <div><label>{t("agro.calMediano")}</label><input type="number" min="0" value={r.huevosMediano} onChange={(e) => setR({ ...r, huevosMediano: e.target.value })} /></div>
                  <div><label>{t("agro.calPequeno")}</label><input type="number" min="0" value={r.huevosPequeno} onChange={(e) => setR({ ...r, huevosPequeno: e.target.value })} /></div>
                  <div><label>{t("agro.eggsBroken")}</label><input type="number" min="0" value={r.huevosRotos} onChange={(e) => setR({ ...r, huevosRotos: e.target.value })} /></div>
                  <div><label>{t("agro.eggsDirty")}</label><input type="number" min="0" value={r.huevosSucios} onChange={(e) => setR({ ...r, huevosSucios: e.target.value })} /></div>
                </div>
              </>
            )}
            <button className="primary" style={{ marginTop: 10 }}>{t("agro.saveDailyLog")}</button>
            {msg && <span className="success small" style={{ marginLeft: 10 }}>{msg}</span>}
          </form>

          {registros.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead><tr style={{ textAlign: "left", color: "var(--faint)" }}>
                  <th style={{ padding: "4px 6px" }}>{t("agro.colDate")}</th><th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colMort")}</th>
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colFeed")}</th>
                  {metricas?.tipoProduccion === "meat" && <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colWeight")}</th>}
                  <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.colProd")}</th>
                  {metricas?.tipoProduccion === "eggs" && <>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.eggsBroken")}</th>
                    <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("agro.eggsDirty")}</th>
                  </>}
                </tr></thead>
                <tbody>
                  {registros.map((x) => (
                    <tr key={x.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 6px" }}>{fecha(x.fecha)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.mortalidad}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{Number(x.alimentoKg)}</td>
                      {metricas?.tipoProduccion === "meat" && <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.pesoPromedioG != null ? Number(x.pesoPromedioG) : "—"}</td>}
                      <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.produccion}</td>
                      {metricas?.tipoProduccion === "eggs" && <>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.huevosRotos}</td>
                        <td style={{ padding: "4px 6px", textAlign: "right" }}>{x.huevosSucios}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "sanidad" && (
        <>
          <form onSubmit={agregarEvento} className="grid grid-2">
            <div><label>{t("agro.eventType")}</label>
              <select value={ev.tipo} onChange={(e) => setEv({ ...ev, tipo: e.target.value })}>
                {tiposEvento.map((tv) => (
                  <option key={tv} value={tv}>{tipoEventoLabel(tv)}</option>
                ))}
              </select>
            </div>
            <div><label>{t("agro.eventName")}</label><input value={ev.nombre} onChange={(e) => setEv({ ...ev, nombre: e.target.value })} required placeholder={t("agro.eventNamePh")} /></div>
            <div><label>{t("agro.date")}</label><input type="date" value={ev.fecha} onChange={(e) => setEv({ ...ev, fecha: e.target.value })} required /></div>
            <div><label>{t("agro.withdrawalDays")}</label><input type="number" min="0" value={ev.diasRetiro} onChange={(e) => setEv({ ...ev, diasRetiro: e.target.value })} /></div>
            <p className="muted small" style={{ gridColumn: "1 / -1", margin: "-4px 0 0" }}>{t("agro.withdrawalHelp")}</p>
            {errorEvento && <p className="error small" style={{ gridColumn: "1 / -1" }}>{errorEvento}</p>}
            <button className="primary" style={{ gridColumn: "1 / -1", marginTop: 4 }}>{t("agro.addEvent")}</button>
          </form>

          {eventos.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>{t("agro.noEvents")}</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              {eventos.map((x) => (
                <div className="list-item" key={x.id}>
                  <div>
                    <strong>{x.nombre}</strong>{" "}
                    <span className="muted small">
                      · {tipoEventoLabel(x.tipo)}
                      {x.diasRetiro != null && ` · ${t("agro.withdrawalDays").replace(" (opcional)", "").replace(" (optional)", "")}: ${x.diasRetiro}`}
                    </span>
                    <br /><span className="muted small">{fecha(x.fecha)}</span>
                  </div>
                  <button className="ghost small" onClick={() => borrarEvento(x.id)}>✕</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "costos" && (
        <>
          <p className="muted small">{t("agro.costsIntro")}</p>
          <form onSubmit={agregarCosto} className="grid grid-2">
            <div><label>{t("agro.costType")}</label>
              <select value={c.tipoCosto} onChange={(e) => setC({ ...c, tipoCosto: e.target.value })}>
                {tiposCosto.map((tc) => <option key={tc.value} value={tc.value}>{tipoLabel(tc.value)}</option>)}
              </select>
            </div>
            {c.tipoCosto === "feed" ? (
              <>
                <div><label>{t("agro.bagQty")}</label><input type="number" step="0.01" min="0" value={c.cantidadSacos} onChange={(e) => setC({ ...c, cantidadSacos: e.target.value })} placeholder={t("agro.bagQtyPh")} /></div>
                <div><label>{t("agro.bagCost")}</label><input type="number" step="0.01" min="0" value={c.costoPorSaco} onChange={(e) => setC({ ...c, costoPorSaco: e.target.value })} placeholder="0.00" /></div>
                {usaSacos ? (
                  <p className="small muted" style={{ gridColumn: "1 / -1", margin: "-4px 0 0" }}>{t("agro.bagTotal")}: {money(totalSacos!)}</p>
                ) : (
                  <div><label>{t("agro.amount")}</label><input type="number" step="0.01" min="0.01" value={c.monto} onChange={(e) => setC({ ...c, monto: e.target.value })} required placeholder={t("agro.bagAmountFallback")} /></div>
                )}
              </>
            ) : (
              <div><label>{t("agro.amount")}</label><input type="number" step="0.01" min="0.01" value={c.monto} onChange={(e) => setC({ ...c, monto: e.target.value })} required /></div>
            )}
            <div><label>{t("agro.date")}</label><input type="date" value={c.fecha} onChange={(e) => setC({ ...c, fecha: e.target.value })} required /></div>
            <div><label>{t("agro.descriptionOpt")}</label><input value={c.descripcion} onChange={(e) => setC({ ...c, descripcion: e.target.value })} placeholder={t("agro.descPh")} /></div>
            {error && <p className="error small" style={{ gridColumn: "1 / -1" }}>{error}</p>}
            <button className="primary" style={{ gridColumn: "1 / -1", marginTop: 4 }}>{t("agro.addCost")}</button>
          </form>

          {costos.length === 0 ? (
            <p className="muted small" style={{ marginTop: 10 }}>{t("agro.noCosts")}</p>
          ) : (
            <div style={{ marginTop: 12 }}>
              {costos.map((g) => (
                <div className="list-item" key={g.id}>
                  <div><strong>{g.tipoCosto ? tipoLabel(g.tipoCosto) : (g.categoria ?? t("agro.cost"))}</strong> {g.descripcion && <span className="muted small">· {g.descripcion}</span>}<br /><span className="muted small">{fecha(g.fecha)}</span></div>
                  <div className="row"><strong>{money(g.monto)}</strong><button className="ghost small" onClick={() => borrarCosto(g.id)}>✕</button></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "productos" && (
        <>
          <p className="muted small">{t("agro.linkIntro")}</p>
          {productosLote.length === 0 ? (
            <p className="muted small">{t("agro.noneLinked")}</p>
          ) : (
            productosLote.map((p) => (
              <div className="list-item" key={p.id}>
                <div><strong>{p.nombre}</strong> <span className="muted small">· {money(p.precioVenta)} · {t("agro.stock")} {Number(p.stock)}</span></div>
                <button className="ghost small" onClick={() => desvincular(p.id)}>{t("agro.unlink")}</button>
              </div>
            ))
          )}
          {disponiblesParaVincular.length > 0 && (
            <div className="row" style={{ marginTop: 10 }}>
              <select defaultValue="" onChange={(e) => { vincular(e.target.value); e.target.value = ""; }}>
                <option value="" disabled>{t("agro.linkExisting")}</option>
                {disponiblesParaVincular.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}

          <div className="card" style={{ background: "var(--surface)", marginTop: 12 }}>
            <p className="small" style={{ margin: "0 0 8px" }}><strong>{t("agro.newProductTitle")}</strong></p>
            <p className="muted small" style={{ margin: "0 0 8px" }}>{t("agro.newProductHelp")}</p>
            <form onSubmit={crearYVincularProducto} className="grid grid-2">
              <div><label>{t("agro.newProductName")}</label><input value={np.nombre} onChange={(e) => setNp({ ...np, nombre: e.target.value })} required placeholder={t("agro.newProductNamePh")} /></div>
              <div><label>{t("agro.newProductPrice")}</label><input type="number" step="0.01" min="0" value={np.precioVenta} onChange={(e) => setNp({ ...np, precioVenta: e.target.value })} required placeholder="0.00" /></div>
              <div><label>{t("agro.newProductStock")}</label><input type="number" step="0.01" min="0" value={np.stock} onChange={(e) => setNp({ ...np, stock: e.target.value })} placeholder="0" /></div>
              {errorProducto && <p className="error small" style={{ gridColumn: "1 / -1" }}>{errorProducto}</p>}
              <button className="primary" style={{ gridColumn: "1 / -1", marginTop: 4 }}>{t("agro.newProductCreate")}</button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
