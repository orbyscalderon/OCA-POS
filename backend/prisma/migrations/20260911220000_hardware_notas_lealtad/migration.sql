-- AlterTable: hardware vs consumible + notas técnicas + foto por producto
ALTER TABLE "productos" ADD COLUMN     "tipo_producto" VARCHAR(20) NOT NULL DEFAULT 'consumible';
ALTER TABLE "productos" ADD COLUMN     "notas_tecnicas" TEXT;
ALTER TABLE "productos" ADD COLUMN     "imagen_url" VARCHAR(255);

-- AlterTable: regla de fidelización configurable por negocio
ALTER TABLE "negocios" ADD COLUMN     "puntos_por_venta" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "negocios" ADD COLUMN     "puntos_para_premio" INTEGER NOT NULL DEFAULT 10;
