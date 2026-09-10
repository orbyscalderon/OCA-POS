import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const agroRouter = Router();

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Tipos de costo de un lote (coincide con el manifiesto de rubro granja_avicola).
export const TIPOS_COSTO = ["livestock", "feed", "medicine", "supplies", "labor", "utilities", "transport", "other"] as const;
const ETIQUETA_TIPO_COSTO: Record<(typeof TIPOS_COSTO)[number], string> = {
  livestock: "Pollitos BB", feed: "Alimento balanceado", medicine: "Vacunas y medicamentos",
  supplies: "Cama, gas, desinfectante", labor: "Mano de obra", utilities: "Electricidad y agua",
  transport: "Transporte", other: "Otro",
};

interface RegLite { mortalidad: number; alimentoKg: unknown; pesoPromedioG: unknown; produccion: number; fecha: Date }
interface CostoLite { monto: unknown; tipoCosto: string | null }
interface VentaLite { subtotal: unknown }

function metricas(lote: {
  cantidadInicial: number; fechaInicio: Date; tipoProduccion: string; costoInicial: unknown;
  registros: RegLite[]; gastos: CostoLite[]; productos: { lineasVenta: VentaLite[] }[];
}) {
  const mortalidadTotal = lote.registros.reduce((s, r) => s + r.mortalidad, 0);
  const avesVivas = Math.max(0, lote.cantidadInicial - mortalidadTotal);
  const alimentoTotalKg = round2(lote.registros.reduce((s, r) => s + Number(r.alimentoKg), 0));
  const produccionTotal = lote.registros.reduce((s, r) => s + r.produccion, 0);
  const conPeso = lote.registros.filter((r) => r.pesoPromedioG != null).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const ultimoPesoG = conPeso[0] ? Number(conPeso[0].pesoPromedioG) : null;
  const edadDias = Math.max(0, Math.floor((Date.now() - lote.fechaInicio.getTime()) / 86_400_000));
  // Conversión alimenticia (FCR) para carne: alimento / biomasa viva.
  let fcr: number | null = null;
  let biomasaKg: number | null = null;
  if (lote.tipoProduccion === "meat" && ultimoPesoG && avesVivas > 0) {
    biomasaKg = (avesVivas * ultimoPesoG) / 1000;
    if (biomasaKg > 0) fcr = round2(alimentoTotalKg / biomasaKg);
  }

  // ---- Costeo real: costo inicial del lote + todos los gastos atribuidos a él ----
  const costoPorTipo: Record<string, number> = {};
  let costoGastos = 0;
  for (const g of lote.gastos) {
    const monto = Number(g.monto);
    costoGastos = round2(costoGastos + monto);
    const tipo = g.tipoCosto ?? "other";
    costoPorTipo[tipo] = round2((costoPorTipo[tipo] ?? 0) + monto);
  }
  const costoInicial = Number(lote.costoInicial ?? 0);
  const costoTotal = round2(costoInicial + costoGastos);
  const costoPorAve = lote.cantidadInicial > 0 ? round2(costoTotal / lote.cantidadInicial) : 0;
  const costoPorKg = biomasaKg && biomasaKg > 0 ? round2(costoTotal / biomasaKg) : null;

  // ---- Ingreso real: ventas de los productos vinculados a este lote ----
  const ingresoTotal = round2(
    lote.productos.reduce((s, p) => s + p.lineasVenta.reduce((s2, l) => s2 + Number(l.subtotal), 0), 0),
  );
  const margen = round2(ingresoTotal - costoTotal);
  const margenPct = ingresoTotal > 0 ? round2((margen / ingresoTotal) * 100) : null;

  return {
    mortalidadTotal,
    avesVivas,
    mortalidadPct: lote.cantidadInicial > 0 ? round2((mortalidadTotal / lote.cantidadInicial) * 100) : 0,
    alimentoTotalKg,
    produccionTotal,
    ultimoPesoG,
    edadDias,
    fcr,
    costoInicial,
    costoGastos,
    costoTotal,
    costoPorTipo,
    costoPorAve,
    costoPorKg,
    ingresoTotal,
    margen,
    margenPct,
  };
}

const loteSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(120),
  especie: z.enum(["broiler", "layer"]).default("broiler"),
  tipoProduccion: z.enum(["meat", "eggs"]).default("meat"),
  cantidadInicial: z.coerce.number().int().positive(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costoInicial: z.coerce.number().min(0).optional(),
  notas: z.string().max(500).optional(),
});

const INCLUDE_LOTE = {
  registros: { select: { mortalidad: true, alimentoKg: true, pesoPromedioG: true, produccion: true, fecha: true } },
  gastos: { select: { monto: true, tipoCosto: true } },
  productos: { select: { lineasVenta: { select: { subtotal: true } } } },
} as const;

agroRouter.get("/lotes", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "agro");
  const lotes = await prisma.loteBiologico.findMany({
    where: { negocioId },
    include: INCLUDE_LOTE,
    orderBy: { createdAt: "desc" },
  });
  res.json({
    lotes: lotes.map((l) => ({
      id: l.id, nombre: l.nombre, especie: l.especie, tipoProduccion: l.tipoProduccion,
      cantidadInicial: l.cantidadInicial, fechaInicio: l.fechaInicio, estado: l.estado, ...metricas(l),
    })),
  });
}));

