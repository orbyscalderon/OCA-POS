import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Conflict, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const posRouter = Router();

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

function rangoDia(fecha?: string) {
  const base = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? new Date(`${fecha}T00:00:00`) : new Date();
  const desde = new Date(base); desde.setHours(0, 0, 0, 0);
  const hasta = new Date(desde); hasta.setDate(hasta.getDate() + 1);
  return { desde, hasta };
}

// ---------- CAJA ----------
posRouter.get(
  "/caja/actual",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "caja");
    const sesion = await prisma.sesionCaja.findFirst({ where: { negocioId, estado: "abierta" }, orderBy: { abiertaEn: "desc" } });
    res.json({ sesion });
  }),
);

posRouter.post(
  "/caja/abrir",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { negocioId, montoInicial } = z.object({ negocioId: z.string().min(1), montoInicial: z.coerce.number().min(0) }).parse(req.body);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "caja");
    const sesion = await prisma.$transaction(async (tx) => {
      // Bloquea el negocio antes de comprobar: dos "abrir caja" concurrentes no deben
      // pasar ambos el chequeo y crear dos sesiones abiertas a la vez.
      await tx.$queryRaw`SELECT id FROM "negocios" WHERE id = ${negocioId} FOR UPDATE`;
      const abierta = await tx.sesionCaja.findFirst({ where: { negocioId, estado: "abierta" } });
      if (abierta) throw Conflict("Ya hay una caja abierta", "CAJA_ABIERTA");
      return tx.sesionCaja.create({ data: { negocioId, montoInicial } });
    });
    res.status(201).json({ sesion });
  }),
);

posRouter.post(
  "/caja/cerrar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { negocioId, montoFinal } = z.object({ negocioId: z.string().min(1), montoFinal: z.coerce.number().min(0) }).parse(req.body);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "caja");
    const sesion = await prisma.sesionCaja.findFirst({ where: { negocioId, estado: "abierta" } });
    if (!sesion) throw BadRequest("No hay caja abierta");
    const ventas = await prisma.venta.findMany({ where: { sesionCajaId: sesion.id, metodoPago: "efectivo" }, select: { total: true } });
    const ventasEfectivo = round2(ventas.reduce((s, v) => s + Number(v.total), 0));
    const esperado = round2(Number(sesion.montoInicial) + ventasEfectivo);
    const cerrada = await prisma.sesionCaja.update({
      where: { id: sesion.id },
      data: { estado: "cerrada", montoFinal, cerradaEn: new Date() },
    });
    res.json({ sesion: cerrada, ventasEfectivo, esperado, descuadre: round2(montoFinal - esperado) });
  }),
);

// ---------- VENTAS (POS) ----------
const ventaSchema = z.object({
  negocioId: z.string().min(1),
  metodoPago: z.enum(["efectivo", "tarjeta", "transferencia", "fiado", "otro"]).default("efectivo"),
  clienteId: z.string().min(1).optional(),
  lineas: z.array(z.object({
    productoId: z.string().optional(),
    nombre: z.string().min(1).max(150),
    cantidad: z.coerce.number().positive(),
    precioUnit: z.coerce.number().min(0),
    impuestoPct: z.coerce.number().min(0).max(100).optional(),
  })).min(1),
});

posRouter.post(
  "/ventas",
  requireAuth,
  asyncHandler(async (req, res) => {
    const d = ventaSchema.parse(req.body);
    await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "pos");
    if (d.metodoPago === "fiado" && !d.clienteId) {
      throw BadRequest("Una venta fiada requiere elegir un cliente", "FIADO_SIN_CLIENTE");
    }

    // El cliente del fiado debe ser de este negocio (evita fiar a un cliente ajeno).
    let cliente: { id: string } | null = null;
    if (d.clienteId) {
      cliente = await prisma.clienteNegocio.findFirst({ where: { id: d.clienteId, negocioId: d.negocioId }, select: { id: true } });
      if (!cliente) throw NotFound("Cliente no encontrado");
    }

    // Impuesto por línea: usa el de la línea o el del producto.
    const ids = d.lineas.map((l) => l.productoId).filter(Boolean) as string[];
    const productos = ids.length ? await prisma.producto.findMany({ where: { id: { in: ids }, negocioId: d.negocioId } }) : [];
    const mapProd = new Map(productos.map((p) => [p.id, p]));

    let subtotal = 0, impuesto = 0;
    const lineasCalc = d.lineas.map((l) => {
      const imp = l.impuestoPct ?? (l.productoId ? Number(mapProd.get(l.productoId)?.impuestoPct ?? 0) : 0);
      const sub = round2(l.cantidad * l.precioUnit);
      const impLinea = round2((sub * imp) / 100);
      subtotal = round2(subtotal + sub);
      impuesto = round2(impuesto + impLinea);
      // Solo se persiste el productoId si es un producto real de este negocio: evita
      // que una línea quede con una referencia colgante a un producto de otro tenant.
      const productoId = l.productoId && mapProd.has(l.productoId) ? l.productoId : null;
      return { productoId, nombre: l.nombre, cantidad: l.cantidad, precioUnit: l.precioUnit, subtotal: round2(sub + impLinea) };
    });
    const total = round2(subtotal + impuesto);

    const sesion = await prisma.sesionCaja.findFirst({ where: { negocioId: d.negocioId, estado: "abierta" }, select: { id: true } });

    const venta = await prisma.$transaction(async (tx) => {
      const v = await tx.venta.create({
        data: {
          negocioId: d.negocioId, subtotal, impuesto, total, metodoPago: d.metodoPago, sesionCajaId: sesion?.id ?? null,
          clienteId: cliente?.id ?? null,
          lineas: { create: lineasCalc },
        },
        include: { lineas: true },
      });
      // Descontar stock y registrar movimiento por cada línea con producto.
      for (const l of d.lineas) {
        if (!l.productoId || !mapProd.has(l.productoId)) continue;
        await tx.producto.update({ where: { id: l.productoId }, data: { stock: { decrement: l.cantidad } } });
        await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "venta", cantidad: -Math.abs(l.cantidad), motivo: `Venta ${v.id.slice(-6)}` } });
      }
      // Fiado: el total de la venta se suma al saldo del cliente (increment atómico).
      if (d.metodoPago === "fiado" && cliente) {
        await tx.clienteNegocio.update({ where: { id: cliente.id }, data: { saldoFiado: { increment: total } } });
      }
      return v;
    });
    res.status(201).json({ venta });
  }),
);

// Ventas del día (o de una fecha) con totales.
posRouter.get(
  "/ventas",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "pos");
    const { desde, hasta } = rangoDia(typeof req.query.fecha === "string" ? req.query.fecha : undefined);
    const ventas = await prisma.venta.findMany({
      where: { negocioId, createdAt: { gte: desde, lt: hasta } },
      include: { lineas: true },
      orderBy: { createdAt: "desc" },
    });
    const total = round2(ventas.reduce((s, v) => s + Number(v.total), 0));
    const porMetodo: Record<string, number> = {};
    for (const v of ventas) porMetodo[v.metodoPago] = round2((porMetodo[v.metodoPago] ?? 0) + Number(v.total));
    res.json({ ventas, resumen: { conteo: ventas.length, total, porMetodo } });
  }),
);
