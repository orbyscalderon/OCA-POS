import { useEffect, useState } from "react";
import { api, type Perfil } from "../api";
import { rubroTema } from "../rubroTema";

// Landing de marketing por rubro (B2B). Ruta: /para/:slug
// El copy vive aquí; los módulos salen del catálogo del motor de nicho.
export const COPY: Record<string, { titulo: string; sub: string }> = {
  barberia: { titulo: "Agenda llena, negocio ordenado", sub: "Reservas online 24/7, comisiones por profesional y venta de productos — todo en un solo lugar." },
  taller: { titulo: "Órdenes de servicio bajo control", sub: "Recibe equipos, diagnostica, cotiza, repara y entrega con trazabilidad total." },
  restaurante: { titulo: "Comandas y mesas sin enredos", sub: "Toma pedidos por mesa, cobra al instante y descuenta insumos por receta." },
  supermercado: { titulo: "El punto de venta para tu colmado", sub: "Cobra rápido con lector de barras, controla inventario y fía a tu barrio." },
  ferreteria: { titulo: "Vende por metro, rollo o unidad", sub: "Inventario fraccionado, crédito a maestros constructores y cotizaciones en segundos." },
  vape_shop: { titulo: "El POS para tu vape shop", sub: "Miles de SKU por sabor y nicotina, inventario y ventas sin fricción, control de edad." },
  farmacia: { titulo: "Tu botica, ordenada", sub: "Busca por nombre o principio activo y controla lotes y vencimientos." },
  granja_avicola: { titulo: "Controla tu granja por lote", sub: "Mortalidad, consumo de alimento y conversión (FCR) al día, con costeo real por kg." },
  prestamista: { titulo: "Gestiona tus préstamos sin cuadernos", sub: "Cronograma automático, cobros, mora y estado de cada deudor al instante." },
  panaderia: { titulo: "Tu panadería, al minuto", sub: "Vende por unidad o docena, controla vencimientos por horneado y toma encargos de tortas." },
  moda: { titulo: "Tu tienda de ropa, sin enredos", sub: "Inventario por talla y color, apartado para tus clientas y catálogo online." },
  veterinaria: { titulo: "Tu veterinaria, con historial al día", sub: "Agenda por veterinario, ficha clínica de cada mascota y venta de alimento y medicamentos." },
};

const PASOS = [
  { emoji: "🧩", titulo: "Elegís tu rubro", texto: "Un formulario, no un desarrollo a medida. El sistema se arma solo con tus campos, roles y pantallas." },
  { emoji: "⚡", titulo: "Cargás tu negocio", texto: "Productos, precios y equipo en minutos. Sin instalaciones ni capacitaciones largas." },
  { emoji: "💳", titulo: "Empezás a cobrar", texto: "Punto de venta, caja, fiado y reportes funcionando desde el primer día." },
];

