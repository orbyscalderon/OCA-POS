-- Línea genética del lote (para comparar contra la curva estándar del proveedor).
ALTER TABLE "lotes_biologicos" ADD COLUMN     "linea_genetica" VARCHAR(30);

-- Clasificación de huevos por calibre + descarte, por registro diario (solo postura).
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_jumbo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_extra" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_grande" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_mediano" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_pequeno" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_rotos" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "registros_agro" ADD COLUMN     "huevos_sucios" INTEGER NOT NULL DEFAULT 0;

-- Sanidad: vacunas, tratamientos y síntomas del lote, con periodo de retiro opcional.
CREATE TABLE "eventos_sanitarios" (
    "id" TEXT NOT NULL,
    "lote_id" TEXT NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "dias_retiro" INTEGER,
    "notas" VARCHAR(300),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eventos_sanitarios_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "eventos_sanitarios_lote_id_idx" ON "eventos_sanitarios"("lote_id");

ALTER TABLE "eventos_sanitarios" ADD CONSTRAINT "eventos_sanitarios_lote_id_fkey" FOREIGN KEY ("lote_id") REFERENCES "lotes_biologicos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
