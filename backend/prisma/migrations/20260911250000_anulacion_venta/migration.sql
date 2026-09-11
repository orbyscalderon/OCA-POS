-- AlterTable: anulación de venta (revertir stock/saldo sin borrar el registro histórico)
ALTER TABLE "ventas" ADD COLUMN     "anulada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ventas" ADD COLUMN     "anulada_en" TIMESTAMP(3);
ALTER TABLE "ventas" ADD COLUMN     "motivo_anulacion" VARCHAR(200);
