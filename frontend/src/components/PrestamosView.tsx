import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { hoyLocal, formatFechaLocal, fechaVencida } from "../dateUtils";
import { useT } from "../i18n";

// Módulo de PRÉSTAMOS (rubro prestamista). Se muestra en el panel del negocio.
interface PrestamoResumen {
  id: string; deudorNombre: string; deudorTelefono: string | null;
  capital: number; tasaInteresMensual: number; plazoCuotas: number; frecuencia: string;
  estado: string; totalCuotas: number; cuotasPagadas: number; saldoPendiente: number;
  proximaCuota: string | null; enMora: boolean;
}
interface Cuota {
  id: string; numero: number; fechaVencimiento: string; monto: string | number;
  capital: string | number; interes: string | number; montoPagado: string | number; pagada: boolean; fechaPago: string | null;
}
interface PrestamoDetalle extends PrestamoResumen { cuotas: Cuota[] }

const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const fecha = (s: string | null) => (s ? formatFechaLocal(s) : "—");
const hoy = hoyLocal;

export function PrestamosView({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [prestamos, setPrestamos] = useState<PrestamoResumen[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [nuevo, setNuevo] = useState(false);

  function cargar() {
    api.get<{ prestamos: PrestamoResumen[] }>(`/lending?negocioId=${negocio.id}`).then((r) => setPrestamos(r.prestamos)).catch(() => {});
  }
  useEffect(cargar, [negocio.id]);

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("prestamos.title")}</h2>
        <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>
          {nuevo ? t("common.cancel") : t("prestamos.newLoan")}
        </button>
      </div>
      {msg && <p className="success small">{msg}</p>}

      {nuevo && <FormNuevo negocioId={negocio.id} onCreado={() => { setNuevo(false); setMsg(t("prestamos.created")); cargar(); }} />}

      {prestamos.length === 0 ? (
        <p className="muted small">{t("prestamos.empty")}</p>
      ) : (
        prestamos.map((p) => (
          <div className="list-item" key={p.id} style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>{p.deudorNombre}</h3>
                <span className="muted small">
                  {money(p.capital)} · {p.tasaInteresMensual}%/mes · {p.plazoCuotas} {t("prestamos.installments")} ({p.frecuencia})
                </span>
              </div>
              <div style={{ textAlign: "right" }}>
                <span className={`badge ${p.estado === "pagado" ? "ok" : p.enMora ? "err" : "warn"}`}>
                  {p.estado === "pagado" ? t("prestamos.paid") : p.enMora ? t("prestamos.overdue") : t("prestamos.active")}
                </span>
                <div className="small" style={{ marginTop: 4 }}>{t("prestamos.balance")}: <strong>{money(p.saldoPendiente)}</strong></div>
              </div>
            </div>
            <div className="row spread">
              <span className="muted small">
                {p.cuotasPagadas}/{p.totalCuotas} {t("prestamos.installments")} · {t("prestamos.next")}: {fecha(p.proximaCuota)}
              </span>
              <button className="ghost small" onClick={() => setAbierto(abierto === p.id ? null : p.id)}>
                {abierto === p.id ? t("prestamos.hide") : t("prestamos.viewInstallments")}
              </button>
            </div>
            {abierto === p.id && <Detalle prestamoId={p.id} onPago={() => { cargar(); }} />}
          </div>
        ))
      )}
    </div>
  );
}

