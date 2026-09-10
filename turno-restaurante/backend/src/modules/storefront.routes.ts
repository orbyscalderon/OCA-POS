import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";

export const storefrontRouter = Router();

// ---------- Buscador público: "quién tiene este producto disponible" ----------
// Busca entre TODOS los negocios activos (no solo uno), agrupado por negocio. Sin
// autenticación: es la puerta de entrada del cliente que busca un producto, no un negocio.
storefrontRouter.get(
  "/buscar",
  asyncHandler(async (req, res) => {
    const q = z.string().trim().min(2).max(100).parse(req.query.q);
    const productos = await prisma.producto.findMany({
      where: {
        activo: true,
        stock: { gt: 0 },
        negocio: { estadoSuscripcion: { not: "vencido" } },
        OR: [{ nombre: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }],
      },
      select: {
        id: true, nombre: true, sku: true, categoria: true, unidad: true,
        precioVenta: true, stock: true,
        negocio: {
          select: {
            id: true, nombreComercial: true, slug: true, categoria: true, perfil: true,
            telefonoContacto: true, direccion: true, logoUrl: true,
          },
        },
      },
      orderBy: { nombre: "asc" },
      take: 60,
    });

    // Agrupado por negocio: un cliente busca "arroz" y ve quién lo tiene y a qué precio.
    const porNegocio = new Map<string, { negocio: (typeof productos)[number]["negocio"]; productos: Omit<(typeof productos)[number], "negocio">[] }>();
    for (const { negocio, ...p } of productos) {
      if (!porNegocio.has(negocio.id)) porNegocio.set(negocio.id, { negocio, productos: [] });
      porNegocio.get(negocio.id)!.productos.push(p);
    }
    res.json({ resultados: [...porNegocio.values()] });
  }),
);

// Catálogo PÚBLICO de un negocio (tienda online). Sin autenticación.
storefrontRouter.get(
  "/:slug",
  asyncHandler(async (req, res) => {
    const negocio = await prisma.negocio.findUnique({
      where: { slug: req.params.slug },
      select: {
        id: true, nombreComercial: true, telefonoContacto: true, logoUrl: true, coverUrl: true,
        direccion: true, perfil: true, categoria: true, estadoSuscripcion: true,
      },
    });
    if (!negocio || negocio.estadoSuscripcion === "vencido") throw NotFound("Tienda no disponible");
    const productos = await prisma.producto.findMany({
      where: { negocioId: negocio.id, activo: true },
      select: { id: true, nombre: true, precioVenta: true, impuestoPct: true, categoria: true, sku: true, unidad: true, stock: true },
      orderBy: { nombre: "asc" },
    });
    res.json({ negocio, productos });
  }),
);
