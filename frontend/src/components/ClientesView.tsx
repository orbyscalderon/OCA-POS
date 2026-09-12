import { useEffect, useState } from "react";
import { api, ApiError, type Negocio } from "../api";
import { useT } from "../i18n";
import { usePrompt } from "./Ui";

// Módulo CLIENTES (CRM básico del negocio).
interface Cliente { id: string; nombre: string; telefono: string | null; email: string | null; direccion: string | null; notas: string | null; puntos: number; saldoFiado: string | number }
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;

export function ClientesView({ negocio, loyalty = false, credit = false, puedeEditar = true, puedeEliminar = true }: { negocio: Negocio; loyalty?: boolean; credit?: boolean; puedeEditar?: boolean; puedeEliminar?: boolean }) {
  const { t } = useT();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [q, setQ] = useState("");
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ nombre: "", telefono: "", email: "", direccion: "", notas: "" });
  const [error, setError] = useState("");
  const { promptValor, promptConfirmar, modal } = usePrompt();

  async function eliminar(c: Cliente) {
    if (!(await promptConfirmar(`${t("clientes.deleteConfirm")} ${c.nombre}?`))) return;
    try { await api.del(`/clientes/${c.id}`); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }

  function cargar() {
    api.get<{ clientes: Cliente[] }>(`/clientes?negocioId=${negocio.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then((r) => setClientes(r.clientes)).catch(() => {});
  }
  useEffect(() => { const t2 = setTimeout(cargar, 200); return () => clearTimeout(t2); }, [negocio.id, q]);

  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError("");
    try { await api.post("/clientes", { ...f, negocioId: negocio.id }); setF({ nombre: "", telefono: "", email: "", direccion: "", notas: "" }); setNuevo(false); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("common.error")); }
  }
  async function puntos(id: string, delta: number) { await api.post(`/clientes/${id}/puntos`, { delta }); cargar(); }

  const paraPremio = negocio.puntosParaPremio ?? 10;
  async function canjear(c: Cliente) {
    if (!(await promptConfirmar(`${t("clientes.redeemConfirm")} ${c.nombre}?`))) return;
    await puntos(c.id, -paraPremio);
  }

  async function cobrar(c: Cliente) {
    const saldo = Number(c.saldoFiado);
    const v = await promptValor(`${t("clientes.collectPrompt")} "${c.nombre}" (${t("clientes.owes").toLowerCase()} ${money(saldo)}):`, saldo.toFixed(2));
    if (!v) return;
    try { await api.post(`/clientes/${c.id}/pagos`, { monto: Number(v) }); cargar(); }
    catch (err) { setError(err instanceof ApiError ? err.message : t("clientes.collectError")); }
  }

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("clientes.title")}</h2>
        {puedeEditar && <button className={nuevo ? "ghost small" : "primary small"} onClick={() => setNuevo((v) => !v)}>{nuevo ? t("common.cancel") : t("clientes.newCustomer")}</button>}
      </div>
      {nuevo && (
        <form onSubmit={crear} className="card" style={{ background: "var(--surface-2)", marginTop: 8 }}>
          <div className="grid grid-2">
            <div><label>{t("clientes.name")}</label><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></div>
            <div><label>{t("clientes.phone")}</label><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
            <div><label>{t("clientes.email")}</label><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div><label>{t("clientes.address")}</label><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
          </div>
          <label>{t("clientes.notes")}</label>
          <input value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} />
          {error && <p className="error small">{error}</p>}
          <button className="primary" style={{ marginTop: 10 }}>{t("clientes.save")}</button>
        </form>
      )}
      <input placeholder={t("clientes.searchPh")} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginTop: 10 }} />
      {clientes.map((c) => {
        const debe = Number(c.saldoFiado) > 0;
        return (
          <div className="list-item" key={c.id}>
            <div><strong>{c.nombre}</strong><br /><span className="muted small">{[c.telefono, c.email, c.direccion].filter(Boolean).join(" · ") || "—"}</span></div>
            <div className="row" style={{ alignItems: "center", gap: 6 }}>
              {credit && debe && <span className="badge err">{t("clientes.owes")} {money(c.saldoFiado)}</span>}
              {credit && debe && <button className="ghost small" onClick={() => cobrar(c)}>{t("clientes.collect")}</button>}
              {loyalty && (
                <>
                  <span className={`badge ${c.puntos >= paraPremio ? "ok" : ""}`}>⭐ {c.puntos}/{paraPremio}</span>
                  <button className="ghost small" onClick={() => puntos(c.id, 1)}>+1</button>
                  <button className="ghost small" onClick={() => puntos(c.id, -1)}>−1</button>
                  {c.puntos >= paraPremio && <button className="primary small" onClick={() => canjear(c)}>{t("clientes.redeem")}</button>}
                </>
              )}
              {puedeEliminar && <button className="ghost small" onClick={() => eliminar(c)}>✕</button>}
            </div>
          </div>
        );
      })}
      {clientes.length === 0 && <p className="muted small" style={{ marginTop: 8 }}>{t("clientes.empty")}</p>}
      {error && <p className="error small" style={{ marginTop: 8 }}>{error}</p>}
      {modal}
    </div>
  );
}
