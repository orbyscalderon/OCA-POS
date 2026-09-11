import { useEffect, useState } from "react";
import { api, type Perfil } from "../api";
import { rubroTema } from "../rubroTema";
import { useT } from "../i18n";

// Hub de soluciones: una tarjeta por rubro que lleva a su landing. Ruta: /soluciones
export function Soluciones() {
  const { t } = useT();
  const [perfiles, setPerfiles] = useState<Perfil[]>([]);
  useEffect(() => { api.get<{ perfiles: Perfil[] }>("/perfiles").then((r) => setPerfiles(r.perfiles)).catch(() => {}); }, []);

  return (
    <div className="container" style={{ maxWidth: 900 }}>
      <div className="mkt-hero" style={{ paddingBottom: 24 }}>
        <h1>{t("sol.title")}</h1>
        <p className="sub">{t("sol.sub")}</p>
      </div>
      <div className="mkt-grid">
        {perfiles.map((p) => (
          <a className="biz-card" key={p.slug} href={`/para/${p.slug}`} style={{ textDecoration: "none" }}>
            <div className="biz-cover" style={{ background: rubroTema(p.slug).grad, display: "grid", placeItems: "center" }}>
              <span style={{ fontSize: 44 }}>{p.emoji}</span>
            </div>
            <div className="biz-body">
              <h3>{p.nombre}</h3>
              <div className="biz-meta">{p.descripcion}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
