import { useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";

// App de escritorio: sin backend de email real configurado, no tiene sentido pedirle al
// dueño que "verifique su email" — es su propia instalación local, no una cuenta pública.
const DESKTOP_MODE = ((import.meta.env.VITE_DESKTOP_MODE as string | undefined) ?? "").trim() === "true";

// Barra de cuenta: aviso de verificación de email + acciones GDPR (exportar/borrar datos).
export function AccountBar() {
  const { usuario, logout, refrescarUsuario } = useAuth();
  const { t } = useT();
  const [msg, setMsg] = useState("");
  const [abrirCuenta, setAbrirCuenta] = useState(false);

  if (!usuario) return null;

  async function reenviar() {
    const r = await api.post<{ mensaje: string }>("/auth/email/reenviar");
    setMsg(r.mensaje);
  }

  async function exportar() {
    // Descarga autenticada del export GDPR (con reintento de token y manejo de errores:
    // antes, un 401/500 se descargaba tal cual como si fuera el archivo de datos).
    try {
      const blob = await api.download("/auth/me/export");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "mis-datos-turno.json"; a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "No se pudo exportar tus datos");
    }
  }

  async function borrar() {
    if (!confirm(t("account.deleteConfirm"))) return;
    await api.del("/auth/me");
    logout();
  }

  const verificado = !!usuario.emailVerificadoEn;

  return (
    <div className="container" style={{ paddingTop: 12, paddingBottom: 0 }}>
      {!verificado && !DESKTOP_MODE && (
        <div className="card" style={{ borderColor: "var(--amber)", marginBottom: 8 }}>
          <div className="row spread">
            <span className="small">{t("account.verifyWarn")}</span>
            <button className="ghost small" onClick={reenviar}>{t("account.resend")}</button>
          </div>
          {msg && <p className="success small" style={{ margin: "6px 0 0" }}>{msg}</p>}
        </div>
      )}

      <div className="row spread">
        <button className="ghost small" onClick={() => setAbrirCuenta((v) => !v)}>
          {abrirCuenta ? "▲" : "▼"} {t("account.my")}
        </button>
      </div>
      {abrirCuenta && (
        <div className="card" style={{ marginTop: 8 }}>
          <div className="row">
            <button className="ghost small" onClick={exportar}>{t("account.export")}</button>
            <button className="ghost small" onClick={refrescarUsuario}>{t("account.refresh")}</button>
            {usuario.rol !== "superadmin" && (
              <button className="ghost small" style={{ color: "var(--danger)" }} onClick={borrar}>{t("account.delete")}</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
