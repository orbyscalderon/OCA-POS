-- Invitación por link (modo no-escritorio) también puede traer permisos granulares, no solo
-- una plantilla de rol.
ALTER TABLE "invitaciones_negocio" ADD COLUMN "permisos_asignados" TEXT[] NOT NULL DEFAULT '{}';
