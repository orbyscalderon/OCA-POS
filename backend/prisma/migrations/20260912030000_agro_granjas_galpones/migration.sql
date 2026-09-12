-- Jerarquía opcional Empresa (negocio) > Granja > Galpón/Nave > Lote.
CREATE TABLE "granjas" (
    "id" TEXT NOT NULL,
    "negocio_id" TEXT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "direccion" VARCHAR(200),
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "granjas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "granjas_negocio_id_idx" ON "granjas"("negocio_id");

ALTER TABLE "granjas" ADD CONSTRAINT "granjas_negocio_id_fkey" FOREIGN KEY ("negocio_id") REFERENCES "negocios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "galpones" (
    "id" TEXT NOT NULL,
    "granja_id" TEXT NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "capacidad_aves" INTEGER,
    "notas" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "galpones_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "galpones_granja_id_idx" ON "galpones"("granja_id");

ALTER TABLE "galpones" ADD CONSTRAINT "galpones_granja_id_fkey" FOREIGN KEY ("granja_id") REFERENCES "granjas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Ubicación opcional del lote dentro de la jerarquía — null = lote suelto, como hasta ahora.
ALTER TABLE "lotes_biologicos" ADD COLUMN     "galpon_id" TEXT;

CREATE INDEX "lotes_biologicos_galpon_id_idx" ON "lotes_biologicos"("galpon_id");

ALTER TABLE "lotes_biologicos" ADD CONSTRAINT "lotes_biologicos_galpon_id_fkey" FOREIGN KEY ("galpon_id") REFERENCES "galpones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
