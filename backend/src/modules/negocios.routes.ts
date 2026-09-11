import { Router } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { paginationSchema, paginar, metaPaginacion } from "../lib/pagination.js";
import { calcularSplitFianza } from "../lib/split.js";
import { limitePeluqueros, limiteNegocios } from "../lib/planes.js";
import { SLUGS_PERFIL } from "../config/perfiles.js";
import { requireAcceso, ROLES_ASIGNABLES } from "../lib/acceso.js";
import { hashPassword, verifyPassword } from "../lib/auth.js";
import { enviarEmail, emailSolicitudFuncion } from "../lib/email.js";

export const negociosRouter = Router();

// Verifica que el usuario autenticado sea dueño del negocio indicado.
async function assertDueno(negocioId: string, usuarioId: number) {
  const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
  if (!negocio) throw NotFound("Negocio no encontrado");
  if (negocio.duenoId !== usuarioId) throw Forbidden("No eres dueño de este negocio");
  return negocio;
}

function slugify(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ---------- Listado público de negocios (solo suscripción activa/prueba y visibles) ----------
negociosRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const ubicacion = typeof req.query.ubicacion === "string" ? req.query.ubicacion.trim() : undefined;
    const categoria = typeof req.query.categoria === "string" ? req.query.categoria : undefined;
    const lat = req.query.lat ? Number(req.query.lat) : undefined;
    const lng = req.query.lng ? Number(req.query.lng) : undefined;
    const geo = lat !== undefined && lng !== undefined && !Number.isNaN(lat) && !Number.isNaN(lng);
    const { page, limit } = paginationSchema.parse(req.query);
    const where: Prisma.NegocioWhereInput = {
      // Regla de negocio: los negocios con suscripción vencida se ocultan al cliente.
      estadoSuscripcion: { in: ["activo", "prueba"] },
      ...(q ? { nombreComercial: { contains: q, mode: "insensitive" } } : {}),
      // Búsqueda por ubicación: filtra por texto de la dirección (ciudad, zona...).
      ...(ubicacion ? { direccion: { contains: ubicacion, mode: "insensitive" } } : {}),
      ...(categoria ? { categoria } : {}),
    };

    const select = {
      id: true, nombreComercial: true, categoria: true, slug: true,
      direccion: true, telefonoContacto: true, logoUrl: true, coverUrl: true,
      ratingPromedio: true, ratingConteo: true, lat: true, lng: true,
    };

    const total = await prisma.negocio.count({ where });

    // Con geo: traemos todos los que tienen coords, calculamos distancia y ordenamos por cercanía.
    if (geo) {
      const todos = await prisma.negocio.findMany({ where, select });
      const conDist = todos
        .map((n) => ({
          ...n,
          distanciaKm: n.lat != null && n.lng != null ? distanciaKm(lat!, lng!, n.lat, n.lng) : null,
        }))
        .sort((a, b) => (a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity))
        .slice((page - 1) * limit, page * limit)
        .map((n) => ({ ...n, distanciaKm: n.distanciaKm != null ? Number(n.distanciaKm.toFixed(2)) : null }));
      return res.json({ negocios: conDist, meta: metaPaginacion(total, page, limit) });
    }

    const negocios = await prisma.negocio.findMany({
      where,
      select,
      orderBy: [{ ratingPromedio: "desc" }, { nombreComercial: "asc" }],
      ...paginar(page, limit),
    });
    res.json({ negocios, meta: metaPaginacion(total, page, limit) });
  }),
);

// Distancia en km entre dos coordenadas (fórmula de Haversine).
function distanciaKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------- Negocios del dueño autenticado (admin_negocio) ----------
// Debe declararse ANTES de "/:slug" para no ser capturada por esa ruta comodín.
// Selección de campos que se muestran tanto para negocios propios como para negocios
// donde el usuario es personal (miembro con rol funcional).
const CAMPOS_NEGOCIO_MIO = {
  id: true, nombreComercial: true, categoria: true, perfil: true, slug: true,
  direccion: true, telefonoContacto: true, lat: true, lng: true,
  estadoSuscripcion: true, suscripcionHasta: true,
  puntosPorVenta: true, puntosParaPremio: true,
} as const;

