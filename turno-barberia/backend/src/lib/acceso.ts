// Control de acceso por negocio: el dueño siempre puede todo; el personal (MiembroNegocio)
// tiene un rol funcional que determina a qué áreas puede entrar. Reemplaza el viejo patrón
// "assertDueno" (solo dueño o 403) en las rutas que el personal también debe poder usar.
import { prisma } from "./prisma.js";
import { Forbidden, NotFound } from "./errors.js";

export type RolNegocio = "dueno" | "gerente" | "cajero" | "inventario" | "contador";
export type Area = "pos" | "caja" | "inventario" | "compras" | "gastos" | "reportes" | "impuestos" | "equipo" | "agro";

// Roles asignables al invitar personal (el dueño no se invita a sí mismo).
export const ROLES_ASIGNABLES = ["gerente", "cajero", "inventario", "contador"] as const;

const CAPACIDADES: Record<Exclude<RolNegocio, "dueno">, Set<Area>> = {
  gerente:    new Set(["pos", "caja", "inventario", "compras", "gastos", "reportes", "impuestos", "equipo", "agro"]),
  cajero:     new Set(["pos", "caja"]),
  inventario: new Set(["inventario", "compras", "agro"]),
  contador:   new Set(["gastos", "reportes", "impuestos", "compras"]),
};

function puedeAcceder(rol: RolNegocio, area: Area): boolean {
  if (rol === "dueno") return true;
  return CAPACIDADES[rol].has(area);
}

/**
 * Exige que el usuario autenticado pueda operar el área indicada de este negocio,
 * ya sea como dueño o como personal (MiembroNegocio) con el rol adecuado.
 * Devuelve el rol efectivo (útil para que el frontend sepa qué mostrar).
 */
export async function requireAcceso(
  negocioId: string,
  usuarioId: number,
  usuarioRolGlobal: string,
  area: Area,
): Promise<RolNegocio> {
  if (usuarioRolGlobal === "superadmin") return "dueno";

  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId }, select: { duenoId: true } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId === usuarioId) return "dueno";

  const miembro = await prisma.miembroNegocio.findUnique({
    where: { negocioId_usuarioId: { negocioId, usuarioId } },
  });
  if (!miembro || !miembro.activo) throw Forbidden("No tienes acceso a este negocio");

  const rol = miembro.rol as RolNegocio;
  if (!puedeAcceder(rol, area)) throw Forbidden(`Tu rol (${rol}) no tiene acceso a esta sección`);
  return rol;
}
