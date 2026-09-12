-- Gasto general de una granja o galpón completo (luz, mantenimiento…), sin ser de un lote.
ALTER TABLE "gastos" ADD COLUMN     "granja_id" TEXT;
ALTER TABLE "gastos" ADD COLUMN     "galpon_id" TEXT;

CREATE INDEX "gastos_granja_id_idx" ON "gastos"("granja_id");
CREATE INDEX "gastos_galpon_id_idx" ON "gastos"("galpon_id");

ALTER TABLE "gastos" ADD CONSTRAINT "gastos_granja_id_fkey" FOREIGN KEY ("granja_id") REFERENCES "granjas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_galpon_id_fkey" FOREIGN KEY ("galpon_id") REFERENCES "galpones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