function FormNuevo({ negocioId, onCreado }: { negocioId: string; onCreado: () => void }) {
  const { t } = useT();
  const [f, setF] = useState({ deudorNombre: "", deudorTelefono: "", capital: "", tasaInteresMensual: "5", plazoCuotas: "6", frecuencia: "mensual", fechaInicio: hoy(), notas: "" });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  function set<K extends keyof typeof f>(k: K, v: string) { setF((p) => ({ ...p, [k]: v })); }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setEnviando(true);
    try {
      await api.post("/lending", { ...f, negocioId });
      onCreado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={enviar} className="card" style={{ background: "var(--surface-2)", marginTop: 10 }}>
      <label>{t("prestamos.debtorName")}</label>
      <input value={f.deudorNombre} onChange={(e) => set("deudorNombre", e.target.value)} required />
      <label>{t("prestamos.phoneOpt")}</label>
      <input value={f.deudorTelefono} onChange={(e) => set("deudorTelefono", e.target.value)} />
      <div className="grid grid-2">
        <div>
          <label>{t("prestamos.principal")}</label>
          <input type="number" step="0.01" min="1" value={f.capital} onChange={(e) => set("capital", e.target.value)} required />
        </div>
        <div>
          <label>{t("prestamos.monthlyRate")}</label>
          <input type="number" step="0.01" min="0" value={f.tasaInteresMensual} onChange={(e) => set("tasaInteresMensual", e.target.value)} required />
        </div>
        <div>
          <label>{t("prestamos.numInstallments")}</label>
          <input type="number" min="1" max="360" value={f.plazoCuotas} onChange={(e) => set("plazoCuotas", e.target.value)} required />
        </div>
        <div>
          <label>{t("prestamos.frequency")}</label>
          <select value={f.frecuencia} onChange={(e) => set("frecuencia", e.target.value)}>
            <option value="semanal">{t("prestamos.weekly")}</option>
            <option value="quincenal">{t("prestamos.biweekly")}</option>
            <option value="mensual">{t("prestamos.monthly")}</option>
          </select>
        </div>
      </div>
      <label>{t("prestamos.startDate")}</label>
      <input type="date" value={f.fechaInicio} onChange={(e) => set("fechaInicio", e.target.value)} required />
      <label>{t("prestamos.notesOpt")}</label>
      <input value={f.notas} onChange={(e) => set("notas", e.target.value)} />
      {error && <p className="error small">{error}</p>}
      <button className="primary" style={{ marginTop: 10 }} disabled={enviando}>{enviando ? t("prestamos.creating") : t("prestamos.createLoan")}</button>
    </form>
  );
}

function Detalle({ prestamoId, onPago }: { prestamoId: string; onPago: () => void }) {
  const { t } = useT();
  const [det, setDet] = useState<PrestamoDetalle | null>(null);
  const [monto, setMonto] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  function cargar() {
    api.get<{ prestamo: PrestamoDetalle }>(`/lending/${prestamoId}`).then((r) => setDet(r.prestamo)).catch(() => {});
  }
  useEffect(cargar, [prestamoId]);

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setMsg("");
    try {
      const r = await api.post<{ excedente: number }>(`/lending/${prestamoId}/pagar`, { monto });
      setMsg(`${t("prestamos.paymentLogged")}${r.excedente > 0 ? ` ${t("prestamos.overpayment")}: ${money(r.excedente)}` : ""}`);
      setMonto("");
      cargar(); onPago();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  if (!det) return <p className="muted small" style={{ marginTop: 8 }}>{t("common.loading")}</p>;

  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
      {det.estado === "activo" && (
        <form onSubmit={pagar} className="row" style={{ gap: 8, marginBottom: 10 }}>
          <input type="number" step="0.01" min="0.01" placeholder={t("prestamos.amountToCollect")} value={monto} onChange={(e) => setMonto(e.target.value)} required style={{ flex: 1 }} />
          <button className="primary" type="submit">{t("prestamos.logPayment")}</button>
        </form>
      )}
      {msg && <p className="success small">{msg}</p>}
      {error && <p className="error small">{error}</p>}
      <div style={{ overflowX: "auto" }}>
        <table className="tabla-cuotas" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--faint)" }}>
              <th style={{ padding: "4px 6px" }}>{t("prestamos.numCol")}</th>
              <th style={{ padding: "4px 6px" }}>{t("prestamos.due")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("prestamos.installment")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("prestamos.principalCol")}</th>
              <th style={{ padding: "4px 6px", textAlign: "right" }}>{t("prestamos.interest")}</th>
              <th style={{ padding: "4px 6px", textAlign: "center" }}>{t("prestamos.status")}</th>
            </tr>
          </thead>
          <tbody>
            {det.cuotas.map((c) => {
              const vencida = !c.pagada && fechaVencida(c.fechaVencimiento);
              return (
                <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "4px 6px" }}>{c.numero}</td>
                  <td style={{ padding: "4px 6px" }}>{fecha(c.fechaVencimiento)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.monto)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.capital)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "right" }}>{money(c.interes)}</td>
                  <td style={{ padding: "4px 6px", textAlign: "center" }}>
                    <span className={`badge ${c.pagada ? "ok" : vencida ? "err" : "warn"}`}>
                      {c.pagada ? t("prestamos.paid") : vencida ? t("prestamos.overdueBadge") : t("prestamos.pending")}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
