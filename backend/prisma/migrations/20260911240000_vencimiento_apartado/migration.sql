-- AlterTable: trazabilidad de lote/vencimiento por producto (farmacia, panadería, perecederos)
ALTER TABLE "productos" ADD COLUMN     "lote_numero" VARCHAR(60);
ALTER TABLE "productos" ADD COLUMN     "fecha_vencimiento" DATE;
