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
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "ventas.caja");
    const sesion = await prisma.sesionCaja.findFirst({ where: { negocioId, estado: "abierta" }, orderBy: { abiertaEn: "desc" } });
    res.json({ sesion });
  }),
);

posRouter.post(
  "/caja/abrir",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { negocioId, montoInicial } = z.object({ negocioId: z.string().min(1), montoInicial: z.coerce.number().min(0) }).parse(req.body);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "ventas.caja");
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
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "ventas.caja");
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
// "apartado" (layaway — Moda y cualquier retail con crédito): el cliente separa el producto
// y lo termina de pagar después. Técnicamente se registra igual que "fiado" (el producto se
// descuenta del stock de una vez, el saldo va a la cuenta del cliente) — la diferencia es de
// significado para el dueño (reportar aparte cuánto es fiado real vs apartados), no de lógica.
const ventaSchema = z.object({
  negocioId: z.string().min(1),
  metodoPago: z.enum(["efectivo", "tarjeta", "transferencia", "fiado", "apartado", "otro"]).default("efectivo"),
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
    await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "ventas.vender");
    if ((d.metodoPago === "fiado" || d.metodoPago === "apartado") && !d.clienteId) {
      throw BadRequest("Esta venta requiere elegir un cliente", "SIN_CLIENTE");
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

    const [sesion, negocioInfo] = await Promise.all([
      prisma.sesionCaja.findFirst({ where: { negocioId: d.negocioId, estado: "abierta" }, select: { id: true } }),
      prisma.negocio.findUnique({ where: { id: d.negocioId }, select: { puntosPorVenta: true } }),
    ]);

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
        const prod = mapProd.get(l.productoId)!;
        if (prod.productoFuenteId && prod.rendimientoPorVenta) {
          // Este producto (p. ej. "Recarga") no lleva stock propio: es un servicio que
          // consume stock de OTRO producto (el pote de líquido). Se descuenta ahí, con el
          // rendimiento configurado (ej. 3 ml por recarga vendida), para que el cálculo de
          // lo que queda en el pote sea correcto.
          const consumo = l.cantidad * Number(prod.rendimientoPorVenta);
          await tx.producto.update({ where: { id: prod.productoFuenteId }, data: { stock: { decrement: consumo } } });
          await tx.movimientoStock.create({
            data: { productoId: prod.productoFuenteId, tipo: "venta", cantidad: -Math.abs(consumo), motivo: `Venta ${v.id.slice(-6)} (${prod.nombre})` },
          });
        } else {
          await tx.producto.update({ where: { id: l.productoId }, data: { stock: { decrement: l.cantidad } } });
          await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "venta", cantidad: -Math.abs(l.cantidad), motivo: `Venta ${v.id.slice(-6)}` } });
        }
      }
      // Fiado/apartado (suma al saldo) y fidelización (suma puntos) del cliente, si hay uno
      // asociado — en un solo update si aplican los dos, para no pisarse entre sí.
      if (cliente) {
        const cambios: { saldoFiado?: { increment: number }; puntos?: { increment: number } } = {};
        if (d.metodoPago === "fiado" || d.metodoPago === "apartado") cambios.saldoFiado = { increment: total };
        if (negocioInfo?.puntosPorVenta) cambios.puntos = { increment: negocioInfo.puntosPorVenta };
        if (Object.keys(cambios).length > 0) {
          await tx.clienteNegocio.update({ where: { id: cliente.id }, data: cambios });
        }
      }
      return v;
    });
    res.status(201).json({ venta });
  }),
);