negociosRouter.get(
  "/mios",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuarioId = req.user!.sub;
    const [propios, comoMiembro] = await Promise.all([
      prisma.negocio.findMany({
        where: { duenoId: usuarioId },
        select: CAMPOS_NEGOCIO_MIO,
        orderBy: { createdAt: "desc" },
      }),
      prisma.miembroNegocio.findMany({
        where: { usuarioId, activo: true },
        select: { rol: true, negocio: { select: CAMPOS_NEGOCIO_MIO } },
      }),
    ]);
    const negocios = [
      ...propios.map((n) => ({ ...n, miRol: "dueno" as const })),
      ...comoMiembro.map((m) => ({ ...m.negocio, miRol: m.rol })),
    ];
    res.json({ negocios });
  }),
);

// ---------- Detalle público con peluqueros aceptados ----------
negociosRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const negocio = await prisma.negocio.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true,
        nombreComercial: true,
        categoria: true,
        slug: true,
        direccion: true,
        telefonoContacto: true,
        logoUrl: true,
        ratingPromedio: true,
        ratingConteo: true,
        estadoSuscripcion: true,
        equipo: {
          where: { estadoAprobacion: "aceptado" },
          select: {
            usuario: { select: { id: true, nombre: true, telefono: true, fotoUrl: true } },
          },
        },
      },
    });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (negocio.estadoSuscripcion === "vencido") {
      throw NotFound("Negocio no disponible");
    }

    const profesionales = negocio.equipo.map((e) => e.usuario);
    res.json({
      negocio: {
        id: negocio.id,
        nombreComercial: negocio.nombreComercial,
        categoria: negocio.categoria,
        slug: negocio.slug,
        direccion: negocio.direccion,
        telefonoContacto: negocio.telefonoContacto,
        logoUrl: negocio.logoUrl,
        ratingPromedio: negocio.ratingPromedio,
        ratingConteo: negocio.ratingConteo,
      },
      // Clave neutral "profesionales"; se mantiene "peluqueros" por compatibilidad.
      profesionales,
      peluqueros: profesionales,
    });
  }),
);

// ---------- Crear negocio (admin_negocio) ----------
// Categorías sugeridas de la plataforma multi-rubro (se permite cualquier valor corto).
export const CATEGORIAS = [
  "barberia",
  "peluqueria",
  "estetica",
  "unas",
  "spa",
  "masajes",
  "tatuajes",
  "depilacion",
  "maquillaje",
  "otro",
] as const;

const crearNegocioSchema = z.object({
  nombreComercial: z.string().min(2).max(150),
  categoria: z.string().min(2).max(40).default("otro"),
  // Rubro del motor de nicho (activa sus módulos). Debe existir en el catálogo.
  perfil: z.enum(SLUGS_PERFIL as [string, ...string[]]).optional(),
  direccion: z.string().min(3),
  telefonoContacto: z.string().min(6).max(20),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

negociosRouter.post(
  "/",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const data = crearNegocioSchema.parse(req.body);
    const duenoId = req.user!.sub;
    // En modo "rubro fijo", todos los negocios de este despliegue son de ese rubro.
    const perfilFinal = env.rubroFijo || data.perfil || null;

    // Límite de negocios por dueño según su plan (el superadmin queda exento).
    if (req.user!.rol !== "superadmin") {
      const propios = await prisma.negocio.findMany({
        where: { duenoId },
        select: { plan: true, estadoSuscripcion: true },
      });
      const maxNegocios = limiteNegocios(propios);
      if (propios.length >= maxNegocios) {
        throw Conflict(
          `Tu plan permite ${maxNegocios} negocio(s). Sube a Pro para crear más.`,
          "LIMITE_NEGOCIOS",
        );
      }
    }

    // Genera un slug único agregando sufijo si hace falta.
    // "buscar" queda reservado: es la ruta del buscador público (/api/storefront/buscar).
    const base = slugify(data.nombreComercial) || "negocio";
    let slug = base;
    let intento = 1;
    while (slug === "buscar" || (await prisma.negocio.findUnique({ where: { slug } }))) {
      slug = `${base}-${++intento}`;
    }

    const negocio = await prisma.negocio.create({
      data: {
        nombreComercial: data.nombreComercial,
        categoria: env.rubroFijo || data.categoria,
        perfil: perfilFinal,
        direccion: data.direccion,
        telefonoContacto: data.telefonoContacto,
        lat: data.lat,
        lng: data.lng,
        slug,
        duenoId,
        estadoSuscripcion: "prueba",
        suscripcionHasta: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 días de prueba
      },
    });

    // El creador queda como primer profesional aceptado de su propio negocio.
    // Así un negocio de una sola persona es reservable sin necesitar una segunda cuenta.
    await prisma.peluqueroEquipo.create({
      data: { negocioId: negocio.id, usuarioId: duenoId, estadoAprobacion: "aceptado" },
    });

    res.status(201).json({ negocio });
  }),
);

