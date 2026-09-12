import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const purchasingRouter = Router();
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

const compraSchema = z.object({
  negocioId: z.string().min(1),
  proveedor: z.string().max(120).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lineas: z.array(z.object({
    productoId: z.string().optional(),
    nombre: z.string().min(1).max(150),
    cantidad: z.coerce.number().positive(),
    costoUnit: z.coerce.number().min(0),
  })).min(1),
});

// Registra una compra y SUMA stock a los productos vinculados (entrada al ledger).
purchasingRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const d = compraSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "compras.crear");
  const total = round2(d.lineas.reduce((s, l) => s + l.cantidad * l.costoUnit, 0));

  const compra = await prisma.$transaction(async (tx) => {
    const c = await tx.compra.create({
      data: {
        negocioId: d.negocioId, proveedor: d.proveedor ?? null, fecha: new Date(`${d.fecha}T00:00:00`), total,
        lineas: { create: d.lineas.map((l) => ({ productoId: l.productoId ?? null, nombre: l.nombre, cantidad: l.cantidad, costoUnit: l.costoUnit })) },
      },
      include: { lineas: true },
    });
    for (const l of d.lineas) {
      if (!l.productoId) continue;
      await tx.producto.update({ where: { id: l.productoId }, data: { stock: { increment: l.cantidad }, costo: l.costoUnit } });
      await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "entrada", cantidad: Math.abs(l.cantidad), motivo: `Compra ${c.id.slice(-6)}` } });
    }
    return c;
  });
  res.status(201).json({ compra });
}));

purchasingRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "compras.ver");
  const compras = await prisma.compra.findMany({ where: { negocioId }, include: { lineas: true }, orderBy: { fecha: "desc" }, take: 100 });
  res.json({ compras });
}));

// Elimina una compra y revierte el stock que había sumado (no se intenta reconstruir el costo
// anterior del producto — no queda historial de ese dato — solo la cantidad).
purchasingRouter.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const c = await prisma.compra.findUnique({ where: { id: req.params.id }, include: { lineas: true } });
  if (!c) throw NotFound("Compra no encontrada");
  await requireAcceso(c.negocioId, req.user!.sub, req.user!.rol, "compras.eliminar");

  await prisma.$transaction(async (tx) => {
    for (const l of c.lineas) {
      if (!l.productoId) continue;
      await tx.producto.update({ where: { id: l.productoId }, data: { stock: { decrement: l.cantidad } } });
      await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "ajuste", cantidad: -Math.abs(Number(l.cantidad)), motivo: `Eliminación compra ${c.id.slice(-6)}` } });
    }
    await tx.compra.delete({ where: { id: c.id } }); // cascada borra las líneas
  });
  res.json({ ok: true });
}));
