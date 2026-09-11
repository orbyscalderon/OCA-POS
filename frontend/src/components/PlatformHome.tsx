import { useEffect, useState } from "react";
import { api, type Perfil } from "../api";
import { rubroTema } from "../rubroTema";
import { useT } from "../i18n";

// Página principal de la plataforma (multi-rubro). No es específica de belleza.
export function PlatformHome({ onNegocio, onReservar }: { onNegocio: () => void; onReservar: () => void }) {
  const { t } = useT();
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  useEffect(() => { api.get<{ perfiles: Perfil[] }>("/perfiles").then((r) => setPerfiles(r.perfiles)).catch(() => {}); }, []);

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      <div className="mkt-hero">
        <h1 className="grad-text">{t("pf.heroTitle")}</h1>
        <p className="sub">{t("pf.heroSub")}</p>
      </div>

      {/* Tres caminos: negocio, reservar un servicio, o buscar un producto */}
      <div className="grid grid-2" style={{ marginTop: 4 }}>
        <div className="card" style={{ borderColor: "var(--brand-500)" }}>
          <h2 style={{ marginTop: 0 }}>{t("pf.businessTitle")}</h2>
          <p className="muted">{t("pf.businessDesc")}</p>
          <button className="primary" style={{ marginTop: 8 }} onClick={onNegocio}>{t("pf.businessCta")}</button>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("pf.bookTitle")}</h2>
          <p className="muted">{t("pf.bookDesc")}</p>
          <button className="ghost" style={{ marginTop: 8 }} onClick={onReservar}>{t("pf.bookCta")}</button>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>{t("pf.searchTitle")}</h2>
          <p className="muted">{t("pf.searchDesc")}</p>
          <a href="/buscar"><button className="ghost" style={{ marginTop: 8 }}>{t("pf.searchCta")}</button></a>
        </div>
      </div>

      {/* Verticales */}
      <h2 style={{ marginTop: 30 }}>{t("pf.eachBusiness")}</h2>
      <div className="mkt-grid">
        {perfiles.map((p) => (
          <a className="biz-card" key={p.slug} href={`/para/${p.slug}`} style={{ textDecoration: "none" }}>
            <div className="biz-cover" style={{ background: rubroTema(p.slug).grad, display: "grid", placeItems: "center" }}>
              <span style={{ fontSize: 40 }}>{p.emoji}</span>
            </div>
            <div className="biz-body">
              <h3>{p.nombre}</h3>
              <div className="biz-meta">{p.descripcion}</div>
            </div>
          </a>
        ))}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <div className="value-grid">
          <div className="value-card"><span className="v-emoji">⚡</span><h3>{t("pf.value1t")}</h3><p className="muted small">{t("pf.value1d")}</p></div>
          <div className="value-card"><span className="v-emoji">🔒</span><h3>{t("pf.value2t")}</h3><p className="muted small">{t("pf.value2d")}</p></div>
          <div className="value-card"><span className="v-emoji">🧩</span><h3>{t("pf.value3t")}</h3><p className="muted small">{t("pf.value3d")}</p></div>
        </div>
      </div>
    </div>
  );
}
