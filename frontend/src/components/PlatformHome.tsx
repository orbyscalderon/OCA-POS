import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";

interface Plan {
  id: string; nombre: string; tipo: "suscripcion" | "pago_unico";
  mensualUsd?: number; precioUnicoUsd?: number;
}

// Portada pública: simple a propósito — un título, el botón de login, y los planes.
// El resto (buscador, rubros, reservar) sigue disponible por sus propias rutas.
export function PlatformHome({ onLogin }: { onLogin: () => void }) {
  const { t } = useT();
  const [planes, setPlanes] = useState<Plan[]>([]);
  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)).catch(() => {}); }, []);

  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <div className="mkt-hero">
        <h1 className="grad-text">{t("pf.heroTitle")}</h1>
        <p className="sub">{t("pf.heroSub")}</p>
        <button className="primary" style={{ marginTop: 14, padding: "12px 28px", fontSize: 16 }} onClick={onLogin}>
          {t("pub.signIn")}
        </button>
      </div>

      <h2 style={{ textAlign: "center", marginTop: 36 }}>{t("pf.plansTitle")}</h2>
      <div className="grid grid-2" style={{ alignItems: "stretch", marginTop: 10 }}>
        {planes.map((p) => (
          <div className="card" key={p.id} style={{ display: "flex", flexDirection: "column" }}>
            <h3 style={{ marginTop: 0 }}>{p.tipo === "pago_unico" ? t("precios.lifetimeTitle") : p.nombre}</h3>
            <div style={{ margin: "4px 0 10px" }}>
              {p.tipo === "pago_unico" ? (
                <><span style={{ fontSize: 26, fontWeight: 800 }}>${p.precioUnicoUsd}</span><span className="muted small"> {t("precios.lifetimeOnce")}</span></>
              ) : (
                <><span style={{ fontSize: 26, fontWeight: 800 }}>${p.mensualUsd}</span><span className="muted small">{t("own.perMonth")}</span></>
              )}
            </div>
            <button className="ghost" style={{ marginTop: "auto" }} onClick={onLogin}>{t("pub.signUp")}</button>
          </div>
        ))}
      </div>
      <p style={{ textAlign: "center", marginTop: 14 }}><a href="/precios">{t("pf.seeAllPlans")}</a></p>
    </div>
  );
}
