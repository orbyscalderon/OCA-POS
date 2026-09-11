import { useEffect, useState } from "react";
import { api, type Negocio } from "../api";
import { Stat } from "./Ui";
import { hoyLocal } from "../dateUtils";
import { useT } from "../i18n";

// Módulo IMPUESTOS: reporte del ITBIS/IVA cobrado en ventas del mes.
const money = (n: number | string) => `$${Number(n).toFixed(2)}`;
const mesActual = () => hoyLocal().slice(0, 7);

export function ImpuestosView({ negocio }: { negocio: Negocio }) {
  const { t } = useT();
  const [mes, setMes] = useState(mesActual());
  const [r, setR] = useState<{ conteo: number; subtotal: number; impuesto: number; total: number } | null>(null);

  useEffect(() => {
    api.get<{ conteo: number; subtotal: number; impuesto: number; total: number }>(`/impuestos/reporte?negocioId=${negocio.id}&mes=${mes}`)
      .then(setR).catch(() => setR(null));
  }, [negocio.id, mes]);

  return (
    <div className="card">
      <div className="row spread">
        <h2>{t("impuestos.title")}</h2>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={{ width: "auto" }} />
      </div>
      <p className="muted small">{t("impuestos.desc")}</p>
      {r ? (
        <div className="grid grid-2" style={{ marginTop: 8 }}>
          <Stat label={t("impuestos.salesSubtotal")} value={money(r.subtotal)} icon="🛒" />
          <Stat label={t("impuestos.taxCollected")} value={money(r.impuesto)} icon="🧮" variant="green" />
          <Stat label={t("impuestos.totalInvoiced")} value={money(r.total)} icon="💵" variant="accent" />
          <Stat label={t("impuestos.salesCount")} value={r.conteo} icon="🧾" />
        </div>
      ) : (
        <p className="muted small">{t("impuestos.noData")}</p>
      )}
    </div>
  );
}
