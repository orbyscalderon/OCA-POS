import { useEffect, useState } from "react";
import { api, ApiError, type Rol } from "../api";
import { useT } from "../i18n";

export function AceptarInvitacion({ token }: { token: string; rol: Rol }) {
  const { t } = useT();
  const [negocio, setNegocio] = useState<{ nombreComercial: string } | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api
      .get<{ negocio: { nombreComercial: string } }>(`/negocios/invitaciones/${token}`)
      .then((r) => setNegocio(r.negocio))
      .catch((e) => setError(e instanceof ApiError ? e.message : t("invite.invalid")));
  }, [token]);

  async function aceptar() {
    setError(""); setMsg("");
    try {
      // Recarga la app al terminar: así el enrutado de App.tsx reevalúa si esta cuenta
      // ahora es personal de un negocio (antes solo lo revisaba una vez, al iniciar sesión).
      await api.post(`/negocios/invitaciones/${token}/aceptar`);
      setMsg(t("invite.joined"));
      setTimeout(() => window.location.assign("/"), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("common.error"));
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480, marginTop: 40 }}>
      <div className="card">
        <h1>{t("invite.title")}</h1>
        {error && <p className="error">{error}</p>}
        {msg && <p className="success">{msg}</p>}
        {negocio && !error && !msg && (
          <>
            <p>{t("invite.invited")} <strong>{negocio.nombreComercial}</strong>.</p>
            <button className="primary" onClick={aceptar}>{t("invite.accept")}</button>
          </>
        )}
        <p style={{ marginTop: 16 }}><a href="/">{t("common.back")}</a></p>
      </div>
    </div>
  );
}
