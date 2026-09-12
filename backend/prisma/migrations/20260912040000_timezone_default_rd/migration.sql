-- El sistema es para República Dominicana — el default de zona horaria era "Europe/Madrid"
-- (quedó del arranque del proyecto), corregido a America/Santo_Domingo.
ALTER TABLE "negocios" ALTER COLUMN "timezone" SET DEFAULT 'America/Santo_Domingo';

-- Backfill: solo negocios que siguen en el default viejo (nunca lo cambiaron a mano).
UPDATE "negocios" SET "timezone" = 'America/Santo_Domingo' WHERE "timezone" = 'Europe/Madrid';