// ---------- Actualizar datos/ubicación del negocio (dueño) ----------
const actualizarNegocioSchema = z.object({
  direccion: z.string().min(3).optional(),
  categoria: z.string().min(2).max(40).optional(),
  telefonoContacto: z.string().min(6).max(20).optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  // Fidelización: cuántos puntos da cada venta y cuántos hacen falta para el premio.
  puntosPorVenta: z.coerce.number().int().min(0).max(1000).optional(),
  puntosParaPremio: z.coerce.number().int().min(1).max(100000).optional(),
});

negociosRouter.patch(
  "/:id",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    await assertDueno(req.params.id, req.user!.sub);
    const data = actualizarNegocioSchema.parse(req.body);
    const negocio = await prisma.negocio.update({ where: { id: req.params.id }, data });
    res.json({ negocio });
  }),
);

// ---------- Peluquero solicita unirse a un negocio ----------
negociosRouter.post(
  "/:id/solicitudes",
  requireAuth,
  requireRole("peluquero"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    const usuarioId = req.user!.sub;

    const negocio = await prisma.negocio.findUnique({ where: { id: negocioId } });
    if (!negocio) throw NotFound("Negocio no encontrado");

    const existente = await prisma.peluqueroEquipo.findUnique({
      where: { unique_peluquero_negocio: { negocioId, usuarioId } },
    });
    if (existente) {
      if (existente.estadoAprobacion === "rechazado") {
        // Permite re-solicitar tras un rechazo.
        const actualizado = await prisma.peluqueroEquipo.update({
          where: { id: existente.id },
          data: { estadoAprobacion: "pendiente" },
        });
        return res.status(200).json({ solicitud: actualizado });
      }
      throw Conflict("Ya existe una solicitud para este negocio", "SOLICITUD_EXISTENTE");
    }

    const solicitud = await prisma.peluqueroEquipo.create({
      data: { negocioId, usuarioId, estadoAprobacion: "pendiente" },
    });
    res.status(201).json({ solicitud });
  }),
);

// ---------- Admin lista solicitudes y equipo de su negocio ----------
negociosRouter.get(
  "/:id/equipo",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    await assertDueno(req.params.id, req.user!.sub);
    const negocio = await prisma.negocio.findUnique({
      where: { id: req.params.id },
      select: { plan: true, estadoSuscripcion: true },
    });
    const miembros = await prisma.peluqueroEquipo.findMany({
      where: { negocioId: req.params.id },
      select: {
        id: true,
        estadoAprobacion: true,
        createdAt: true,
        usuario: { select: { id: true, nombre: true, email: true, telefono: true } },
      },
      orderBy: { createdAt: "asc" },
    });
    const activos = miembros.filter((m) => m.estadoAprobacion === "aceptado").length;
    const limite = limitePeluqueros(negocio?.plan, negocio?.estadoSuscripcion ?? "prueba");
    res.json({ miembros, activos, limite });
  }),
);

