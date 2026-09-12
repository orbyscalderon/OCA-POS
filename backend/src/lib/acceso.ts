// Control de acceso por negocio: el dueño siempre puede todo; el personal (MiembroNegocio)
// tiene un conjunto de permisos GRANULARES (no un "rol" con capacidades fijas) — el dueño
// elige función por función qué puede hacer cada persona (vender, crear cliente, eliminar
// compras, etc.), en vez de encasillarlo en un puñado de roles predefinidos.
import { z } from "zod";
import { prisma } from "./prisma.js";
import { Forbidden, NotFound } from "./errors.js";

export type RolNegocio = "dueno" | "personal";

// Catálogo completo de permisos. Cada uno protege una acción concreta del backend — el
// checkbox que el dueño marca al crear/editar un miembro corresponde 1 a 1 con uno de estos.
export const PERMISOS = [
  "ventas.vender", "ventas.anular", "ventas.caja",
  "inventario.ver", "inventario.crear", "inventario.editar", "inventario.eliminar",
  "clientes.ver", "clientes.crear", "clientes.editar", "clientes.eliminar",
  "compras.ver", "compras.crear", "compras.eliminar",
  "gastos.ver", "gastos.crear", "gastos.eliminar",
  "reportes.ver",
  "impuestos.gestionar",
  "agro.gestionar",
  "equipo.ver", "equipo.crear", "equipo.editar", "equipo.eliminar",
] as const;
export type Permiso = (typeof PERMISOS)[number];
export const permisoSchema = z.enum(PERMISOS);

// Plantillas de arranque rápido: el dueño puede aplicar una y después ajustar casillas
// individuales — no son roles fijos, son solo un punto de partida para no tildar 24 casillas
// una por una. Los nombres se mantienen por compatibilidad con instalaciones existentes
// (columna `rol` de MiembroNegocio, ahora puramente informativa/de etiqueta).
export const PLANTILLAS: Record<string, Permiso[]> = {
  gerente: [...PERMISOS],
  cajero: ["ventas.vender", "ventas.caja"],
  inventario: ["inventario.ver", "inventario.crear", "inventario.editar", "inventario.eliminar", "compras.ver", "compras.crear", "agro.gestionar"],
  contador: ["gastos.ver", "gastos.crear", "gastos.eliminar", "reportes.ver", "impuestos.gestionar", "compras.ver"],
};
export const ROLES_ASIGNABLES = ["gerente", "cajero", "inventario", "contador"] as const;

// El panel de Contabilidad agrupa todo lo sensible detrás de un PIN aparte — cualquiera de
// estos permisos habilita la entrada (después, cada sección adentro pide el suyo propio).
export const PERMISOS_CONTABILIDAD: Permiso[] = [
  "ventas.caja", "gastos.ver", "compras.ver", "impuestos.gestionar", "reportes.ver", "equipo.ver",
];

function tienePermiso(permisos: string[], requeridos: Permiso | Permiso[]): boolean {
  const lista = Array.isArray(requeridos) ? requeridos : [requeridos];
  return lista.some((p) => permisos.includes(p));
}

/**
 * Exige que el usuario autenticado tenga (al menos uno de) el/los permiso(s) indicados en
 * este negocio, ya sea como dueño (acceso total implícito) o como personal con ese permiso
 * concedido explícitamente. Devuelve "dueno" | "personal" (útil para reglas extra, como
 * "solo el dueño puede reasignar permisos").
 */
export async function requireAcceso(
  negocioId: string,
  usuarioId: number,
  usuarioRolGlobal: string,
  permiso: Permiso | Permiso[],
): Promise<RolNegocio> {
  if (usuarioRolGlobal === "superadmin") return "dueno";

  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId === usuarioId) return "dueno";

  const miembro = await prisma.miembroNegocio.findUnique({
    where: { negocioId_usuarioId: { negocioId, usuarioId } },
  });
  if (!miembro || !miembro.activo) throw Forbidden("No tienes acceso a este negocio");
  if (!tienePermiso(miembro.permisos, permiso)) {
    throw Forbidden("No tienes el permiso necesario para esta acción");
  }
  return "personal";
}
