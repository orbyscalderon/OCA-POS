-- AlterTable: costeo de gastos por lote biológico (agro)
ALTER TABLE "gastos" ADD COLUMN     "lote_id" TEXT,
ADD COLUMN     "tipo_costo" VARCHAR(20);

-- AlterTable: producto vinculado a un lote biológico (para atribuir ingresos de venta)
ALTER TABLE "productos" ADD COLUMN     "lote_id" TEXT;

-- AlterTable: invitación puede traer un rol funcional asignado
ALTER TABLE "invitaciones_negocio" ADD COLUMN     "rol_asignado" VARCHAR(20);

-- CreateTable: personal del negocio con rol funcional (cajero/inventario/contador/gerente)
CREATE TABLE "miembros_negocio" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "rol" VARCHAR(20) NOT NULL DEFAULT 'cajero',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "miembros_negocio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gastos_lote_id_idx" ON "gastos"("lote_id");

-- CreateIndex
CREATE INDEX "productos_lote_id_idx" ON "productos"("lote_id");

-- CreateIndex
CREATE INDEX "miembros_negocio_negocio_id_activo_idx" ON "miembros_negocio"("negocio_id", "activo");

-- CreateIndex
CREATE UNIQUE INDEX "miembros_negocio_negocio_id_usuario_id_key" ON "miembros_negocio"("negocio_id", "usuario_id");

-- AddForeignKey
ALTER TABLE "gastos" ADD CONSTRAINT "gastos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_biologicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "productos" ADD CONSTRAINT "productos_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_biologicos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros_negocio" ADD CONSTRAINT "miembros_negocio_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros_negocio" ADD CONSTRAINT "miembros_negocio_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