// ---------- Admin aprueba/rechaza una solicitud (LÍMITE ESTRICTO DE 5) ----------
const decisionSchema = z.object({
  decision: z.enum(["aceptado", "rechazado"]),
});

negociosRouter.patch(
  "/:id/equipo/:solicitudId",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    const solicitudId = Number(req.params.solicitudId);
    const { decision } = decisionSchema.parse(req.body);
    await assertDueno(negocioId, req.user!.sub);

    // Transacción con lock a nivel de negocio para evitar que dos aprobaciones
    // simultáneas superen el límite de 5 peluqueros activos (condición de carrera).
    const resultado = await prisma.$transaction(async (tx) => {
      // Serializa las operaciones sobre este negocio bloqueando su fila.
      await tx.$queryRaw`SELECT id FROM negocios WHERE id = ${negocioId} FOR UPDATE`;

      const negocio = await tx.negocio.findUnique({
        where: { id: negocioId },
        select: { plan: true, estadoSuscripcion: true },
      });
      if (!negocio) throw NotFound("Negocio no encontrado");

      const solicitud = await tx.peluqueroEquipo.findFirst({
        where: { id: solicitudId, negocioId },
      });
      if (!solicitud) throw NotFound("Solicitud no encontrada");

      if (decision === "aceptado") {
        if (solicitud.estadoAprobacion === "aceptado") {
          return solicitud; // idempotente
        }
        const activos = await tx.peluqueroEquipo.count({
          where: { negocioId, estadoAprobacion: "aceptado" },
        });
        const maxPel = limitePeluqueros(negocio.plan, negocio.estadoSuscripcion);
        if (activos >= maxPel) {
          throw Conflict(
            `Tu plan permite ${maxPel} profesionales activos. Sube de plan para aceptar más.`,
            "LIMITE_PELUQUEROS",
          );
        }
      }

      return tx.peluqueroEquipo.update({
        where: { id: solicitud.id },
        data: { estadoAprobacion: decision },
      });
    });

    res.json({ solicitud: resultado });
  }),
);

// ---------- Admin genera un link de invitación único ----------
const crearInvitacionSchema = z.object({
  // Si se omite: invitación al equipo de peluqueros (módulo de citas), como antes.
  // Si se define: invitación a personal con ese rol funcional (cajero/inventario/contador/gerente).
  rol: z.enum(ROLES_ASIGNABLES).optional(),
});

negociosRouter.post(
  "/:id/invitaciones",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "equipo");
    const { rol } = crearInvitacionSchema.parse(req.body ?? {});

    const token = randomBytes(24).toString("base64url");
    const expiraEn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 días
    await prisma.invitacionNegocio.create({ data: { negocioId, token, expiraEn, rolAsignado: rol ?? null } });

    res.status(201).json({
      token,
      expiraEn,
      // El frontend arma la ruta /invitacion/:token; se expone la URL completa por comodidad.
      url: `${env.appUrl}/invitacion/${token}`,
    });
  }),
);

// ---------- Peluquero consulta y acepta una invitación por token ----------
negociosRouter.get(
  "/invitaciones/:token",
  asyncHandler(async (req, res) => {
    const inv = await prisma.invitacionNegocio.findUnique({
      where: { token: req.params.token },
      include: { negocio: { select: { id: true, nombreComercial: true, slug: true } } },
    });
    if (!inv || inv.usadaEn || inv.expiraEn < new Date()) {
      throw NotFound("Invitación inválida o expirada");
    }
    res.json({ negocio: inv.negocio });
  }),
);