export function VerticalLanding({ slug, onRegistrar, onLogin }: { slug: string; onRegistrar: (perfil: string) => void; onLogin?: () => void }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [disponibles, setDisponibles] = useState<string[]>([]);
  const [stats, setStats] = useState<{ negocios: number; profesionales: number; reservas: number } | null>(null);

  useEffect(() => {
    api.get<{ perfiles: Perfil[]; moduloLabels: Record<string, string>; modulosDisponibles: string[] }>("/perfiles")
      .then((r) => { setPerfil(r.perfiles.find((p) => p.slug === slug) ?? null); setLabels(r.moduloLabels); setDisponibles(r.modulosDisponibles); })
      .catch(() => {});
    api.get<{ negocios: number; profesionales: number; reservas: number }>("/stats").then(setStats).catch(() => {});
  }, [slug]);

  if (!perfil) return <div className="container"><p className="muted">Cargando…</p></div>;
  const copy = COPY[slug] ?? { titulo: perfil.nombre, sub: perfil.descripcion };
  const tema = rubroTema(slug);
  const listo = perfil.modulos.every((m) => disponibles.includes(m));

  return (
    <div className="container" style={{ maxWidth: 960 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div
        style={{
          position: "relative", overflow: "hidden", background: tema.grad, borderRadius: 26,
          padding: "56px 28px", textAlign: "center", color: "#fff",
          boxShadow: "0 24px 70px rgba(0,0,0,.4)",
        }}
      >
        <div style={{
          position: "absolute", inset: 0, opacity: .5, pointerEvents: "none",
          background: "radial-gradient(60% 60% at 50% 0%, rgba(255,255,255,.22), transparent 70%)",
        }} />

        {/* Botón de login, visible y directo, arriba del hero */}
        {onLogin && (
          <button
            onClick={onLogin}
            style={{
              position: "absolute", top: 18, right: 18, zIndex: 1,
              background: "rgba(255,255,255,.14)", border: "1px solid rgba(255,255,255,.35)",
              color: "#fff", borderRadius: 999, padding: "8px 18px", fontSize: 13, fontWeight: 700,
              backdropFilter: "blur(6px)",
            }}
          >
            Iniciar sesión →
          </button>
        )}

        <div style={{ position: "relative" }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700,
            background: "rgba(255,255,255,.16)", border: "1px solid rgba(255,255,255,.3)",
            borderRadius: 999, padding: "6px 14px",
          }}>
            {perfil.emoji} {perfil.nombre} · 14 días gratis
          </span>
          <h1 style={{ marginTop: 18, color: "#fff", fontSize: 44, lineHeight: 1.08, letterSpacing: "-0.03em", maxWidth: "18ch", marginInline: "auto", textShadow: "0 2px 24px rgba(0,0,0,.35)" }}>
            {copy.titulo}
          </h1>
          <p style={{ maxWidth: 560, margin: "14px auto 0", fontSize: 18, opacity: .95 }}>{copy.sub}</p>
          <div className="row" style={{ marginTop: 26, justifyContent: "center", flexWrap: "wrap", gap: 10 }}>
            <button className="primary" style={{ fontSize: 16, padding: "13px 30px", background: "#fff", color: "#111" }} onClick={() => onRegistrar(slug)}>
              Empezar gratis
            </button>
            {onLogin && (
              <button
                onClick={onLogin}
                style={{ fontSize: 16, padding: "13px 26px", background: "transparent", border: "1.5px solid rgba(255,255,255,.55)", color: "#fff" }}
              >
                Ya tengo cuenta
              </button>
            )}
          </div>
          <p style={{ marginTop: 14, fontSize: 13, opacity: .9 }}>Sin tarjeta de crédito · cancelás cuando quieras</p>

          {stats && (stats.negocios > 0) && (
            <div className="mkt-trust" style={{ color: "rgba(255,255,255,.85)", marginTop: 22 }}>
              <span>🏪 {stats.negocios} negocios activos</span>
              <span>👥 {stats.profesionales} profesionales</span>
              <span>📅 {stats.reservas} operaciones ya procesadas</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Cómo funciona ────────────────────────────────────── */}
      <div className="value-grid" style={{ marginTop: 28 }}>
        {PASOS.map((p, i) => (
          <div className="card value-card" key={i} style={{ margin: 0 }}>
            <span className="v-emoji">{p.emoji}</span>
            <h3>{p.titulo}</h3>
            <p className="muted small">{p.texto}</p>
          </div>
        ))}
      </div>

      {/* ── Módulos incluidos ────────────────────────────────── */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="row spread">
          <h2 style={{ marginTop: 0 }}>Todo lo que incluye para {perfil.nombre}</h2>
          {listo && <span className="badge ok">✓ 100% funcional hoy</span>}
        </div>
        <div className="value-grid">
          {perfil.modulos.map((m) => (
            <div className="value-card" key={m}>
              <span className="v-emoji">{disponibles.includes(m) ? "✅" : "🔜"}</span>
              <h3 style={{ fontSize: 15 }}>{labels[m] ?? m}</h3>
              <p className="muted small">{disponibles.includes(m) ? "Disponible" : "Próximamente"}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA final ────────────────────────────────────────── */}
      <div className="card pop" style={{ textAlign: "center", borderColor: tema.accent, background: "linear-gradient(180deg, var(--surface), var(--surface-2))" }}>
        <h2>¿Listo para digitalizar tu {perfil.nombre.toLowerCase()}?</h2>
        <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
          <button className="primary" style={{ background: tema.accent, borderColor: tema.accent }} onClick={() => onRegistrar(slug)}>
            Crear mi cuenta
          </button>
          {onLogin && <button className="ghost" onClick={onLogin}>Iniciar sesión</button>}
        </div>
        <p className="muted small" style={{ marginTop: 14 }}>
          ¿Otro tipo de negocio? <a href="/soluciones">Ver todas las soluciones</a>
        </p>
      </div>
    </div>
  );
}
