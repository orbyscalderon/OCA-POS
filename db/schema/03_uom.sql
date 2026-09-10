-- =====================================================================
-- OC POS · 03 · Unidades de Medida Multi-Dimensionales
-- ---------------------------------------------------------------------
-- Requisito agro/abarrotes: comprar en TONELADAS, consumir en KILOS,
-- vender en SACOS o por peso variable leido de balanza.
--
-- Modelo en 3 capas:
--   1) app.uoms            -> unidad canonica con factor a la base de su
--                             dimension (weight->kg, volume->L, unit->und)
--   2) app.uom_conversions -> conversiones ESPECIFICAS por producto
--                             (1 saco de alimento X = 45.36 kg; densidad)
--   3) app.product_packagings -> presentaciones vendibles con su codigo de
--                             barras propio (cubeta de 30 huevos, caja x24)
--
-- REGLA DE ORO: TODO el ledger de stock (app.stock_events) se almacena en
-- la UoM BASE del producto. La conversion ocurre en el borde (POS, compra).
-- =====================================================================

CREATE TABLE app.uoms (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,                       -- KG, LB, QQ, G, L, ML, UND, DOC, SACO, CUBETA, CAJA
  name        text NOT NULL,
  plural_name text,
  dimension   text NOT NULL
              CHECK (dimension IN ('unit','weight','volume','length','area','time')),
  -- Factor hacia la unidad base de la dimension.
  -- weight base = KG  -> LB = 0.45359237, QQ (quintal metrico) = 46
  -- volume base = L   -> ML = 0.001
  -- unit   base = UND -> DOC = 12, CUBETA(30 huevos) = 30
  factor_to_base numeric(20,10) NOT NULL CHECK (factor_to_base > 0),
  is_base     boolean NOT NULL DEFAULT false,
  -- Decimales admitidos al capturar cantidades en esta unidad
  precision   smallint NOT NULL DEFAULT 2,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);
CREATE UNIQUE INDEX uoms_one_base_per_dimension
  ON app.uoms (tenant_id, dimension) WHERE is_base;

-- Conversiones no lineales o especificas de un producto: el factor generico
-- no sirve porque "1 saco" pesa distinto segun la marca de alimento, y
-- "1 quintal de pollo vivo" rinde distinto que "1 quintal de pollo procesado".
CREATE TABLE app.uom_conversions (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL,                       -- FK declarada en 04
  from_uom_id uuid NOT NULL REFERENCES app.uoms(id),
  to_uom_id   uuid NOT NULL REFERENCES app.uoms(id),
  factor      numeric(20,10) NOT NULL CHECK (factor > 0),
  note        text,
  UNIQUE (tenant_id, product_id, from_uom_id, to_uom_id)
);

-- Resolucion de factor: primero conversion especifica del producto,
-- si no existe, factor canonico dentro de la misma dimension.
CREATE OR REPLACE FUNCTION app.uom_factor(
  p_product_id uuid, p_from uuid, p_to uuid
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  v_factor numeric;
  v_from   app.uoms%ROWTYPE;
  v_to     app.uoms%ROWTYPE;
BEGIN
  IF p_from = p_to THEN RETURN 1; END IF;

  SELECT factor INTO v_factor FROM app.uom_conversions
   WHERE product_id = p_product_id AND from_uom_id = p_from AND to_uom_id = p_to;
  IF FOUND THEN RETURN v_factor; END IF;

  SELECT 1/factor INTO v_factor FROM app.uom_conversions
   WHERE product_id = p_product_id AND from_uom_id = p_to AND to_uom_id = p_from;
  IF FOUND THEN RETURN v_factor; END IF;

  SELECT * INTO v_from FROM app.uoms WHERE id = p_from;
  SELECT * INTO v_to   FROM app.uoms WHERE id = p_to;
  IF v_from.dimension IS DISTINCT FROM v_to.dimension THEN
    RAISE EXCEPTION 'Conversion imposible % -> %: dimensiones distintas y sin regla de producto',
      v_from.code, v_to.code USING ERRCODE = 'data_exception';
  END IF;
  RETURN v_from.factor_to_base / v_to.factor_to_base;
END $fn$;

-- ---------------------------------------------------------------------
-- Presentaciones / empaques vendibles.
-- Cada una tiene su propio codigo de barras y precio, pero descuenta del
-- MISMO saldo en UoM base. Vender 1 caja de 24 refrescos descuenta 24 und.
-- ---------------------------------------------------------------------
CREATE TABLE app.product_packagings (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL,                      -- FK declarada en 04
  code         text NOT NULL,                      -- UNIDAD, PAQUETE_6, CAJA_24, CUBETA_30
  name         text NOT NULL,
  uom_id       uuid NOT NULL REFERENCES app.uoms(id),
  -- Cuantas UoM BASE contiene esta presentacion
  qty_in_base  app.qty NOT NULL CHECK (qty_in_base > 0),
  barcode      text,
  price        app.money,                          -- si null, se calcula qty_in_base * precio base
  is_default_sale     boolean NOT NULL DEFAULT false,
  is_default_purchase boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, variant_id, code)
);
CREATE UNIQUE INDEX packagings_barcode_uniq
  ON app.product_packagings (tenant_id, barcode) WHERE barcode IS NOT NULL;

-- ---------------------------------------------------------------------
-- Balanzas: codigos de barras de peso/precio embebido (EAN-13 prefijo 2x).
-- Ej. 2 002001 01250 4 -> producto 002001, precio 12.50
-- Cada pais/balanza usa un layout distinto: se parametriza por tenant.
-- ---------------------------------------------------------------------
CREATE TABLE app.scale_barcode_rules (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  prefix      text NOT NULL,                       -- '20','21','22'
  total_len   smallint NOT NULL DEFAULT 13,
  code_start  smallint NOT NULL,                   -- posicion 1-based
  code_len    smallint NOT NULL,
  value_start smallint NOT NULL,
  value_len   smallint NOT NULL,
  -- Que representa el valor embebido
  value_kind  text NOT NULL CHECK (value_kind IN ('price','weight_kg','weight_g','units')),
  value_decimals smallint NOT NULL DEFAULT 2,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, prefix)
);