negociosRouter.post(
  "/invitaciones/:token/aceptar",
  requireAuth,
  asyncHandler(async (req, res) => {
    const usuarioId = req.user!.sub;

    const resultado = await prisma.$transaction(async (tx) => {
      const inv = await tx.invitacionNegocio.findUnique({ where: { token: req.params.token } });
      if (!inv || inv.usadaEn || inv.expiraEn < new Date()) {
        throw NotFound("Invitación inválida o expirada");
      }
      // Lock del negocio para respetar el límite de 5 al aceptar por invitación.
      await tx.$queryRaw`SELECT id FROM negocios WHERE id = ${inv.negocioId} FOR UPDATE`;

      // Invitación a personal con rol funcional (cajero/inventario/contador/gerente):
      // no pasa por el equipo de peluqueros ni su límite de 5.
      if (inv.rolAsignado) {
        const existente = await tx.miembroNegocio.findUnique({
          where: { negocioId_usuarioId: { negocioId: inv.negocioId, usuarioId } },
        });
        if (existente?.activo) throw Conflict("Ya perteneces a este negocio", "YA_MIEMBRO");
        const membresia = existente
          ? await tx.miembroNegocio.update({ where: { id: existente.id }, data: { rol: inv.rolAsignado, activo: true } })
          : await tx.miembroNegocio.create({ data: { negocioId: inv.negocioId, usuarioId, rol: inv.rolAsignado } });
        await tx.invitacionNegocio.update({ where: { id: inv.id }, data: { usadaPor: usuarioId, usadaEn: new Date() } });
        return { tipo: "equipo" as const, membresia };
      }

      const yaMiembro = await tx.peluqueroEquipo.findUnique({
        where: { unique_peluquero_negocio: { negocioId: inv.negocioId, usuarioId } },
      });
      if (yaMiembro && yaMiembro.estadoAprobacion === "aceptado") {
        throw Conflict("Ya perteneces a este negocio", "YA_MIEMBRO");
      }

      const activos = await tx.peluqueroEquipo.count({
        where: { negocioId: inv.negocioId, estadoAprobacion: "aceptado" },
      });
      if (activos >= env.maxPeluqueros) {
        throw Conflict(`El negocio ya alcanzó el máximo de ${env.maxPeluqueros} peluqueros`, "LIMITE_PELUQUEROS");
      }

      // La invitación pre-aprueba al peluquero.
      const membresia = yaMiembro
        ? await tx.peluqueroEquipo.update({
            where: { id: yaMiembro.id },
            data: { estadoAprobacion: "aceptado" },
          })
        : await tx.peluqueroEquipo.create({
            data: { negocioId: inv.negocioId, usuarioId, estadoAprobacion: "aceptado" },
          });

      await tx.invitacionNegocio.update({
        where: { id: inv.id },
        data: { usadaPor: usuarioId, usadaEn: new Date() },
      });
      return { tipo: "peluquero" as const, membresia };
    });

    res.json({ membresia: resultado.membresia, tipo: resultado.tipo });
  }),
);

// ---------- Personal del negocio (rol funcional): listar, cambiar rol, quitar ----------
negociosRouter.get(
  "/:id/miembros",
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireAcceso(req.params.id, req.user!.sub, req.user!.rol, "equipo");
    const miembros = await prisma.miembroNegocio.findMany({
      where: { negocioId: req.params.id },
      select: { id: true, rol: true, activo: true, createdAt: true, usuario: { select: { id: true, nombre: true, email: true, telefono: true } } },
      orderBy: { createdAt: "asc" },
    });
    res.json({ miembros, rolesAsignables: ROLES_ASIGNABLES });
  }),
);

// Crea el usuario del empleado directo, sin invitación por link — pensado para la app de
// escritorio: ahí no hay forma de que un link le llegue a nadie (el servidor solo es alcanzable
// en esta misma PC), así que el dueño le da de alta la cuenta y la clave ahí mismo, en persona.
const crearMiembroDirectoSchema = z.object({
  nombre: z.string().min(2).max(100),
  email: z.string().email().max(150),
  telefono: z.string().min(6).max(20),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  rol: z.enum(ROLES_ASIGNABLES),
});

