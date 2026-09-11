import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { useT } from "../i18n";

// App de escritorio: sin backend de email real configurado, no tiene sentido pedirle al
// dueño que "verifique su email" — es su propia instalación local, no una cuenta pública.
const DESKTOP_MODE = ((import.meta.env.VITE_DESKTOP_MODE as string | undefined) ?? "").trim() === "true";

// Aviso de verificación de email pendiente — banner aparte porque es una advertencia
// importante, no una acción de cuenta (por eso no va dentro del menú "Mi cuenta").
export function AccountBar() {
  const { usuario } = useAuth();
  const { t } = useT();
  const [msg, setMsg] = useState("");

  if (!usuario || DESKTOP_MODE || usuario.emailVerificadoEn) return null;

  async function reenviar() {
    const r = await api.post<{ mensaje: string }>("/auth/email/reenviar");
    setMsg(r.mensaje);
  }

  return (
    <div className="container" style={{ paddingTop: 12, paddingBottom: 0 }}>
      <div className="card" style={{ borderColor: "var(--amber)" }}>
        <div className="row spread">
          <span className="small">{t("account.verifyWarn")}</span>
          <button className="ghost small" onClick={reenviar}>{t("account.resend")}</button>
        </div>
        {msg && <p className="success small" style={{ margin: "6px 0 0" }}>{msg}</p>}
      </div>
    </div>
  );
}

// Menú "Mi cuenta": pensado para vivir DENTRO de la barra superior (junto a "Salir"), como un
// desplegable anclado al botón — antes era una barra suelta debajo del header que quedaba
// descolgada y sin relación visual con el resto de los controles de la cuenta.
export function CuentaMenu() {
  const { usuario, logout, refrescarUsuario } = useAuth();
  const { t } = useT();
  const [msg, setMsg] = useState("");
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [abierto]);

  if (!usuario) return null;

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

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="ghost small" onClick={() => setAbierto((v) => !v)}>
        {t("account.my")} {abierto ? "▲" : "▼"}
      </button>
      {abierto && (
        <div className="card dropdown-menu">
          <button className="ghost small" onClick={exportar}>{t("account.export")}</button>
          <button className="ghost small" onClick={refrescarUsuario}>{t("account.refresh")}</button>
          {usuario.rol !== "superadmin" && (
            <button className="ghost small" style={{ color: "var(--danger)" }} onClick={borrar}>{t("account.delete")}</button>
          )}
          {msg && <p className="error small" style={{ margin: "6px 0 0" }}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
