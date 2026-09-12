import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const expensesRouter = Router();
const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

// Lista los gastos de un mes (YYYY-MM) con total.
expensesRouter.get("/", requireAuth, asyncHandler(async (req, res) => {
  const negocioId = z.string().min(1).parse(req.query.negocioId);
  await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "gastos.ver");
  const mes = typeof req.query.mes === "string" && /^\d{4}-\d{2}$/.test(req.query.mes) ? req.query.mes : new Date().toISOString().slice(0, 7);
  const desde = new Date(`${mes}-01T00:00:00`);
  const hasta = new Date(desde); hasta.setMonth(hasta.getMonth() + 1);
  const gastos = await prisma.gasto.findMany({
    where: { negocioId, fecha: { gte: desde, lt: hasta } },
    orderBy: { fecha: "desc" },
    include: { granja: { select: { nombre: true } }, galpon: { select: { nombre: true } } },
  });
  const total = round2(gastos.reduce((s, g) => s + Number(g.monto), 0));
  res.json({ gastos, total, mes });
}));

const gastoSchema = z.object({
  negocioId: z.string().min(1),
  categoria: z.string().max(60).optional(),
  descripcion: z.string().min(1).max(200),
  monto: z.coerce.number().positive(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // Agro: atribuir el gasto a una granja o un galpón (luz, mantenimiento…) en vez de dejarlo
  // como gasto general del negocio — opcional, solo aplica si el negocio usa esa jerarquía.
  granjaId: z.string().min(1).optional(),
  galponId: z.string().min(1).optional(),
});
expensesRouter.post("/", requireAuth, asyncHandler(async (req, res) => {
  const d = gastoSchema.parse(req.body);
  await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "gastos.crear");
  if (d.granjaId) {
    const granja = await prisma.granja.findUnique({ where: { id: d.granjaId }, select: { negocioId: true } });
    if (!granja || granja.negocioId !== d.negocioId) throw NotFound("Granja no encontrada");
  }
  if (d.galponId) {
    const galpon = await prisma.galpon.findUnique({ where: { id: d.galponId }, select: { granja: { select: { negocioId: true } } } });
    if (!galpon || galpon.granja.negocioId !== d.negocioId) throw NotFound("Galpón no encontrado");
  }
  const gasto = await prisma.gasto.create({
    data: {
      negocioId: d.negocioId, categoria: d.categoria ?? null, descripcion: d.descripcion, monto: d.monto,
      fecha: new Date(`${d.fecha}T00:00:00`), granjaId: d.granjaId ?? null, galponId: d.galponId ?? null,
    },
  });
  res.status(201).json({ gasto });
}));

expensesRouter.delete("/:id", requireAuth, asyncHandler(async (req, res) => {
  const g = await prisma.gasto.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
  if (!g) throw NotFound("Gasto no encontrado");
  await requireAcceso(g.negocioId, req.user!.sub, req.user!.rol, "gastos.eliminar");
  await prisma.gasto.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
}));