negociosRouter.post(
  "/:id/miembros/crear-directo",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "equipo");
    const d = crearMiembroDirectoSchema.parse(req.body);

    const existe = await prisma.usuario.findUnique({ where: { email: d.email } });
    if (existe) throw BadRequest("Ese email ya está en uso", "EMAIL_EN_USO");

    const { usuario, miembro } = await prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          nombre: d.nombre,
          email: d.email,
          telefono: d.telefono,
          passwordHash: await hashPassword(d.password),
          rol: "cliente",
          // Cuenta creada en persona por el dueño: no hace falta el paso de verificar email.
          emailVerificadoEn: new Date(),
        },
      });
      const miembro = await tx.miembroNegocio.create({
        data: { negocioId, usuarioId: usuario.id, rol: d.rol },
      });
      return { usuario, miembro };
    });

    res.status(201).json({
      miembro: { ...miembro, usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, telefono: usuario.telefono } },
    });
  }),
);

const actualizarMiembroSchema = z.object({
  rol: z.enum(ROLES_ASIGNABLES).optional(),
  activo: z.boolean().optional(),
});

negociosRouter.patch(
  "/:id/miembros/:miembroId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireAcceso(req.params.id, req.user!.sub, req.user!.rol, "equipo");
    const d = actualizarMiembroSchema.parse(req.body);
    const m = await prisma.miembroNegocio.findUnique({ where: { id: req.params.miembroId } });
    if (!m || m.negocioId !== req.params.id) throw NotFound("Miembro no encontrado");
    const actualizado = await prisma.miembroNegocio.update({ where: { id: m.id }, data: d });
    res.json({ miembro: actualizado });
  }),
);

negociosRouter.delete(
  "/:id/miembros/:miembroId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireAcceso(req.params.id, req.user!.sub, req.user!.rol, "equipo");
    const m = await prisma.miembroNegocio.findUnique({ where: { id: req.params.miembroId } });
    if (!m || m.negocioId !== req.params.id) throw NotFound("Miembro no encontrado");
    await prisma.miembroNegocio.delete({ where: { id: m.id } });
    res.json({ ok: true });
  }),
);

// ---------- Analítica del negocio (dueño) ----------
negociosRouter.get(
  "/:id/analitica",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub);

    // IDs de los peluqueros aceptados del negocio.
    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const peluqueroIds = equipo.map((e) => e.usuarioId);

    if (peluqueroIds.length === 0) {
      return res.json({ totalReservas: 0, porEstado: [], ingresoServiciosUsd: 0, porPeluquero: [] });
    }

    const [porEstado, completadas, reservasPorPeluquero] = await Promise.all([
      prisma.reservacion.groupBy({
        by: ["estadoCita"],
        where: { peluqueroId: { in: peluqueroIds } },
        _count: true,
      }),
      prisma.reservacion.findMany({
        where: { peluqueroId: { in: peluqueroIds }, estadoCita: "completada" },
        select: { servicio: { select: { precio: true } } },
      }),
      prisma.reservacion.groupBy({
        by: ["peluqueroId"],
        where: { peluqueroId: { in: peluqueroIds }, estadoCita: { in: ["confirmada", "completada"] } },
        _count: true,
      }),
    ]);

    const ingresoServiciosUsd = completadas.reduce((acc, r) => acc + Number(r.servicio.precio), 0);
    const nombreDe = new Map(equipo.map((e) => [e.usuarioId, e.usuario.nombre]));

    res.json({
      totalReservas: porEstado.reduce((a, e) => a + e._count, 0),
      porEstado: porEstado.map((e) => ({ estado: e.estadoCita, total: e._count })),
      ingresoServiciosUsd: Number(ingresoServiciosUsd.toFixed(2)),
      porPeluquero: reservasPorPeluquero.map((r) => ({
        peluquero: nombreDe.get(r.peluqueroId) ?? `#${r.peluqueroId}`,
        reservas: r._count,
      })),
    });
  }),
);

