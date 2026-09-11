-- AlterTable: saldo de fiado por cliente (modulo credit)
ALTER TABLE "clientes_negocio" ADD COLUMN     "saldo_fiado" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable: venta puede quedar fiada a un cliente
ALTER TABLE "ventas" ADD COLUMN     "cliente_id" TEXT;

-- CreateIndex
CREATE INDEX "ventas_cliente_id_idx" ON "ventas"("cliente_id");

-- AddForeignKey
ALTER TABLE "ventas" ADD CONSTRAINT "ventas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes_negocio"("id") ON DELETE SET NULL ON UPDATE CASCADE;
