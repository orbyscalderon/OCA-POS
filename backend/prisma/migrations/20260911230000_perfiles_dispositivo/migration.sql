-- CreateTable: perfiles de dispositivo (pod/mod/tanque) reutilizables para calcular recargas
CREATE TABLE "perfiles_dispositivo" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "capacidad_ml" DECIMAL(8,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perfiles_dispositivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "perfiles_dispositivo_negocio_id_idx" ON "perfiles_dispositivo"("negocio_id");

-- AddForeignKey
ALTER TABLE "perfiles_dispositivo" ADD CONSTRAINT "perfiles_dispositivo_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