// ---------- Liquidación por empleado (cuánto de la fianza corresponde a cada uno) ----------
// La fianza va a la cuenta del negocio; este desglose dice cuánto generó cada profesional
// para que el dueño le pague su parte. Por defecto, del mes en curso.
negociosRouter.get(
  "/:id/liquidacion",
  requireAuth,
  requireRole("admin_negocio"),
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await assertDueno(negocioId, req.user!.sub);

    const hoy = new Date();
    const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const desde =
      typeof req.query.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde)
        ? new Date(`${req.query.desde}T00:00:00`)
        : inicioMes;

    const equipo = await prisma.peluqueroEquipo.findMany({
      where: { negocioId, estadoAprobacion: "aceptado" },
      select: { usuarioId: true, usuario: { select: { nombre: true } } },
    });
    const ids = equipo.map((e) => e.usuarioId);
    const parteNegocioPorFianza = calcularSplitFianza().alNegocioUsd;

    if (ids.length === 0) {
      return res.json({ desde: desde.toISOString().slice(0, 10), parteNegocioPorFianza, empleados: [], totalReservas: 0, totalNegocioUsd: 0 });
    }

    const grupos = await prisma.reservacion.groupBy({
      by: ["peluqueroId"],
      where: { peluqueroId: { in: ids }, pagoReservaStatus: "pagado", createdAt: { gte: desde } },
      _count: true,
    });
    const countDe = new Map(grupos.map((g) => [g.peluqueroId, g._count]));

    const empleados = equipo
      .map((e) => {
        const n = countDe.get(e.usuarioId) ?? 0;
        return {
          peluquero: e.usuario.nombre,
          reservasPagadas: n,
          fianzaNegocioUsd: Number((n * parteNegocioPorFianza).toFixed(2)),
        };
      })
      .sort((a, b) => b.reservasPagadas - a.reservasPagadas);

    res.json({
      desde: desde.toISOString().slice(0, 10),
      parteNegocioPorFianza,
      comisionPlataformaUsd: env.fianzaComisionUsd,
      empleados,
      totalReservas: empleados.reduce((a, e) => a + e.reservasPagadas, 0),
      totalNegocioUsd: Number(empleados.reduce((a, e) => a + e.fianzaNegocioUsd, 0).toFixed(2)),
    });
  }),
);

// ---------- Rentabilidad por producto (comercio/POS) ----------
// Distinta de "/analitica" (esa es del módulo de citas/peluqueros — en un comercio minorista
// sin agenda siempre da todo en cero). Esta mide lo que de verdad importa acá: qué producto
// deja más margen, no solo cuál vende más — ingreso de cada línea vendida menos su costo.
negociosRouter.get(
  "/:id/rentabilidad",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = req.params.id;
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "reportes");

    const dias = Math.min(365, Math.max(1, Number(req.query.dias) || 30));
    const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

    const lineas = await prisma.lineaVenta.findMany({
      where: { venta: { negocioId, createdAt: { gte: desde } } },
      select: {
        cantidad: true, subtotal: true, nombre: true,
        producto: { select: { id: true, nombre: true, costo: true, tipoProducto: true, volumenMl: true } },
      },
    });

    const porProducto = new Map<string, { nombre: string; tipoProducto: string; unidades: number; ingreso: number; costo: number }>();
    let ingresoTotal = 0, costoTotal = 0, sinCosto = 0;
    for (const l of lineas) {
      const ingreso = Number(l.subtotal);
      ingresoTotal += ingreso;
      const key = l.producto?.id ?? `__sin_producto__${l.nombre}`;
      const actual = porProducto.get(key) ?? {
        nombre: l.producto?.nombre ?? l.nombre, tipoProducto: l.producto?.tipoProducto ?? "consumible", unidades: 0, ingreso: 0, costo: 0,
      };
      actual.unidades += Number(l.cantidad);
      actual.ingreso += ingreso;
      if (l.producto?.costo != null) {
        // Para un líquido vendido por ml, `costo` es el costo del POTE COMPLETO (ej. el bote
        // de 100ml), no por ml — hay que llevarlo a costo-por-ml antes de multiplicar por los
        // ml de esta línea, si no el costo queda inflado ~50x (costo del bote entero × ml).
        const vol = l.producto.volumenMl != null ? Number(l.producto.volumenMl) : 0;
        const costoUnitario = vol > 0 ? Number(l.producto.costo) / vol : Number(l.producto.costo);
        const costoLinea = costoUnitario * Number(l.cantidad);
        actual.costo += costoLinea;
        costoTotal += costoLinea;
      } else {
        sinCosto += ingreso; // no se puede calcular margen real sin costo cargado
      }
      porProducto.set(key, actual);
    }

    const productos = Array.from(porProducto.values())
      .map((p) => ({ ...p, margen: Number((p.ingreso - p.costo).toFixed(2)), ingreso: Number(p.ingreso.toFixed(2)), costo: Number(p.costo.toFixed(2)) }))
      .sort((a, b) => b.margen - a.margen);

    res.json({
      dias,
      ingresoTotal: Number(ingresoTotal.toFixed(2)),
      costoTotal: Number(costoTotal.toFixed(2)),
      margenTotal: Number((ingresoTotal - costoTotal).toFixed(2)),
      // Parte del ingreso de productos sin costo cargado: el margen de esa parte no se puede
      // calcular (se muestra aparte para no mentir con un número inflado).
      ingresoSinCosto: Number(sinCosto.toFixed(2)),
      productos,
    });
  }),
);

