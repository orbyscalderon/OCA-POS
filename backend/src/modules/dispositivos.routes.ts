import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const dispositivosRouter = Router();

// Perfiles con los que arranca un negocio nuevo — el dueño los puede editar/borrar/agregar
// otros después, esto es solo el punto de partida para no arrancar de una lista vacía.
const PERFILES_INICIALES = [
  { nombre: "Pod Estándar", capacidadMl: 2 },
  { nombre: "Pod XL / Mod Chico", capacidadMl: 4 },
  { nombre: "Mod Mediano", capacidadMl: 5 },
  { nombre: "Tanque Grande Sub-Ohm", capacidadMl: 8 },
];

// Listar los perfiles de dispositivo del negocio — si todavía no tiene ninguno, se crean los
// iniciales de una (así el cajero ya tiene algo para elegir desde el primer día).
dispositivosRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    // La venta también los usa (botones rápidos de ml al vender una recarga).
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, ["ventas.vender", "inventario.ver"]);

    let perfiles = await prisma.perfilDispositivo.findMany({ where: { negocioId }, orderBy: { capacidadMl: "asc" } });
    if (perfiles.length === 0) {
      await prisma.perfilDispositivo.createMany({
        data: PERFILES_INICIALES.map((p) => ({ ...p, negocioId })),
      });
      perfiles = await prisma.perfilDispositivo.findMany({ where: { negocioId }, orderBy: { capacidadMl: "asc" } });
    }
    res.json({ perfiles });
  }),
);

const perfilSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(80),
  capacidadMl: z.coerce.number().positive(),
});

dispositivosRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const d = perfilSchema.parse(req.body);
    await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "inventario.editar");
    const perfil = await prisma.perfilDispositivo.create({ data: d });
    res.status(201).json({ perfil });
  }),
);

dispositivosRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = await prisma.perfilDispositivo.findUnique({ where: { id: req.params.id } });
    if (!p) throw NotFound("Perfil no encontrado");
    await requireAcceso(p.negocioId, req.user!.sub, req.user!.rol, "inventario.editar");
    const d = perfilSchema.omit({ negocioId: true }).partial().parse(req.body);
    const perfil = await prisma.perfilDispositivo.update({ where: { id: p.id }, data: d });
    res.json({ perfil });
  }),
);

dispositivosRouter.delete(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = await prisma.perfilDispositivo.findUnique({ where: { id: req.params.id } });
    if (!p) throw NotFound("Perfil no encontrado");
    await requireAcceso(p.negocioId, req.user!.sub, req.user!.rol, "inventario.editar");
    await prisma.perfilDispositivo.delete({ where: { id: p.id } });
    res.json({ ok: true });
  }),
);
