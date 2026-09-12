-- Permisos granulares por miembro del equipo, reemplazando el control de acceso basado
-- únicamente en 4 roles fijos. Se rellena según el rol que cada miembro ya tenía, para no
-- perder capacidades en instalaciones existentes.
ALTER TABLE "miembros_negocio" ADD COLUMN "permisos" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "miembros_negocio" SET "permisos" = CASE "rol"
  WHEN 'gerente' THEN ARRAY[
    'ventas.vender','ventas.anular','ventas.caja',
    'inventario.ver','inventario.crear','inventario.editar','inventario.eliminar',
    'clientes.ver','clientes.crear','clientes.editar','clientes.eliminar',
    'compras.ver','compras.crear','compras.eliminar',
    'gastos.ver','gastos.crear','gastos.eliminar',
    'reportes.ver','impuestos.gestionar','agro.gestionar',
    'equipo.ver','equipo.crear','equipo.editar','equipo.eliminar'
  ]
  WHEN 'cajero' THEN ARRAY['ventas.vender','ventas.caja']
  WHEN 'inventario' THEN ARRAY[
    'inventario.ver','inventario.crear','inventario.editar','inventario.eliminar',
    'compras.ver','compras.crear','agro.gestionar'
  ]
  WHEN 'contador' THEN ARRAY['gastos.ver','gastos.crear','gastos.eliminar','reportes.ver','impuestos.gestionar','compras.ver']
  ELSE '{}'
END::TEXT[];