// Ventas del día (o de una fecha) con totales. Las anuladas se listan (con su marca) pero no
// cuentan en el resumen — ya no representan dinero real cobrado.
posRouter.get(
  "/ventas",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, ["ventas.vender", "ventas.caja"]);
    const { desde, hasta } = rangoDia(typeof req.query.fecha === "string" ? req.query.fecha : undefined);
    const ventas = await prisma.venta.findMany({
      where: { negocioId, createdAt: { gte: desde, lt: hasta } },
      include: { lineas: true },
      orderBy: { createdAt: "desc" },
    });
    const validas = ventas.filter((v) => !v.anulada);
    const total = round2(validas.reduce((s, v) => s + Number(v.total), 0));
    const porMetodo: Record<string, number> = {};
    for (const v of validas) porMetodo[v.metodoPago] = round2((porMetodo[v.metodoPago] ?? 0) + Number(v.total));
    res.json({ ventas, resumen: { conteo: validas.length, total, porMetodo } });
  }),
);

// Anular una venta: revierte el stock (y el de recargas, en el producto fuente), el saldo
// fiado/apartado y los puntos de fidelidad si el cliente los había recibido por esta venta.
// No se borra el registro — queda marcado como anulado para el historial y las auditorías.
// Requiere el permiso "ventas.anular" a propósito, separado de "ventas.vender": el dueño
// decide a quién le da esta función aparte — no todo el que puede cobrar puede anular.
const anularSchema = z.object({ motivo: z.string().max(200).optional() });
posRouter.post(
  "/ventas/:id/anular",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { motivo } = anularSchema.parse(req.body);
    const venta = await prisma.venta.findUnique({ where: { id: req.params.id }, include: { lineas: true } });
    if (!venta) throw NotFound("Venta no encontrada");
    await requireAcceso(venta.negocioId, req.user!.sub, req.user!.rol, "ventas.anular");
    if (venta.anulada) throw Conflict("Esta venta ya estaba anulada", "YA_ANULADA");

    const idsProductos = venta.lineas.map((l) => l.productoId).filter(Boolean) as string[];
    const productos = idsProductos.length
      ? await prisma.producto.findMany({ where: { id: { in: idsProductos } } })
      : [];
    const mapProd = new Map(productos.map((p) => [p.id, p]));

    const negocio = await prisma.negocio.findUnique({ where: { id: venta.negocioId }, select: { puntosPorVenta: true } });

    await prisma.$transaction(async (tx) => {
      for (const l of venta.lineas) {
        if (!l.productoId || !mapProd.has(l.productoId)) continue;
        const prod = mapProd.get(l.productoId)!;
        if (prod.productoFuenteId && prod.rendimientoPorVenta) {
          const consumo = Number(l.cantidad) * Number(prod.rendimientoPorVenta);
          await tx.producto.update({ where: { id: prod.productoFuenteId }, data: { stock: { increment: consumo } } });
          await tx.movimientoStock.create({
            data: { productoId: prod.productoFuenteId, tipo: "anulacion", cantidad: Math.abs(consumo), motivo: `Anulación venta ${venta.id.slice(-6)} (${prod.nombre})` },
          });
        } else {
          await tx.producto.update({ where: { id: l.productoId }, data: { stock: { increment: l.cantidad } } });
          await tx.movimientoStock.create({ data: { productoId: l.productoId, tipo: "anulacion", cantidad: Math.abs(Number(l.cantidad)), motivo: `Anulación venta ${venta.id.slice(-6)}` } });
        }
      }
      if (venta.clienteId) {
        const cliente = await tx.clienteNegocio.findUnique({ where: { id: venta.clienteId }, select: { saldoFiado: true, puntos: true } });
        if (cliente) {
          const data: { saldoFiado?: number; puntos?: number } = {};
          if (venta.metodoPago === "fiado" || venta.metodoPago === "apartado") {
            data.saldoFiado = Math.max(0, round2(Number(cliente.saldoFiado) - Number(venta.total)));
          }
          if (negocio?.puntosPorVenta) {
            data.puntos = Math.max(0, cliente.puntos - negocio.puntosPorVenta);
          }
          if (Object.keys(data).length > 0) await tx.clienteNegocio.update({ where: { id: venta.clienteId }, data });
        }
      }
      await tx.venta.update({ where: { id: venta.id }, data: { anulada: true, anuladaEn: new Date(), motivoAnulacion: motivo ?? null } });
    });

    res.json({ ok: true });
  }),
);
