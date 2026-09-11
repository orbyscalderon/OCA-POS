-- AlterTable: PIN de acceso al panel de Contabilidad (separado del login normal)
ALTER TABLE "negocios" ADD COLUMN     "pin_contabilidad_hash" VARCHAR(255);
