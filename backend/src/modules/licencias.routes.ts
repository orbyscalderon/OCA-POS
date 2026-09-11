import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { firmarCertificado, generarClaveLicencia } from "../lib/licencia.js";
import { PLAN_VITALICIO } from "./suscripcion.routes.js";

export const licenciasRouter = Router();

// ---------- Activación / re-validación desde la app de escritorio (pública) ----------
// Un mismo endpoint sirve para la primera activación y para las re-validaciones periódicas:
// si la licencia ya está atada a otra instalación, se rechaza; si es la misma o todavía no
// tiene dueño, se firma y devuelve el certificado (con la fecha de vencimiento al día).
const activarSchema = z.object({
  clave: z.string().min(1),
  huellaMaquina: z.string().min(1),
});

licenciasRouter.post(
  "/activar",
  asyncHandler(async (req, res) => {
    const { clave, huellaMaquina } = activarSchema.parse(req.body);

    const licencia = await prisma.licencia.findUnique({ where: { clave } });
    if (!licencia) throw NotFound("Clave de licencia no encontrada");
    if (licencia.revocada) throw Forbidden("Esta licencia fue revocada");

    if (licencia.huellaMaquina && licencia.huellaMaquina !== huellaMaquina) {
      throw Forbidden("Esta licencia ya está activada en otra instalación");
    }
    if (licencia.vencimiento && licencia.vencimiento < new Date()) {
      throw Forbidden("Esta licencia venció");
    }

    if (!licencia.huellaMaquina) {
      await prisma.licencia.update({
        where: { id: licencia.id },
        data: { huellaMaquina, activadaEn: new Date() },
      });
    }

    const certificado = firmarCertificado({
      clave: licencia.clave,
      plan: licencia.plan,
      vencimiento: licencia.vencimiento ? licencia.vencimiento.toISOString() : null,
      funcionesExtra: licencia.funcionesExtra,
      huellaMaquina,
      emitidoEn: new Date().toISOString(),
    });

    res.json(certificado);
  }),
);

// ---------- Emisión y administración de licencias (superadmin) ----------
licenciasRouter.use("/admin", requireAuth, requireRole("superadmin"));

const crearSchema = z.object({
  plan: z.enum(["basico", "pro", "vitalicio"]).default("vitalicio"),
  vigenciaDias: z.number().int().positive().optional(), // vacío + plan vitalicio = sin vencimiento
  negocioId: z.string().optional(),
});

licenciasRouter.post(
  "/admin",
  asyncHandler(async (req, res) => {
    const body = crearSchema.parse(req.body);
    if (body.plan !== "vitalicio" && !body.vigenciaDias) {
      throw BadRequest("Los planes por suscripción necesitan vigenciaDias");
    }
    const vencimiento = body.vigenciaDias
      ? new Date(Date.now() + body.vigenciaDias * 24 * 60 * 60 * 1000)
      : null;

    const licencia = await prisma.licencia.create({
      data: { clave: generarClaveLicencia(), plan: body.plan, vencimiento, negocioId: body.negocioId },
    });
    res.status(201).json({ licencia });
  }),
);

licenciasRouter.get(
  "/admin",
  asyncHandler(async (_req, res) => {
    const licencias = await prisma.licencia.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
    res.json({ licencias });
  }),
);

// Agrega una función extra (add-on pago aparte) a UNA licencia puntual — no se habilita para
// nadie más, solo para quien compró esa función en esa instalación.
const addonSchema = z.object({ funcion: z.string().min(1) });
licenciasRouter.post(
  "/admin/:id/funciones",
  asyncHandler(async (req, res) => {
    const { funcion } = addonSchema.parse(req.body);
    const licencia = await prisma.licencia.findUnique({ where: { id: req.params.id } });
    if (!licencia) throw NotFound("Licencia no encontrada");
    if (licencia.funcionesExtra.includes(funcion)) {
      res.json({ licencia });
      return;
    }
    const actualizada = await prisma.licencia.update({
      where: { id: licencia.id },
      data: { funcionesExtra: { push: funcion } },
    });
    res.json({ licencia: actualizada });
  }),
);

licenciasRouter.patch(
  "/admin/:id/revocar",
  asyncHandler(async (req, res) => {
    const licencia = await prisma.licencia.update({
      where: { id: req.params.id },
      data: { revocada: true },
    }).catch(() => null);
    if (!licencia) throw NotFound("Licencia no encontrada");
    res.json({ licencia });
  }),
);

// Referencia de precio para que el panel de superadmin muestre el precio del vitalicio al emitir.
licenciasRouter.get(
  "/admin/precio-vitalicio",
  asyncHandler(async (_req, res) => {
    res.json(PLAN_VITALICIO);
  }),
);
