-- CreateTable: licencias de activación de la app de escritorio (Electron + Postgres embebido)
CREATE TABLE "licencias" (
    "id" TEXT NOT NULL,
    "clave" VARCHAR(40) NOT NULL,
    "plan" VARCHAR(20) NOT NULL DEFAULT 'basico',
    "vencimiento" TIMESTAMP(3),
    "funciones_extra" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "huella_maquina" VARCHAR(100),
    "activada_en" TIMESTAMP(3),
    "revocada" BOOLEAN NOT NULL DEFAULT false,
    "negocio_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "licencias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "licencias_clave_key" ON "licencias"("clave");

-- CreateIndex
CREATE INDEX "licencias_clave_idx" ON "licencias"("clave");
