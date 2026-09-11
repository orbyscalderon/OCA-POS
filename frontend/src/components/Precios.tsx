import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { Faq } from "./Faq";

interface Plan { id: string; nombre: string; mensualUsd: number; anualUsd: number; anualPorMes: number; ahorroAnualUsd: number; maxNegocios: number; maxPeluqueros: number; }

// Funciones que trae CUALQUIER plan pago (no varían entre Básico y Pro — lo único que
// cambia es cuántos negocios y profesionales podés tener activos). Mostrarlas una sola
// vez, en vez de repetirlas idénticas en cada tarjeta, evita dar a entender que un plan
// "incluye más" cuando en realidad la diferencia real es solo el límite de uso.
const INCLUIDO_EN_TODOS = [
  { icono: "🛒", texto: "Punto de venta e inventario" },
  { icono: "📅", texto: "Reservas y agenda online" },
  { icono: "📒", texto: "Fiado / crédito a clientes" },
  { icono: "💵", texto: "Caja, arqueo y reportes" },
  { icono: "🌐", texto: "Tienda online por WhatsApp" },
  { icono: "👥", texto: "Roles y permisos para tu equipo" },
];

const PREGUNTAS = [
  { pregunta: "¿Qué pasa cuando terminan los 14 días de prueba?", respuesta: "Te pedimos elegir un plan (Básico o Pro) para seguir. No perdés nada de lo que cargaste: productos, clientes, ventas e historial quedan intactos." },
  { pregunta: "¿Hay permanencia o contrato?", respuesta: "No. Es mes a mes (o año a año si elegís el plan anual) y podés cancelar cuando quieras desde tu cuenta." },
  { pregunta: "¿Qué pasa si supero el límite de negocios o profesionales de mi plan?", respuesta: "Podés seguir usando todo lo que ya tenés funcionando sin problema. Para agregar un negocio o profesional adicional una vez alcanzado el límite, necesitás subir de plan." },
  { pregunta: "¿Puedo cambiar de rubro después de crear mi negocio?", respuesta: "El rubro se elige al crear el negocio, porque define qué campos y pantallas ves. Si necesitás cambiarlo más adelante, escribinos a soporte y te ayudamos." },
  { pregunta: "¿Mis datos están separados de los de otros negocios?", respuesta: "Sí. Cada negocio solo puede ver y operar sus propios datos — lo verificamos en cada consulta a la base de datos, no es una promesa de la interfaz." },
  { pregunta: "¿Necesito internet para usarlo?", respuesta: "Sí, hoy el sistema funciona conectado (es una aplicación en la nube). El modo sin conexión está en el roadmap, todavía no está disponible." },
  { pregunta: "¿Cómo pago?", respuesta: "Con tarjeta a través de Stripe. El plan anual sale como pagar 10 meses y usar 12 (2 meses gratis)." },
];

// Página pública de precios (para atraer negocios antes de registrarse).
export function Precios({ onRegistrar }: { onRegistrar: () => void }) {
  const { t } = useT();
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [intervalo, setIntervalo] = useState<"mensual" | "anual">("anual");

  useEffect(() => { api.get<{ planes: Plan[] }>("/suscripcion/planes").then((r) => setPlanes(r.planes)).catch(() => {}); }, []);

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
            <h2>Prueba gratis</h2>
            <span className="badge">14 días</span>
          </div>
          <div style={{ margin: "8px 0" }}><span style={{ fontSize: 34, fontWeight: 800 }}>$0</span><span className="muted"> para empezar</span></div>
          <p className="muted small" style={{ flex: 1 }}>Probá el sistema completo con tu rubro activado. Sin tarjeta de crédito.</p>
          <button className="ghost" style={{ width: "100%", marginTop: 10 }} onClick={onRegistrar}>Empezar gratis</button>
        </div>

        {planes.map((p, i) => (
          <div className="card" key={p.id} style={{ display: "flex", flexDirection: "column", borderColor: i === 1 ? "var(--brand-500)" : undefined, boxShadow: i === 1 ? "var(--glow)" : undefined }}>
            <div className="row spread">
              <h2>{p.nombre}</h2>
              {i === 1 && <span className="badge ok">★ Más elegido</span>}
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
      </div>

      {/* Lo que traen TODOS los planes pagos, mostrado una sola vez. */}
      <div className="card" style={{ marginTop: 18 }}>
        <h2 style={{ marginTop: 0 }}>Incluido en Básico y Pro, sin costo extra</h2>
        <div className="value-grid">
          {INCLUIDO_EN_TODOS.map((f) => (
            <div className="value-card" key={f.texto}>
              <span className="v-emoji">{f.icono}</span>
              <p className="muted small" style={{ margin: 0 }}>{f.texto}</p>
            </div>
          ))}
        </div>
      </div>

      <Faq items={PREGUNTAS} />

      <p style={{ textAlign: "center", marginTop: 20 }}><a href="/">{t("common.back")}</a></p>
    </div>
  );
}
