// Utilidades de fecha en horario LOCAL del navegador.
//
// El backend guarda fechas "solo día" (sin hora) como medianoche UTC. Si se leen con
// `new Date(str).toLocaleDateString()` o se genera "hoy" con `new Date().toISOString()`,
// cualquier usuario con offset UTC negativo (América completa) puede ver la fecha
// desplazada un día hacia atrás, o que "hoy" ya apunte al día siguiente por la tarde/noche.
// Estas funciones evitan ese desfase trabajando siempre en horario local.

// Fecha de HOY en horario local, como "YYYY-MM-DD".
export function hoyLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Solo la parte "YYYY-MM-DD" de una fecha/fecha-hora ISO (sin pasar por Date ni timezone).
export function soloFecha(s: string): string {
  return s.slice(0, 10);
}

// Formatea una fecha "solo día" (o un ISO con hora) para mostrarla, sin desfase de timezone.
export function formatFechaLocal(s: string): string {
  const [y, m, d] = soloFecha(s).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString();
}

// true si la fecha "YYYY-MM-DD" dada ya quedó completamente atrás (venció).
export function fechaVencida(s: string): boolean {
  return soloFecha(s) < hoyLocal();
}
