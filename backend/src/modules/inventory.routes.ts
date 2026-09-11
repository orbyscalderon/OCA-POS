import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { BadRequest, NotFound } from "../lib/errors.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { requireAcceso } from "../lib/acceso.js";

export const inventoryRouter = Router();

const productoSchema = z.object({
  negocioId: z.string().min(1),
  nombre: z.string().min(1).max(150),
  sku: z.string().max(60).optional(),
  categoria: z.string().max(60).optional(),
  unidad: z.string().max(12).default("UND"),
  precioVenta: z.coerce.number().min(0),
  impuestoPct: z.coerce.number().min(0).max(100).default(0),
  costo: z.coerce.number().min(0).optional(),
  stock: z.coerce.number().default(0),
  stockMinimo: z.coerce.number().min(0).default(0),
  // Agro: vincula el producto a un lote biológico para atribuirle el ingreso de sus ventas.
  loteId: z.string().min(1).nullable().optional(),
  // Líquidos de vapeo: tamaño del pote y graduación de nicotina.
  volumenMl: z.coerce.number().min(0).nullable().optional(),
  nicotinaMg: z.coerce.number().min(0).nullable().optional(),
  // Este producto (p. ej. "Recarga") descuenta stock de OTRO producto (el pote de líquido) en
  // vez de llevar stock propio: productoFuenteId = qué pote, rendimientoPorVenta = cuánto se
  // descuenta de ese pote por cada unidad vendida de este producto (p. ej. 3 ml por recarga).
  productoFuenteId: z.string().min(1).nullable().optional(),
  rendimientoPorVenta: z.coerce.number().min(0).nullable().optional(),
  // Hardware (dispositivo, se vende una vez) vs consumible (líquido/resistencia, se recompra).
  tipoProducto: z.enum(["consumible", "hardware"]).default("consumible"),
  // Asesoría técnica que ve el personal al venderlo (ej. compatibilidad, cómo recomendarlo).
  notasTecnicas: z.string().max(2000).nullable().optional(),
  // Trazabilidad de lote/vencimiento (farmacia, panadería, perecederos en general).
  loteNumero: z.string().max(60).nullable().optional(),
  fechaVencimiento: z.coerce.date().nullable().optional(),
});

// El producto fuente (el pote del que descuenta una recarga) debe ser del MISMO negocio —
// evita que un producto quede apuntando a stock de otro negocio.
async function assertProductoFuenteValido(negocioId: string, productoFuenteId: string) {
  const fuente = await prisma.producto.findUnique({ where: { id: productoFuenteId }, select: { negocioId: true } });
  if (!fuente || fuente.negocioId !== negocioId) throw BadRequest("El producto fuente no pertenece a este negocio", "PRODUCTO_FUENTE_INVALIDO");
}

// Listar productos de un negocio.
inventoryRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const negocioId = z.string().min(1).parse(req.query.negocioId);
    await requireAcceso(negocioId, req.user!.sub, req.user!.rol, "inventario");
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const productos = await prisma.producto.findMany({
      where: {
        negocioId,
        ...(q ? { OR: [{ nombre: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}),
      },
      orderBy: { nombre: "asc" },
    });
    res.json({ productos });
  }),
);

// Crear producto.
inventoryRouter.post(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const d = productoSchema.parse(req.body);
    await requireAcceso(d.negocioId, req.user!.sub, req.user!.rol, "inventario");
    if (d.productoFuenteId) await assertProductoFuenteValido(d.negocioId, d.productoFuenteId);
    const producto = await prisma.producto.create({
      data: {
        negocioId: d.negocioId, nombre: d.nombre, sku: d.sku ?? null, categoria: d.categoria ?? null,
        unidad: d.unidad, precioVenta: d.precioVenta, impuestoPct: d.impuestoPct, costo: d.costo ?? null,
        stock: d.stock, stockMinimo: d.stockMinimo, loteId: d.loteId ?? null,
        volumenMl: d.volumenMl ?? null, nicotinaMg: d.nicotinaMg ?? null,
        productoFuenteId: d.productoFuenteId ?? null, rendimientoPorVenta: d.rendimientoPorVenta ?? null,
        tipoProducto: d.tipoProducto, notasTecnicas: d.notasTecnicas ?? null,
        loteNumero: d.loteNumero ?? null, fechaVencimiento: d.fechaVencimiento ?? null,
      },
    });
    // Movimiento inicial de stock si arranca con existencias.
    if (d.stock !== 0) {
      await prisma.movimientoStock.create({ data: { productoId: producto.id, tipo: "entrada", cantidad: d.stock, motivo: "Stock inicial" } });
    }
    res.status(201).json({ producto });
  }),
);

// Actualizar producto (sin tocar stock; para eso está /stock).
inventoryRouter.patch(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = await prisma.producto.findUnique({ where: { id: req.params.id }, select: { negocioId: true } });
    if (!p) throw NotFound("Producto no encontrado");
    await requireAcceso(p.negocioId, req.user!.sub, req.user!.rol, "inventario");
    const d = productoSchema.partial().omit({ negocioId: true, stock: true }).parse(req.body);
    if (d.productoFuenteId) await assertProductoFuenteValido(p.negocioId, d.productoFuenteId);
    const producto = await prisma.producto.update({ where: { id: req.params.id }, data: d });
    res.json({ producto });
  }),
);

// Ajustar stock (entrada / salida / ajuste absoluto) con registro en el ledger.
const stockSchema = z.object({
  tipo: z.enum(["entrada", "salida", "ajuste"]),
  cantidad: z.coerce.number(),
  motivo: z.string().max(200).optional(),
});
inventoryRouter.post(
  "/:id/stock",
  requireAuth,
  asyncHandler(async (req, res) => {
    const d = stockSchema.parse(req.body);
    const p = await prisma.producto.findUnique({ where: { id: req.params.id } });
    if (!p) throw NotFound("Producto no encontrado");
    await requireAcceso(p.negocioId, req.user!.sub, req.user!.rol, "inventario");

    // Delta aplicado con `increment` (atómico en la BD): dos ajustes/ventas concurrentes
    // sobre el mismo producto no se pisan entre sí (evita perder movimientos de stock).
    let delta: number;
    if (d.tipo === "ajuste") delta = d.cantidad - Number(p.stock);
    else if (d.tipo === "entrada") delta = Math.abs(d.cantidad);
    else delta = -Math.abs(d.cantidad);

    const [producto] = await prisma.$transaction([
      prisma.producto.update({ where: { id: p.id }, data: { stock: { increment: delta } } }),
      prisma.movimientoStock.create({ data: { productoId: p.id, tipo: d.tipo, cantidad: delta, motivo: d.motivo ?? null } }),
    ]);
    res.json({ producto });
  }),
);