// ---------- PIN del panel de Contabilidad ----------
// Un gerente/contador puede tener el área "gastos" habilitada por su rol de equipo, pero el
// panel de Contabilidad (gastos/impuestos/compras/analítica) pide además este PIN — así el
// dueño decide, sesión por sesión, quién entra a ver los números, sin crear una cuenta aparte.
const pinSchema = z.object({ pin: z.string().min(4).max(20) });

negociosRouter.get(
  "/:id/pin-contabilidad",
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireAcceso(req.params.id, req.user!.sub, req.user!.rol, "gastos");
    const negocio = await prisma.negocio.findUnique({
      where: { id: req.params.id },
      select: { pinContabilidadHash: true },
    });
    if (!negocio) throw NotFound("Negocio no encontrado");
    res.json({ configurado: !!negocio.pinContabilidadHash });
  }),
);

negociosRouter.post(
  "/:id/pin-contabilidad",
  requireAuth,
  asyncHandler(async (req, res) => {
    // Solo el dueño define/cambia el PIN (no un gerente al que se le delegó el área).
    await assertDueno(req.params.id, req.user!.sub);
    const { pin } = pinSchema.parse(req.body);
    await prisma.negocio.update({
      where: { id: req.params.id },
      data: { pinContabilidadHash: await hashPassword(pin) },
    });
    res.json({ ok: true });
  }),
);

// ---------- Solicitar una función a medida ----------
// Un negocio que ya tiene un plan/licencia puede pedir algo puntual para SU sistema (no es un
// catálogo con precio fijo — se cotiza por fuera). Solo manda un email a soporte por ahora.
const solicitudFuncionSchema = z.object({ descripcion: z.string().min(10).max(2000) });

negociosRouter.post(
  "/:id/solicitar-funcion",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocio = await assertDueno(req.params.id, req.user!.sub);
    const { descripcion } = solicitudFuncionSchema.parse(req.body);
    const usuario = await prisma.usuario.findUnique({ where: { id: req.user!.sub } });
    const { subject, html } = emailSolicitudFuncion(
      negocio.nombreComercial,
      usuario?.nombre ?? "—",
      usuario?.email ?? "—",
      descripcion,
    );
    await enviarEmail({ to: env.companySupportEmail, subject, html });
    res.json({ ok: true });
  }),
);

negociosRouter.post(
  "/:id/pin-contabilidad/verificar",
  requireAuth,
  asyncHandler(async (req, res) => {
    await requireAcceso(req.params.id, req.user!.sub, req.user!.rol, "gastos");
    const { pin } = pinSchema.parse(req.body);
    const negocio = await prisma.negocio.findUnique({
      where: { id: req.params.id },
      select: { pinContabilidadHash: true },
    });
    if (!negocio) throw NotFound("Negocio no encontrado");
    if (!negocio.pinContabilidadHash) throw Conflict("Todavía no configuraste un PIN de contabilidad", "PIN_NO_CONFIGURADO");
    const ok = await verifyPassword(pin, negocio.pinContabilidadHash);
    if (!ok) throw Forbidden("PIN incorrecto");
    res.json({ ok: true });
  }),
);
