// Acordeón de preguntas frecuentes, reutilizable en cualquier landing pública.
// Usa <details>/<summary> nativo: accesible, sin JS ni estado propio.
export interface FaqItem { pregunta: string; respuesta: string }

export function Faq({ items, titulo = "Preguntas frecuentes" }: { items: FaqItem[]; titulo?: string }) {
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h2 style={{ marginTop: 0 }}>{titulo}</h2>
      {items.map((it, i) => (
        <details key={i} className="faq-item">
          <summary>{it.pregunta}</summary>
          <p className="muted small" style={{ margin: "8px 0 0" }}>{it.respuesta}</p>
        </details>
      ))}
    </div>
  );
}
