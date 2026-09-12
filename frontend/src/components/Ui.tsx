import { useState, type ReactNode } from "react";
import { useT } from "../i18n";

interface EstadoPrompt {
  mensaje: string;
  esConfirm: boolean; // true = solo mensaje + OK/Cancelar, sin campo de texto
  resolve: (v: string | null) => void;
}

// Reemplazo de window.prompt()/confirm(): en la app de escritorio (Electron) el prompt()
// nativo del navegador no muestra ningún diálogo — el botón parece "no hacer nada". Este modal
// propio funciona siempre, igual en escritorio que en la web, y de paso queda con el estilo de
// la app en vez del diálogo feo del sistema.
export function usePrompt() {
  const { t } = useT();
  const [estado, setEstado] = useState<EstadoPrompt | null>(null);
  const [valor, setValor] = useState("");

  function promptValor(mensaje: string, valorInicial = ""): Promise<string | null> {
    return new Promise((resolve) => {
      setValor(valorInicial);
      setEstado({ mensaje, esConfirm: false, resolve });
    });
  }

  function promptConfirmar(mensaje: string): Promise<boolean> {
    return new Promise((resolve) => {
      setEstado({ mensaje, esConfirm: true, resolve: (v) => resolve(v !== null) });
    });
  }

  function aceptar() {
    if (!estado) return;
    estado.resolve(estado.esConfirm ? "ok" : valor);
    setEstado(null);
  }
  function cancelar() {
    if (!estado) return;
    estado.resolve(null);
    setEstado(null);
  }

  const modal = estado ? (
    <div className="modal-overlay" onClick={cancelar}>
      <div className="modal" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <p className="small" style={{ margin: "0 0 12px", whiteSpace: "pre-wrap" }}>{estado.mensaje}</p>
        {!estado.esConfirm && (
          <input autoFocus value={valor} onChange={(e) => setValor(e.target.value)} onKeyDown={(e) => e.key === "Enter" && aceptar()} />
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="primary" style={{ flex: 1 }} onClick={aceptar}>{t("common.confirm")}</button>
          <button type="button" className="ghost" style={{ flex: 1 }} onClick={cancelar}>{t("common.cancel")}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { promptValor, promptConfirmar, modal };
}

// Tarjeta de métrica con acento de color y opcional icono.
export function Stat({ label, value, icon, variant }: { label: string; value: ReactNode; icon?: string; variant?: "accent" | "green" }) {
  return (
    <div className={`stat ${variant ?? ""}`}>
      {icon && <span className="stat-icon">{icon}</span>}
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

// Estado vacío amistoso con emoji flotante.
export function Empty({ emoji = "✨", children }: { emoji?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-emoji float-emoji">{emoji}</span>
      <div>{children}</div>
    </div>
  );
}

// Skeletons con shimmer para estados de carga (sin layout shift).
export function SkeletonCards({ n = 3 }: { n?: number }) {
  return (
    <div>
      {Array.from({ length: n }).map((_, i) => (
        <div className="skeleton skel-card" key={i} />
      ))}
    </div>
  );
}

export function SkeletonLines({ n = 3 }: { n?: number }) {
  return (
    <div className="card">
      {Array.from({ length: n }).map((_, i) => (
        <div className={`skeleton skel-line ${i === n - 1 ? "short" : ""}`} key={i} />
      ))}
    </div>
  );
}
