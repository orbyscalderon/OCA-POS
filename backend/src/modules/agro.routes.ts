import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";
import { LINEAS_GENETICAS, getLineaGenetica, pesoEstandarEnEdad, hdpEstandarEnEdad } from "../config/curvasGeneticas.js";

export const agroRouter = Router();

const TIPOS_EVENTO_SANITARIO = ["vacuna", "vitamina", "tratamiento", "sintoma", "otro"] as const;

const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// ---------- Granjas y galpones (jerarquía opcional Empresa > Granja > Galpón > Lote) ----------
const granjaSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(120),
  direccion: z.string().max(200).optional(),
  notas: z.string().max(2000).optional(),
});

agroRouter.get("/granjas", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const granjas = await prisma.granja.findMany({
    where: { negocioId },
    include: { galpones: { orderBy: { nombre: "asc" }, include: { _count: { select: { lotes: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ granjas });
}));

agroRouter.post("/granjas", requireAuth, asyncHandler(async (req, res) => {
  const d = granjaSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const granja = await prisma.granja.create({ data: d });
  res.status(201).json({ granja });
}));

const granjaEditSchema = granjaSchema.omit({ negocioId: true }).partial();

agroRouter.patch("/granjas/:id", requireAuth, asyncHandler(async (req, res) => {
  const d = granjaEditSchema.parse(req.body);
  const granja0 = await prisma.granja.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!granja0) throw NotFound("Granja no encontrada");
  await requireAcceso(granja0.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const granja = await prisma.granja.update({ where: { id: req.params.id }, data: d });
  res.json({ granja });
}));

agroRouter.delete("/granjas/:id", requireAuth, asyncHandler(async (req, res) => {
  const granja0 = await prisma.granja.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!granja0) throw NotFound("Granja no encontrada");
  await requireAcceso(granja0.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  await prisma.granja.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

const galponSchema = z.object({
  nombre: z.string().min(1).max(120),
  capacidadAves: z.coerce.number().int().min(0).optional(),
  notas: z.string().max(2000).optional(),
});

agroRouter.post("/granjas/:id/galpones", requireAuth, asyncHandler(async (req, res) => {
  const d = galponSchema.parse(req.body);
  const granja = await prisma.granja.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!granja) throw NotFound("Granja no encontrada");
  await requireAcceso(granja.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const galpon = await prisma.galpon.create({ data: { ...d, granjaId: req.params.id } });
  res.status(201).json({ galpon });
}));

agroRouter.patch("/galpones/:id", requireAuth, asyncHandler(async (req, res) => {
  const d = galponSchema.partial().parse(req.body);
  const galpon0 = await prisma.galpon.findUnique({ where: { id: req.params.id }, select: { granja: { select: { negocioId: true } } } });
  if (!galpon0) throw NotFound("Galpón no encontrado");
  await requireAcceso(galpon0.granja.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const galpon = await prisma.galpon.update({ where: { id: req.params.id }, data: d });
  res.json({ galpon });
}));

agroRouter.delete("/galpones/:id", requireAuth, asyncHandler(async (req, res) => {
  const galpon0 = await prisma.galpon.findUnique({ where: { id: req.params.id }, select: { granja: { select: { negocioId: true } } } });
  if (!galpon0) throw NotFound("Galpón no encontrado");
  await requireAcceso(galpon0.granja.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  await prisma.galpon.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));

// Tipos de costo de un lote (coincide con el manifiesto de rubro granja_avicola).
export const TIPOS_COSTO = ["livestock", "feed", "medicine", "supplies", "labor", "utilities", "transport", "other"] as const;
const ETIQUETA_TIPO_COSTO: Record<(typeof TIPOS_COSTO)[number], string> = {
  livestock: "Pollitos BB", feed: "Alimento balanceado", medicine: "Vacunas y medicamentos",
  supplies: "Cama, gas, desinfectante", labor: "Mano de obra", utilities: "Electricidad y agua",
  transport: "Transporte", other: "Otro",
};

interface RegLite {
  mortalidad: number; alimentoKg: unknown; pesoPromedioG: unknown; produccion: number; fecha: Date;
  huevosJumbo: number; huevosExtra: number; huevosGrande: number; huevosMediano: number;
  huevosPequeno: number; huevosRotos: number; huevosSucios: number;
}
interface CostoLite { monto: unknown; tipoCosto: string | null }
interface VentaLite { subtotal: unknown }
interface EventoLite { fecha: Date; diasRetiro: number | null }

function metricas(lote: {
  cantidadInicial: number; fechaInicio: Date; tipoProduccion: string; costoInicial: unknown; lineaGenetica: string | null;
  registros: RegLite[]; gastos: CostoLite[]; productos: { lineasVenta: VentaLite[] }[]; eventosSanitarios: EventoLite[];
}) {
  const mortalidadTotal = lote.registros.reduce((s, r) => s + r.mortalidad, 0);
  const avesVivas = Math.max(0, lote.cantidadInicial - mortalidadTotal);
  const alimentoTotalKg = round2(lote.registros.reduce((s, r) => s + Number(r.alimentoKg), 0));
  const produccionTotal = lote.registros.reduce((s, r) => s + r.produccion, 0);
  const registrosPorFecha = [...lote.registros].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  // Aves vivas el día de cada registro (mortalidad acumulada hasta esa fecha) — se reutiliza
  // para HDP diario y para la alerta de caída de consumo.
  let mortAcumuladaSerie = 0;
  const avesVivasPorRegistro = registrosPorFecha.map((r) => {
    const avesDelDia = Math.max(0, lote.cantidadInicial - mortAcumuladaSerie);
    mortAcumuladaSerie += r.mortalidad;
    return avesDelDia;
  });
  const conPeso = [...lote.registros].filter((r) => r.pesoPromedioG != null).sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
  const ultimoPesoG = conPeso[0] ? Number(conPeso[0].pesoPromedioG) : null;
  const edadDias = Math.max(0, Math.floor((Date.now() - lote.fechaInicio.getTime()) / 86_400_000));
  const linea = getLineaGenetica(lote.lineaGenetica);

  // Conversión alimenticia (FCR) para carne: alimento / biomasa viva.
  let fcr: number | null = null;
  let biomasaKg: number | null = null;
  if (lote.tipoProduccion === "meat" && ultimoPesoG && avesVivas > 0) {
    biomasaKg = (avesVivas * ultimoPesoG) / 1000;
    if (biomasaKg > 0) fcr = round2(alimentoTotalKg / biomasaKg);
  }

  // GDP (ganancia diaria de peso): entre el primer y el último pesaje registrados — si solo
  // hay un pesaje, se usa el peso de la cría al nacer (~42g) como punto de partida.
  let gdp: number | null = null;
  if (lote.tipoProduccion === "meat" && conPeso.length > 0) {
    const primero = conPeso[conPeso.length - 1];
    const pesoInicial = conPeso.length > 1 ? Number(primero.pesoPromedioG) : 42;
    const fechaInicioPeso = conPeso.length > 1 ? primero.fecha : lote.fechaInicio;
    const dias = Math.max(1, Math.round((conPeso[0].fecha.getTime() - fechaInicioPeso.getTime()) / 86_400_000));
    gdp = round2((ultimoPesoG! - pesoInicial) / dias);
  }

  // IEE / EPEF (índice europeo de eficiencia): viabilidad × peso vivo(kg) / (edad × FCA) × 100.
  let iee: number | null = null;
  if (lote.tipoProduccion === "meat" && ultimoPesoG && fcr && fcr > 0 && edadDias > 0) {
    const viabilidadPct = lote.cantidadInicial > 0 ? (avesVivas / lote.cantidadInicial) * 100 : 0;
    iee = round2((viabilidadPct * (ultimoPesoG / 1000)) / (edadDias * fcr) * 100);
  }

  // Comparativa contra la curva estándar de la línea genética (si se definió una).
  const pesoEstandarG = lote.tipoProduccion === "meat" ? pesoEstandarEnEdad(linea, edadDias) : null;
  const desvioPesoPct = pesoEstandarG && ultimoPesoG ? round2(((ultimoPesoG - pesoEstandarG) / pesoEstandarG) * 100) : null;

  // HDP (Hen-Day) / HHH (Hen-Housed): % de postura real, promedio del periodo con registros.
  // HDP usa las aves vivas de CADA día (mortalidad acumulada hasta esa fecha); HHH usa
  // siempre las aves alojadas al inicio del lote.
  let hdpPromedio: number | null = null;
  let hhhPromedio: number | null = null;
  const huevosBuenos = { jumbo: 0, extra: 0, grande: 0, mediano: 0, pequeno: 0 };
  let huevosRotosTotal = 0, huevosSuciosTotal = 0;
  if (lote.tipoProduccion === "eggs") {
    let sumaAvesDia = 0;
    for (let i = 0; i < registrosPorFecha.length; i++) {
      const r = registrosPorFecha[i];
      sumaAvesDia += avesVivasPorRegistro[i];
      huevosBuenos.jumbo += r.huevosJumbo; huevosBuenos.extra += r.huevosExtra; huevosBuenos.grande += r.huevosGrande;
      huevosBuenos.mediano += r.huevosMediano; huevosBuenos.pequeno += r.huevosPequeno;
      huevosRotosTotal += r.huevosRotos; huevosSuciosTotal += r.huevosSucios;
    }
    if (sumaAvesDia > 0) hdpPromedio = round2((produccionTotal / sumaAvesDia) * 100);
    if (registrosPorFecha.length > 0 && lote.cantidadInicial > 0) {
      hhhPromedio = round2((produccionTotal / (lote.cantidadInicial * registrosPorFecha.length)) * 100);
    }
  }
  const hdpEstandar = lote.tipoProduccion === "eggs" ? hdpEstandarEnEdad(linea, edadDias) : null;

  // Alerta temprana: caída brusca del consumo de alimento por ave (día vs. promedio de los 3
  // días anteriores) — suele ser la primera señal de un brote sanitario o una falla de
  // ventilación/temperatura, antes de que suba la mortalidad.
  let alertaConsumo = false;
  if (registrosPorFecha.length >= 4) {
    const consumoPorAve = registrosPorFecha.map((r, i) => (avesVivasPorRegistro[i] > 0 ? Number(r.alimentoKg) / avesVivasPorRegistro[i] : null));
    const ultimo = consumoPorAve[consumoPorAve.length - 1];
    const anteriores = consumoPorAve.slice(-4, -1).filter((v): v is number => v != null);
    if (ultimo != null && anteriores.length === 3) {
      const promedioAnterior = anteriores.reduce((s, v) => s + v, 0) / anteriores.length;
      if (promedioAnterior > 0 && ultimo < promedioAnterior * 0.8) alertaConsumo = true;
    }
  }

  // Sanidad: si algún evento tiene periodo de retiro, hasta qué fecha el lote no debería venderse.
  let fechaLibreRetiro: string | null = null;
  for (const ev of lote.eventosSanitarios) {
    if (ev.diasRetiro == null) continue;
    const libre = new Date(ev.fecha.getTime() + ev.diasRetiro * 86_400_000);
    if (!fechaLibreRetiro || libre.toISOString() > fechaLibreRetiro) fechaLibreRetiro = libre.toISOString();
  }
  const enRetiro = fechaLibreRetiro != null && new Date(fechaLibreRetiro).getTime() > Date.now();

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
    gdp,
    iee,
    pesoEstandarG,
    desvioPesoPct,
    hdpPromedio,
    hhhPromedio,
    hdpEstandar,
    huevosBuenosTotal: huevosBuenos.jumbo + huevosBuenos.extra + huevosBuenos.grande + huevosBuenos.mediano + huevosBuenos.pequeno,
    huevosPorCalibre: huevosBuenos,
    huevosRotosTotal,
    huevosSuciosTotal,
    fechaLibreRetiro,
    enRetiro,
    alertaConsumo,
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

// Serie diaria real vs. curva estándar de la línea genética — solo se calcula en el detalle
// del lote (no en la lista) para no mandar un arreglo por día en cada carga de la pantalla
// principal. Vacío si el lote no tiene lineaGenetica asignada.
function calcularSerieComparativa(lote: {
  cantidadInicial: number; fechaInicio: Date; tipoProduccion: string; lineaGenetica: string | null; registros: RegLite[];
}): { edadDias: number; real: number | null; estandar: number | null }[] {
  const linea = getLineaGenetica(lote.lineaGenetica);
  if (!linea) return [];
  const registrosPorFecha = [...lote.registros].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
  const serie: { edadDias: number; real: number | null; estandar: number | null }[] = [];
  if (lote.tipoProduccion === "meat") {
    for (const r of registrosPorFecha) {
      if (r.pesoPromedioG == null) continue;
      const edadDias = Math.max(0, Math.floor((r.fecha.getTime() - lote.fechaInicio.getTime()) / 86_400_000));
      serie.push({ edadDias, real: Number(r.pesoPromedioG), estandar: pesoEstandarEnEdad(linea, edadDias) });
    }
  } else {
    let mortAcumulada = 0;
    for (const r of registrosPorFecha) {
      const avesDelDia = Math.max(0, lote.cantidadInicial - mortAcumulada);
      mortAcumulada += r.mortalidad;
      const edadDias = Math.max(0, Math.floor((r.fecha.getTime() - lote.fechaInicio.getTime()) / 86_400_000));
      const hdpDia = avesDelDia > 0 ? round2((r.produccion / avesDelDia) * 100) : null;
      serie.push({ edadDias, real: hdpDia, estandar: hdpEstandarEnEdad(linea, edadDias) });
    }
  }
  return serie;
}

const loteSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(120),
  especie: z.enum(["broiler", "layer"]).default("broiler"),
  tipoProduccion: z.enum(["meat", "eggs"]).default("meat"),
  cantidadInicial: z.coerce.number().int().positive(),
  fechaInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  costoInicial: z.coerce.number().min(0).optional(),
  lineaGenetica: z.string().max(30).nullable().optional(),
  galponId: z.string().min(1).nullable().optional(),
  notas: z.string().max(500).optional(),
});

const INCLUDE_LOTE = {
  registros: {
    select: {
      mortalidad: true, alimentoKg: true, pesoPromedioG: true, produccion: true, fecha: true,
      huevosJumbo: true, huevosExtra: true, huevosGrande: true, huevosMediano: true,
      huevosPequeno: true, huevosRotos: true, huevosSucios: true,
    },
  },
  gastos: { select: { monto: true, tipoCosto: true } },
  productos: { select: { lineasVenta: { select: { subtotal: true } } } },
  eventosSanitarios: { select: { fecha: true, diasRetiro: true } },
  galpon: { select: { id: true, nombre: true, granja: { select: { id: true, nombre: true } } } },
} as const;

agroRouter.get("/lineas-geneticas", requireAuth, asyncHandler(async (req, res) => {
  const especie = z.enum(["broiler", "layer"]).optional().parse(req.query.especie);
  const lineas = LINEAS_GENETICAS.filter((l) => !especie || l.especie === especie)
    .map((l) => ({ slug: l.slug, nombre: l.nombre, especie: l.especie }));
  res.json({ lineas });
}));

async function assertGalponValido(negocioId: string, galponId: string) {
  const galpon = await prisma.galpon.findUnique({ where: { id: galponId }, select: { granja: { select: { negocioId: true } } } });
  if (!galpon || galpon.granja.negocioId !== negocioId) throw BadRequest("El galpón no pertenece a este negocio", "GALPON_INVALIDO");
}

agroRouter.get("/lotes", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const lotes = await prisma.loteBiologico.findMany({
    where: { negocioId },
    include: INCLUDE_LOTE,
    orderBy: { createdAt: "desc" },
  });
  res.json({
    lotes: lotes.map((l) => ({
      id: l.id, nombre: l.nombre, especie: l.especie, tipoProduccion: l.tipoProduccion,
      cantidadInicial: l.cantidadInicial, fechaInicio: l.fechaInicio, estado: l.estado,
      lineaGenetica: l.lineaGenetica, galpon: l.galpon, ...metricas(l),
    })),
  });
}));

agroRouter.post("/lotes", requireAuth, asyncHandler(async (req, res) => {
  const d = loteSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  if (d.galponId) await assertGalponValido(d.negocioId, d.galponId);
  const lote = await prisma.loteBiologico.create({
    data: {
      negocioId: d.negocioId, nombre: d.nombre, especie: d.especie, tipoProduccion: d.tipoProduccion,
      cantidadInicial: d.cantidadInicial, fechaInicio: new Date(`${d.fechaInicio}T00:00:00`),
      costoInicial: d.costoInicial ?? null, lineaGenetica: d.lineaGenetica ?? null,
      galponId: d.galponId ?? null, notas: d.notas ?? null,
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
      eventosSanitarios: { orderBy: { fecha: "desc" } },
      galpon: { select: { id: true, nombre: true, granja: { select: { id: true, nombre: true } } } },
    },
  });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  res.json({
    lote,
    // El detalle mezcla los mismos campos de identidad que la lista (nombre/especie/
    // tipoProduccion/...) junto con las métricas calculadas — el frontend usa
    // metricas.tipoProduccion para decidir qué campos mostrar (peso vs. huevos), así que
    // tiene que llegar acá igual que en GET /lotes, no solo en la lista.
    metricas: {
      id: lote.id, nombre: lote.nombre, especie: lote.especie, tipoProduccion: lote.tipoProduccion,
      cantidadInicial: lote.cantidadInicial, fechaInicio: lote.fechaInicio, estado: lote.estado,
      lineaGenetica: lote.lineaGenetica, galpon: lote.galpon, ...metricas(lote),
    },
    serieComparativa: calcularSerieComparativa(lote),
    tiposCosto: TIPOS_COSTO.map((v) => ({ value: v, label: ETIQUETA_TIPO_COSTO[v] })),
    tiposEvento: TIPOS_EVENTO_SANITARIO,
  });
}));

// Solo nombre/línea genética/galpón/notas son editables después de creado — cantidad inicial
// y fecha de inicio quedan fijas porque todos los indicadores ya calculados dependen de ellas.
const loteEditSchema = z.object({
  nombre: z.string().min(1).max(120).optional(),
  lineaGenetica: z.string().max(30).nullable().optional(),
  galponId: z.string().min(1).nullable().optional(),
  notas: z.string().max(500).nullable().optional(),
});

agroRouter.patch("/lotes/:id", requireAuth, asyncHandler(async (req, res) => {
  const d = loteEditSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  if (d.galponId) await assertGalponValido(lote.negocioId, d.galponId);
  const actualizado = await prisma.loteBiologico.update({ where: { id: req.params.id }, data: d });
  res.json({ lote: actualizado });
}));

const registroSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mortalidad: z.coerce.number().int().min(0).default(0),
  alimentoKg: z.coerce.number().min(0).default(0),
  pesoPromedioG: z.coerce.number().min(0).optional(),
  produccion: z.coerce.number().int().min(0).default(0),
  huevosJumbo: z.coerce.number().int().min(0).default(0),
  huevosExtra: z.coerce.number().int().min(0).default(0),
  huevosGrande: z.coerce.number().int().min(0).default(0),
  huevosMediano: z.coerce.number().int().min(0).default(0),
  huevosPequeno: z.coerce.number().int().min(0).default(0),
  huevosRotos: z.coerce.number().int().min(0).default(0),
  huevosSucios: z.coerce.number().int().min(0).default(0),
  notas: z.string().max(200).optional(),
});

// Registro diario (idempotente por fecha: si ya existe, lo actualiza).
agroRouter.post("/lotes/:id/registros", requireAuth, asyncHandler(async (req, res) => {
  const d = registroSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const fecha = new Date(`${d.fecha}T00:00:00`);
  // Si se cargó el desglose por calibre, la "producción" total es la suma de huevos buenos
  // (rotos/sucios no cuentan como producción vendible) — si no se usa el desglose, se respeta
  // el número de producción que se haya escrito a mano, como siempre.
  const huevosBuenos = d.huevosJumbo + d.huevosExtra + d.huevosGrande + d.huevosMediano + d.huevosPequeno;
  const produccion = huevosBuenos > 0 ? huevosBuenos : d.produccion;
  const campos = {
    mortalidad: d.mortalidad, alimentoKg: d.alimentoKg, pesoPromedioG: d.pesoPromedioG ?? null, produccion,
    huevosJumbo: d.huevosJumbo, huevosExtra: d.huevosExtra, huevosGrande: d.huevosGrande,
    huevosMediano: d.huevosMediano, huevosPequeno: d.huevosPequeno, huevosRotos: d.huevosRotos, huevosSucios: d.huevosSucios,
    notas: d.notas ?? null,
  };
  const registro = await prisma.registroAgro.upsert({
    where: { loteId_fecha: { loteId: req.params.id, fecha } },
    create: { loteId: req.params.id, fecha, ...campos },
    update: campos,
  });
  res.status(201).json({ registro });
}));

// ---------- Sanidad: vacunas, tratamientos y síntomas del lote ----------
const eventoSanitarioSchema = z.object({
  tipo: z.enum(TIPOS_EVENTO_SANITARIO),
  nombre: z.string().min(1).max(120),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  diasRetiro: z.coerce.number().int().min(0).max(365).optional(),
  notas: z.string().max(300).optional(),
});

agroRouter.post("/lotes/:id/eventos", requireAuth, asyncHandler(async (req, res) => {
  const d = eventoSanitarioSchema.parse(req.body);
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const evento = await prisma.eventoSanitario.create({
    data: {
      loteId: req.params.id, tipo: d.tipo, nombre: d.nombre,
      fecha: new Date(`${d.fecha}T00:00:00`), diasRetiro: d.diasRetiro ?? null, notas: d.notas ?? null,
    },
  });
  res.status(201).json({ evento });
}));

agroRouter.delete("/lotes/:id/eventos/:eventoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  await prisma.eventoSanitario.deleteMany({ where: { id: req.params.eventoId, loteId: req.params.id } });
  res.json({ ok: true });
}));

agroRouter.post("/lotes/:id/cerrar", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
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
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
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
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  await prisma.gasto.deleteMany({ where: { id: req.params.costoId, loteId: req.params.id } });
  res.json({ ok: true });
}));

