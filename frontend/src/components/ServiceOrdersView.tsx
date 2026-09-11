import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { useT, type TKey } from "../i18n";

// Módulo ÓRDENES DE SERVICIO (taller / servicio técnico).
interface Orden {
  id: string; clienteNombre: string; clienteTelefono: string | null; equipo: string;
  problema: string | null; diagnostico: string | null; estado: string;
  costoEstimado: string | number | null; costoFinal: string | number | null; createdAt: string;
}
const ESTADOS = ["recibido", "diagnostico", "reparacion", "listo", "entregado", "cancelado"];
const LABEL_KEY: Record<string, TKey> = {
  recibido: "ordenes.stReceived", diagnostico: "ordenes.stDiagnosis", reparacion: "ordenes.stRepair",
  listo: "ordenes.stReady", entregado: "ordenes.stDelivered", cancelado: "ordenes.stCancelled",
};
const CLASE: Record<string, string> = { recibido: "warn", diagnostico: "warn", reparacion: "warn", listo: "ok", entregado: "ok", cancelado: "err" };
const money = (n: number | string | null) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

export function ServiceOrdersView({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [ordenes, setOrdenes] = useState<Orden[]>([]);
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ clienteNombre: "", clienteTelefono: "", equipo: "", problema: "", costoEstimado: "" });
  const [error, setError] = useState("");

  function cargar() { api.get<{ ordenes: Orden[] }>(`/ordenes-servicio?negocioId=${negocio.id}`).then((r) => setOrdenes(r.ordenes)).catch(() => {}); }
  useEffect(cargar, [negocio.id]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/ordenes-servicio", { ...f, negocioId: negocio.id }); setF({ clienteNombre: "", clienteTelefono: "", equipo: "", problema: "", costoEstimado: "" }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  async function actualizar(id: string, data: Record<string, unknown>) { await api.patch(`/ordenes-servicio/${id}`, data); cargar(); }

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("ordenes.title")}</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? t("common.cancel") : t("ordenes.newOrder")}</button>
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>{t("ordenes.customer")}</label><input value={f.clienteNombre} onChange={(e) => setF({ ...f, clienteNombre: e.target.value })} required /></div>
            <div><label>{t("ordenes.phone")}</label><input value={f.clienteTelefono} onChange={(e) => setF({ ...f, clienteTelefono: e.target.value })} /></div>
          </div>
          <label>{t("ordenes.equipment")}</label>
          <input value={f.equipo} onChange={(e) => setF({ ...f, equipo: e.target.value })} required placeholder={t("ordenes.equipmentPh")} />
          <label>{t("ordenes.problem")}</label>
          <input value={f.problema} onChange={(e) => setF({ ...f, problema: e.target.value })} />
          <label>{t("ordenes.estCostOpt")}</label>
          <input type="number" step="0.01" min="0" value={f.costoEstimado} onChange={(e) => setF({ ...f, costoEstimado: e.target.value })} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>{t("ordenes.createOrder")}</button>
        </form>
      )}

      {ordenes.length === 0 ? (
        <p className="muted small" style={{ marginTop: 10 }}>{t("ordenes.empty")}</p>
      ) : (
        ordenes.map((o) => (
          <div className="list-item" key={o.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div><strong>{o.equipo}</strong><br /><span className="muted small">{o.clienteNombre}{o.clienteTelefono ? ` · ${o.clienteTelefono}` : ""}</span></div>
              <span className={`badge ${CLASE[o.estado]}`}>{t(LABEL_KEY[o.estado])}</span>
            </div>
            {o.problema && <span className="small muted">{t("ordenes.problemLabel")}: {o.problema}</span>}
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label className="small muted" style={{ margin: 0 }}>{t("ordenes.statusLabel")}</label>
              <select value={o.estado} onChange={(e) => actualizar(o.id, { estado: e.target.value })} style={{ width: "auto" }}>
                {ESTADOS.map((s) => <option key={s} value={s}>{t(LABEL_KEY[s])}</option>)}
              </select>
              <span className="small muted">{t("ordenes.estLabel")}: {money(o.costoEstimado)}</span>
              <button className="ghost small" onClick={() => { const v = prompt(t("ordenes.finalCostPrompt")); if (v) actualizar(o.id, { costoFinal: Number(v) }); }}>
                {t("ordenes.finalLabel")}: {money(o.costoFinal)}
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
