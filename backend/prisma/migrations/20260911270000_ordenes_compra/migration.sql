-- Órdenes de compra: separa "se pidió" de "ya llegó" — antes toda compra sumaba stock al
-- crearse. Las compras existentes se marcan "recibida" (ya habían sumado su stock).
ALTER TABLE "compras" ADD COLUMN     "estado" VARCHAR(12) NOT NULL DEFAULT 'recibida';
ALTER TABLE "compras" ADD COLUMN     "recibida_en" TIMESTAMP(3);