// ---------- Vincular/desvincular productos del lote (para atribuir ingreso de venta) ----------
agroRouter.post("/lotes/:id/productos/:productoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const producto = await prisma.producto.findUnique({ where: { id: req.params.productoId }, select: { negocioId: true } });
  if (!producto || producto.negocioId !== lote.negocioId) throw NotFound("Producto no encontrado");
  await prisma.producto.update({ where: { id: req.params.productoId }, data: { loteId: req.params.id } });
  res.json({ ok: true });
}));

agroRouter.delete("/lotes/:id/productos/:productoId", requireAuth, asyncHandler(async (req, res) => {
  const lote = await prisma.loteBiologico.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!lote) throw NotFound("Lote no encontrado");
  await requireAcceso(lote.negocioId, req.user!.sub, req.user!.rol, "agro.gestionar");
  const producto = await prisma.producto.findUnique({ where: { id: req.params.productoId }, select: { negocioId: true, loteId: true } });
  if (!producto || producto.negocioId !== lote.negocioId) throw NotFound("Producto no encontrado");
  if (producto.loteId !== req.params.id) throw BadRequest("Ese producto no está vinculado a este lote");
  await prisma.producto.update({ where: { id: req.params.productoId }, data: { loteId: null } });
  res.json({ ok: true });
}));
