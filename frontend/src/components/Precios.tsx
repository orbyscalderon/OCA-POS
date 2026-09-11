import { useEffect, useState } from "react";
import { api } from "../api";
import { useT, type TKey } from "../i18n";
import { Faq } from "./Faq";

interface Plan {
  id: string; nombre: string; tipo: "suscripcion" | "pago_unico";
  mensualUsd?: number; anualUsd?: number; anualPorMes?: number; ahorroAnualUsd?: number;
  precioUnicoUsd?: number;
  maxNegocios: number; maxPeluqueros: number;
}

// Funciones que trae CUALQUIER plan pago (no varían entre Básico y Pro — lo único que
// cambia es cuántos negocios y profesionales podés tener activos). Mostrarlas una sola
// vez, en vez de repetirlas idénticas en cada tarjeta, evita dar a entender que un plan
// "incluye más" cuando en realidad la diferencia real es solo el límite de uso.
const INCLUIDO_EN_TODOS: { icono: string; key: TKey }[] = [
  { icono: "🛒", key: "precios.feat1" },
  { icono: "📅", key: "precios.feat2" },
  { icono: "📒", key: "precios.feat3" },
  { icono: "💵", key: "precios.feat4" },
  { icono: "🌐", key: "precios.feat5" },
  { icono: "👥", key: "precios.feat6" },
];

const PREGUNTAS_KEYS: [TKey, TKey][] = [
  ["faq.q1", "faq.a1"], ["faq.q2", "faq.a2"], ["faq.q3", "faq.a3"], ["faq.q4", "faq.a4"],
  ["faq.q5", "faq.a5"], ["faq.q6", "faq.a6"], ["faq.q7", "faq.a7"],
];

// Página pública de precios (para atraer negocios antes de registrarse).
export function Precios({ onRegistrar }: { onRegistrar: () => void }) {
  const { t } = useT();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("anual");

  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)).catch(() => {}); }, []);

  const preguntas = PREGUNTAS_KEYS.map(([q, a]) => ({ pregunta: t(q), respuesta: t(a) }));

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <div className="mkt-hero" style={{ paddingTop: 44, paddingBottom: 32 }}>
        <h1 style={{ fontSize: 38 }}>{t("pub.pricingTitle")}</h1>
        <p className="sub">{t("pub.pricingSub")}</p>
        <div className="lang-toggle" style={{ margin: "6px auto 0" }}>
          <button className={intervalo === "mensual" ? "on" : ""} onClick={() => setIntervalo("mensual")}>{t("own.monthly")}</button>
          <button className={intervalo === "anual" ? "on" : ""} onClick={() => setIntervalo("anual")}>{t("own.annual")} · {t("own.save2months")}</button>
        </div>
      </div>

      <div className="grid grid-2" style={{ alignItems: "stretch" }}>
        {/* Prueba gratis: no es un plan de pago, es el estado inicial de todo negocio nuevo. */}
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div className="row spread">
            <h2>{t("precios.trialTitle")}</h2>
            <span className="badge">{t("precios.trialBadge")}</span>
          </div>
          <div style={{ margin: "8px 0" }}><span style={{ fontSize: 34, fontWeight: 800 }}>$0</span><span className="muted"> {t("precios.trialPrice")}</span></div>
          <p className="muted small" style={{ flex: 1 }}>{t("precios.trialDesc")}</p>
          <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={onRegistrar}>{t("vl.startFree")}</button>
        </div>

        {planes.filter((p) => p.tipo === "suscripcion").map((p, i) => (
          <div className="card" key={p.id} style={{ display: "flex", flexDirection: "column", borderColor: i === 1 ? "var(--brand-500)" : undefined, boxShadow: i === 1 ? "var(--glow)" : undefined }}>
            <div className="row spread">
              <h2>{p.nombre}</h2>
              {i === 1 && <span className="badge ok">{t("precios.mostChosen")}</span>}
            </div>
            {intervalo === "mensual" ? (
              <div style={{ margin: "8px 0" }}><span style={{ fontSize: 34, fontWeight: 800 }}>${p.mensualUsd}</span><span className="muted">{t("own.perMonth")}</span></div>
            ) : (
              <div style={{ margin: "8px 0" }}>
                <span style={{ fontSize: 34, fontWeight: 800 }}>${p.anualUsd}</span><span className="muted">{t("own.perYear")}</span>
                <div className="muted small">${p.anualPorMes}{t("own.perMonth")} · {t("own.save2months")} (−${p.ahorroAnualUsd})</div>
              </div>
            )}
            <ul className="muted small" style={{ paddingLeft: 18, marginTop: 6, flex: 1 }}>
              <li><strong style={{ color: "var(--text)" }}>{p.maxNegocios}</strong> {t("plan.businessesLabel")}</li>
              <li>{t("plan.upTo")} <strong style={{ color: "var(--text)" }}>{p.maxPeluqueros}</strong> {t("plan.prosLabel")}</li>
            </ul>
            <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={onRegistrar}>{t("pub.registerBiz")}</button>
          </div>
        ))}

        {/* Licencia de por vida: pago único de la app de escritorio (no es suscripción de la nube). */}
        {planes.filter((p) => p.tipo === "pago_unico").map((p) => (
          <div className="card" key={p.id} style={{ display: "flex", flexDirection: "column", borderColor: "var(--brand-500)" }}>
            <div className="row spread">
              <h2>{t("precios.lifetimeTitle")}</h2>
              <span className="badge">{t("precios.lifetimeBadge")}</span>
            </div>
            <div style={{ margin: "8px 0" }}>
              <span style={{ fontSize: 34, fontWeight: 800 }}>${p.precioUnicoUsd}</span>
              <span className="muted"> {t("precios.lifetimeOnce")}</span>
            </div>
            <p className="muted small" style={{ flex: 1 }}>{t("precios.lifetimeDesc")}</p>
            <ul className="muted small" style={{ paddingLeft: 18, marginTop: 0 }}>
              <li>{t("plan.upTo")} <strong style={{ color: "var(--text)" }}>{p.maxPeluqueros}</strong> {t("plan.prosLabel")}</li>
              <li>{t("precios.lifetimeAddons")}</li>
            </ul>
            <button className="primary" style={{ width: "100%", marginTop: 10 }} onClick={onRegistrar}>{t("precios.lifetimeCta")}</button>
          </div>
        ))}
      </div>

      {/* Lo que traen TODOS los planes pagos, mostrado una sola vez. */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>{t("precios.includedTitle")}</h2>
        <div className="value-grid">
          {INCLUIDO_EN_TODOS.map((f) => (
            <div className="value-card" key={f.key}>
              <span className="v-emoji">{f.icono}</span>
              <p className="muted small" style={{ margin: 0 }}>{t(f.key)}</p>
            </div>
          ))}
        </div>
      </div>

      <Faq items={preguntas} />

      <p style={{ textAlign: "center", marginTop: 20 }}><a href="/">{t("common.back")}</a></p>
    </div>
  );
}
