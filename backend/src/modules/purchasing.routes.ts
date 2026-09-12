import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { Conflict, NotFound } from "../lib/errors.js";
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
  // false = queda como orden de compra pendiente (no toca stock ni costo todavía, se recibe
  // después con /:id/recibir cuando el pedido realmente llega); true = como antes, entra
  // directo al inventario (compra de contado que ya se está llevando el proveedor).
  recibirAhora: z.coerce.boolean().default(true),
});

// Aplica el efecto de "recibir": suma stock y actualiza el costo de cada producto vinculado,
// más el movimiento en el ledger. Se usa tanto al crear una compra ya recibida como al recibir
// una orden pendiente más tarde.
async function recibirLineas(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], compraId: string, lineas: { productoId: string | null; costoUnit: unknown; cantidad: unknown }[]) {
  for (const l of lineas) {
    if (!l.productoId) continue;
    await tx.producto.update({ where: { id: l.productoId }, data: { stock: { increment: l.cantidad as number }, costo: l.costoUnit as number } });
    await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "entrada", cantidad: Math.abs(l.cantidad as number), motivo: `Compra ${compraId.slice(-6)}` } });
  }
}

purchasingRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const d = compraSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "compras.crear");
  const total = round2(d.lineas.reduce((s, l) => s + l.cantidad * l.costoUnit, 0));
  const estado = d.recibirAhora ? "recibida" : "pendiente";

  const compra = await prisma.$transaction(async (tx) => {
    const c = await tx.compra.create({
      data: {
        negocioId: d.negocioId, proveedor: d.proveedor ?? null, fecha: new Date(`${d.fecha}T00:00:00`), total,
        estado, recibidaEn: estado === "recibida" ? new Date() : null,
        lineas: { create: d.lineas.map((l) => ({ productoId: l.productoId ?? null, nombre: l.nombre, cantidad: l.cantidad, costoUnit: l.costoUnit })) },
      },
      include: { lineas: true },
    });
    if (estado === "recibida") await recibirLineas(tx, c.id, c.lineas);
    return c;
  });
  res.status(201).json({ compra });
}));

purchasingRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "compras.ver");
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const compras = await prisma.compra.findMany({
    where: { negocioId, ...(estado ? { estado } : {}) },
    include: { lineas: true },
    orderBy: { fecha: "desc" },
    take: 100,
  });
  res.json({ compras });
}));

// Marca una orden de compra pendiente como recibida: recién ahí suma el stock y actualiza el
// costo — es el momento en que el pedido realmente llegó al negocio.
purchasingRouter.post("/:id/recibir", requireAuth, asyncHandler(async (req, res) => {
  const c = await prisma.compra.findUnique({ where: { id: req.params.id }, include: { lineas: true } });
  if (!c) throw NotFound("Compra no encontrada");
  await requireAcceso(c.negocioId, req.user!.sub, req.user!.rol, "compras.crear");
  if (c.estado === "recibida") throw Conflict("Esta compra ya estaba recibida", "YA_RECIBIDA");

  const actualizada = await prisma.$transaction(async (tx) => {
    await recibirLineas(tx, c.id, c.lineas);
    return tx.compra.update({ where: { id: c.id }, data: { estado: "recibida", recibidaEn: new Date() }, include: { lineas: true } });
  });
  res.json({ compra: actualizada });
}));

// Elimina una compra. Si ya estaba recibida, revierte el stock que había sumado (no se intenta
// reconstruir el costo anterior del producto — no queda historial de ese dato — solo la
// cantidad); si era una orden pendiente, no hay nada que revertir porque nunca tocó el stock.
purchasingRouter.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const c = await prisma.compra.findUnique({ where: { id: req.params.id }, include: { lineas: true } });
  if (!c) throw NotFound("Compra no encontrada");
  await requireAcceso(c.negocioId, req.user!.sub, req.user!.rol, "compras.eliminar");

  await prisma.$transaction(async (tx) => {
    if (c.estado === "recibida") {
      for (const l of c.lineas) {
        if (!l.productoId) continue;
        await tx.producto.update({ where: { id: l.productoId }, data: { stock: { decrement: l.cantidad } } });
        await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "ajuste", cantidad: -Math.abs(Number(l.cantidad)), motivo: `Eliminación compra ${c.id.slice(-6)}` } });
      }
    }
    await tx.compra.delete({ where: { id: c.id } }); // cascada borra las líneas
  });
  res.json({ ok: true });
}));
