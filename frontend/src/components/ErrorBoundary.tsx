import { Component, type ReactNode } from "react";

interface Props { children: ReactNode }
interface State { error: Error | null }

// Este componente vive fuera de I18nProvider (debe poder capturar errores del propio
// provider), así que detecta el idioma directamente en vez de usar useT().
function idiomaFallback(): "es" | "en" {
  try {
    const guardado = localStorage.getItem("turno_lang");
    if (guardado === "es" || guardado === "en") return guardado;
  } catch { /* localStorage no disponible */ }
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

const TEXTOS = {
  es: { titulo: "Algo salió mal", sub: "Ocurrió un error inesperado. Puedes recargar la página.", boton: "Recargar" },
  en: { titulo: "Something went wrong", sub: "An unexpected error occurred. You can reload the page.", boton: "Reload" },
};

// Captura errores de render para evitar la "pantalla en blanco" y ofrecer recuperación.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // Captura de errores lista para Sentry: si defines VITE_SENTRY_DSN, aquí se enviaría.
    // Ejemplo: if (import.meta.env.VITE_SENTRY_DSN) Sentry.captureException(error);
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.error) {
      const tx = TEXTOS[idiomaFallback()];
      return (
        <div className="container" style={{ maxWidth: 480, marginTop: 60 }}>
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 44 }}>😵</div>
            <h1>{tx.titulo}</h1>
            <p className="muted">{tx.sub}</p>
            <button className="primary" style={{ marginTop: 12 }} onClick={() => window.location.assign("/")}>
              {tx.boton}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