agroRouter.post("/lotes", requireAuth, asyncHandler(async (req, res) => {
  const d = loteSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "agro");
  const lote = await prisma.loteBiologico.create({
    data: {
      negocioId: d.negocioId, nombre: d.nombre, especie: d.especie, tipoProduccion: d.tipoProduccion,
      cantidadInicial: d.cantidadInicial, fechaInicio: new Date(`${d.fechaInicio}T00:00:00`),
      costoInicial: d.costoInicial ?? null, notas: d.notas ?? null,
    },
  });
  // El costo inicial (pollitos BB) también queda como primer costo del lote, para que
  // aparezca desglosado junto al resto en vez de ser un número aparte.
  if (d.costoInicial) {
    await prisma.gasto.create({
      data: {
        negocioId: d.negocioId, loteId: lote.id, tipoCosto: "livestock",
        categoria: ETIQUETA_TIPO_COSTO.livestock, descripcion: `Pollitos BB — ${lote.nombre}`,
        monto: d.costoInicial, fecha: new Date(`${d.fechaInicio}T00:00:00`),
      },
    });
  }
  res.status(201).json({ lote });
}));

agroRouter.get("/lotes/:id", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({
    where: { id: req.params.id },
    include: {
      registros: { orderBy: { fecha: "desc" } },
      gastos: { orderBy: { fecha: "desc" } },
      productos: { select: { id: true, nombre: true, precioVenta: true, stock: true, lineasVenta: { select: { subtotal: true } } } },
    },
  });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  res.json({ lote, metricas: metricas(lote), tiposCosto: TIPOS_COSTO.map((v) => ({ value: v, label: ETIQUETA_TIPO_COSTO[v] })) });
}));

const registroSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mortalidad: z.coerce.number().int().min(0).default(0),
  alimentoKg: z.coerce.number().min(0).default(0),
  pesoPromedioG: z.coerce.number().min(0).optional(),
  produccion: z.coerce.number().int().min(0).default(0),
  notas: z.string().max(200).optional(),
});

// Registro diario (idempotente por fecha: si ya existe, lo actualiza).
agroRouter.post("/lotes/:id/registros", requireAuth, asyncHandler(async (req, res) => {
  const d = registroSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  const fecha = new Date(`${d.fecha}T00:00:00`);
  const registro = await prisma.registroAgro.upsert({
    where: { loteId_fecha: { loteId: req.params.id, fecha } },
    create: { loteId: req.params.id, fecha, mortalidad: d.mortalidad, alimentoKg: d.alimentoKg, pesoPromedioG: d.pesoPromedioG ?? null, produccion: d.produccion, notas: d.notas ?? null },
    update: { mortalidad: d.mortalidad, alimentoKg: d.alimentoKg, pesoPromedioG: d.pesoPromedioG ?? null, produccion: d.produccion, notas: d.notas ?? null },
  });
  res.status(201).json({ registro });
}));

agroRouter.post("/lotes/:id/cerrar", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  const actualizado = await prisma.loteBiologico.update({ where: { id: req.params.id }, data: { estado: "cerrado" } });
  res.json({ lote: actualizado });
}));

// ---------- COSTOS del lote (alimento, sanidad, mano de obra…) ----------
const costoSchema = z.object({
  tipoCosto: z.enum(TIPOS_COSTO),
  monto: z.coerce.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  descripcion: z.string().max(200).optional(),
});

agroRouter.post("/lotes/:id/costos", requireAuth, asyncHandler(async (req, res) => {
  const d = costoSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true, nombre: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  const gasto = await prisma.gasto.create({
    data: {
      negocioId: lote.negocioId, loteId: req.params.id, tipoCosto: d.tipoCosto,
      categoria: ETIQUETA_TIPO_COSTO[d.tipoCosto],
      descripcion: d.descripcion?.trim() || `${ETIQUETA_TIPO_COSTO[d.tipoCosto]} — ${lote.nombre}`,
      monto: d.monto, fecha: new Date(`${d.fecha}T00:00:00`),
    },
  });
  res.status(201).json({ costo: gasto });
}));

agroRouter.delete("/lotes/:id/costos/:costoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  await prisma.gasto.deleteMany({ where: { id: req.params.costoId, loteId: req.params.id } });
  res.json({ ok: true });
}));

// ---------- Vincular/desvincular productos del lote (para atribuir ingreso de venta) ----------
agroRouter.post("/lotes/:id/productos/:productoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  const producto = await prisma.producto.findUnique({ where: { id: req.params.productoId }, select: { negocioId: true } });
  if (!producto || producto.negocioId !== lote.negocioId) throw NotFound("Producto no encontrado");
  await prisma.producto.update({ where: { id: req.params.productoId }, data: { loteId: req.params.id } });
  res.json({ ok: true });
}));

agroRouter.delete("/lotes/:id/productos/:productoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro");
  const producto = await prisma.producto.findUnique({ where: { id: req.params.productoId }, select: { negocioId: true, loteId: true } });
  if (!producto || producto.negocioId !== lote.negocioId) throw NotFound("Producto no encontrado");
  if (producto.loteId !== req.params.id) throw BadRequest("Ese producto no está vinculado a este lote");
  await prisma.producto.update({ where: { id: req.params.productoId }, data: { loteId: null } });
  res.json({ ok: true });
}));
