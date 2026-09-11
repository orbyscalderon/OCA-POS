-- AlterTable: atributos de líquidos (ml/mg) y "producto fuente" para recargas que descuentan
-- stock de otro producto (p. ej. una recarga consume ml de un pote de líquido).
ALTER TABLE "productos" ADD COLUMN     "volumen_ml" DECIMAL(8,2);
ALTER TABLE "productos" ADD COLUMN     "nicotina_mg" DECIMAL(6,2);
ALTER TABLE "productos" ADD COLUMN     "producto_fuente_id" TEXT;
ALTER TABLE "productos" ADD COLUMN     "rendimiento_por_venta" DECIMAL(8,3);

-- CreateIndex
CREATE INDEX "productos_producto_fuente_id_idx" ON "productos"("producto_fuente_id");

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_producto_fuente_id_fkey" FOREIGN KEY ("producto_fuente_id") REFERENCES "productos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
