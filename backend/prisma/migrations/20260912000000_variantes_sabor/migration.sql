-- Variantes de sabor: agrupa productos líquidos que son sabores de una misma línea (ej.
-- "Recargas" con Mango/Fresa/Menta), cada uno con su propio stock/precio/costo.
ALTER TABLE "productos" ADD COLUMN     "variante_base_id" TEXT;
CREATE INDEX "productos_variante_base_id_idx" ON "productos"("variante_base_id");
ALTER TABLE "productos" ADD CONSTRAINT "productos_variante_base_id_fkey" FOREIGN KEY ("variante_base_id") REFERENCES "productos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
