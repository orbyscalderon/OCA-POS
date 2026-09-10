-- =====================================================================
-- OC POS · 04 · Catálogo dinámico (JSONB) + Ledger de Inventario
-- =====================================================================
-- Aqui vive el diferenciador: los ATRIBUTOS DINAMICOS. Un vape shop y una
-- farmacia usan LA MISMA tabla app.products; lo que cambia es
-- app.attribute_definitions (sembrado por el Engine de Nicho) y el
-- contenido de products.attributes / variants.attributes (JSONB).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Definicion de atributos dinamicos.
-- Origen 'profile'  -> sembrado desde el manifiesto del perfil de negocio.
-- Origen 'tenant'   -> creado a mano por el dueno del negocio.
-- El frontend renderiza formularios y filtros LEYENDO esta tabla; no hay
-- ni un solo campo hardcodeado de nicho en el codigo de UI.
-- ---------------------------------------------------------------------
CREATE TABLE app.attribute_definitions (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  -- A que entidad se le pega el atributo
  scope         text NOT NULL
                CHECK (scope IN ('product','variant','inventory_lot','customer','biological_daily',
                                 'supplier','biological_lot','service_order','employee')),
  -- Si es null aplica a todo el scope; si no, solo a esa categoria
  category_id   uuid,
  key           text NOT NULL,                     -- 'nicotine_mg', 'expiry_date', 'galpon'
  label         text NOT NULL,                     -- 'Nivel de nicotina'
  help_text     text,
  data_type     text NOT NULL
                CHECK (data_type IN ('text','number','integer','boolean','date','datetime',
                                     'enum','multi_enum','money','percent','uuid_ref','file')),
  -- Widget sugerido al frontend: select, chips, stepper, date_picker, toggle...
  ui_widget     text NOT NULL DEFAULT 'text',
  ui_group      text,                              -- agrupa campos en pestanas/acordeones
  unit_suffix   text,                              -- 'mg', 'ml', 'puffs', 'g'
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,-- [{"value":"3","label":"3 mg"}, ...]
  -- Validacion declarativa que se compila a Zod (front) y Pydantic/Valibot (back)
  -- {"required":true,"min":0,"max":50,"regex":"...","unique":false}
  validation    jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_value jsonb,

  is_required    boolean NOT NULL DEFAULT false,
  -- Genera combinaciones de SKU (color/sabor/talla). Solo scope='variant'.
  is_variant_axis boolean NOT NULL DEFAULT false,
  is_filterable  boolean NOT NULL DEFAULT false,   -- aparece como filtro en POS/tienda
  show_in_pos    boolean NOT NULL DEFAULT false,   -- se muestra en la tarjeta del POS
  show_in_receipt boolean NOT NULL DEFAULT false,  -- se imprime en el ticket
  show_in_storefront boolean NOT NULL DEFAULT true,
  -- Dispara comportamiento del sistema, no solo dato: 'expiry' activa alertas
  -- de caducidad, 'batch' activa trazabilidad por lote, 'weight' pesaje.
  semantic_role text CHECK (semantic_role IN
                ('expiry','batch','serial','weight','volume','potency','origin','warranty')),
  position      smallint NOT NULL DEFAULT 0,
  source        text NOT NULL DEFAULT 'tenant' CHECK (source IN ('profile','tenant')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, category_id, key)
);
CREATE INDEX ON app.attribute_definitions (tenant_id, scope) WHERE is_active;

-- ---------------------------------------------------------------------
-- Categorias (arbol) -- tambien sembradas por el perfil
-- ---------------------------------------------------------------------
CREATE TABLE app.categories (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES app.categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  slug        text NOT NULL,
  color       text,
  icon        text,
  path        text,                                -- materialized path: 'bebidas/gaseosas'
  tax_group_id uuid,                               -- impuesto por defecto (FK en 10)
  position    smallint NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, slug)
);

ALTER TABLE app.attribute_definitions
  ADD CONSTRAINT attrdef_category_fk
  FOREIGN KEY (category_id) REFERENCES app.categories(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- PRODUCTOS
-- ---------------------------------------------------------------------
CREATE TABLE app.products (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  category_id   uuid REFERENCES app.categories(id) ON DELETE SET NULL,
  -- 'good'        producto fisico con stock
  -- 'service'     corte de cabello, consulta (sin stock)
  -- 'combo'       paquete que descuenta sus componentes
  -- 'raw_material'insumo de produccion (alimento, vacuna) no vendible
  -- 'livestock'   animal vivo gestionado por lote biologico (Agro Engine)
  -- 'fee'         cargo/recargo (delivery, propina, interes)
  kind          text NOT NULL DEFAULT 'good'
                CHECK (kind IN ('good','service','combo','raw_material','livestock','fee')),
  sku_root      text,
  name          text NOT NULL,
  short_name    text,                              -- para ticket de 58mm
  description   text,
  brand         text,
  image_urls    text[] NOT NULL DEFAULT '{}',

  base_uom_id   uuid NOT NULL REFERENCES app.uoms(id),
  tax_group_id  uuid,                              -- FK en 10_tax_fiscal

  -- Banderas de comportamiento, ENCENDIDAS POR EL PERFIL DE NEGOCIO
  track_inventory boolean NOT NULL DEFAULT true,
  track_lots      boolean NOT NULL DEFAULT false,  -- farmacia, agro, alimentos
  track_expiry    boolean NOT NULL DEFAULT false,
  track_serials   boolean NOT NULL DEFAULT false,  -- electronica, mods de vape
  is_weighted     boolean NOT NULL DEFAULT false,  -- se vende por peso de balanza
  allow_negative_stock boolean NOT NULL DEFAULT false,
  is_sellable     boolean NOT NULL DEFAULT true,
  is_purchasable  boolean NOT NULL DEFAULT true,
  requires_prescription boolean NOT NULL DEFAULT false,
  age_restricted  boolean NOT NULL DEFAULT false,  -- vapes, alcohol

  -- ATRIBUTOS DINAMICOS: el payload cuya forma define el nicho.
  -- Vape:    {"nicotine_mg":50,"puffs":8000,"volume_ml":16,"flavor":"Mango Ice"}
  -- Farmacia:{"registro_sanitario":"ABC-123","principio_activo":"Ibuprofeno"}
  -- Granja:  {"especie":"gallina","linea_genetica":"Hy-Line Brown","etapa":"postura"}
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Reposicion (alimenta el motor de prediccion, ver 06)
  reorder_point   app.qty,
  reorder_qty     app.qty,
  lead_time_days  smallint,
  shelf_life_days smallint,

  is_active     boolean NOT NULL DEFAULT true,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER touch BEFORE UPDATE ON app.products
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

-- Indice GIN: permite filtrar por CUALQUIER atributo dinamico sin migracion.
--   WHERE attributes @> '{"nicotine_mg":50}'
CREATE INDEX products_attributes_gin ON app.products USING gin (attributes jsonb_path_ops);
CREATE INDEX products_name_trgm ON app.products USING gin (name gin_trgm_ops);
CREATE INDEX ON app.products (tenant_id, category_id) WHERE is_active;

ALTER TABLE app.uom_conversions
  ADD CONSTRAINT uomconv_product_fk
  FOREIGN KEY (product_id) REFERENCES app.products(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- VARIANTES (SKU real que se vende y se stockea)
-- Todo producto tiene >=1 variante, incluso si el negocio no usa variantes:
-- se crea una "variante por defecto" invisible en la UI de POS Rapido.
-- ---------------------------------------------------------------------
CREATE TABLE app.product_variants (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES app.products(id) ON DELETE CASCADE,
  sku          text NOT NULL,
  barcode      text,
  name         text,                               -- 'Mango Ice / 50mg'
  -- Valores de los ejes de variante (attribute_definitions.is_variant_axis)
  -- {"flavor":"Mango Ice","nicotine_mg":50}
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,

  price        app.money NOT NULL DEFAULT 0,       -- precio de lista (canal POS)
  compare_at_price app.money,                      -- precio tachado en tienda
  min_price    app.money,                          -- piso: el POS bloquea vender por debajo
  -- Costo de referencia manual; el REAL se calcula por CPP en variant_costs
  default_cost app.unit_cost NOT NULL DEFAULT 0,

  weight_grams numeric(12,3),
  image_url    text,
  position     smallint NOT NULL DEFAULT 0,
  is_default   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.product_variants
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE UNIQUE INDEX variants_barcode_uniq
  ON app.product_variants (tenant_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX variants_attributes_gin
  ON app.product_variants USING gin (attributes jsonb_path_ops);

ALTER TABLE app.product_packagings
  ADD CONSTRAINT packaging_variant_fk
  FOREIGN KEY (variant_id) REFERENCES app.product_variants(id) ON DELETE CASCADE;

-- Componentes de combos / recetas simples (un plato descuenta sus insumos)
CREATE TABLE app.product_components (
  id                uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id         uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  parent_variant_id uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  child_variant_id  uuid NOT NULL REFERENCES app.product_variants(id),
  qty_in_base       app.qty NOT NULL,
  is_optional       boolean NOT NULL DEFAULT false,
  UNIQUE (parent_variant_id, child_variant_id)
);

-- ---------------------------------------------------------------------
-- Listas de precio por canal (POS, tienda online, mayorista, delivery)
-- ---------------------------------------------------------------------
CREATE TABLE app.price_lists (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  channel    text NOT NULL DEFAULT 'pos'
             CHECK (channel IN ('pos','storefront','wholesale','delivery','all')),
  currency_code char(3),
  is_default boolean NOT NULL DEFAULT false,
  valid_from timestamptz,
  valid_to   timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.price_list_items (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  price_list_id uuid NOT NULL REFERENCES app.price_lists(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  price         app.money NOT NULL,
  min_qty       app.qty NOT NULL DEFAULT 1,        -- descuento por volumen
  UNIQUE (price_list_id, variant_id, min_qty)
);

-- ---------------------------------------------------------------------
-- LOTES DE INVENTARIO (trazabilidad: farmacia, alimentos, agroinsumos)
-- Distinto de los LOTES BIOLOGICOS del Agro Engine (ver 05).
-- ---------------------------------------------------------------------
CREATE TABLE app.inventory_lots (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  lot_code     text NOT NULL,
  expiry_date  date,
  mfg_date     date,
  supplier_id  uuid,                               -- FK en 06
  unit_cost    app.unit_cost NOT NULL DEFAULT 0,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb, -- registro sanitario, temperatura, etc.
  is_blocked   boolean NOT NULL DEFAULT false,     -- cuarentena / retiro de mercado
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, variant_id, lot_code)
);
CREATE INDEX ON app.inventory_lots (tenant_id, expiry_date)
  WHERE expiry_date IS NOT NULL AND NOT is_blocked;

CREATE TABLE app.serials (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  serial_no   text NOT NULL,
  status      text NOT NULL DEFAULT 'in_stock'
              CHECK (status IN ('in_stock','sold','returned','defective','in_repair')),
  warehouse_id uuid REFERENCES app.warehouses(id),
  sale_line_id uuid,
  warranty_until date,
  UNIQUE (tenant_id, variant_id, serial_no)
);

-- =====================================================================
-- ★ STOCK_EVENTS — LEDGER APPEND-ONLY. Fuente unica de verdad.
-- ---------------------------------------------------------------------
-- POR QUE UN LEDGER Y NO UNA COLUMNA "cantidad":
--   1) Offline-first: dos cajas venden sin internet el mismo producto.
--      Los eventos son DELTAS y la suma es CONMUTATIVA -> se fusionan sin
--      conflicto al sincronizar (semantica CRDT de contador PN).
--      Nunca se hace "UPDATE stock SET qty = 5" (last-write-wins = perdida).
--   2) Auditoria: cada unidad que entra o sale tiene autor, motivo y origen.
--   3) Costeo: el CPP se recalcula reproduciendo el ledger.
-- =====================================================================
CREATE TABLE app.stock_events (
  -- id generado en el CLIENTE (uuid v7) -> idempotencia natural en el sync
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id),
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  lot_id       uuid REFERENCES app.inventory_lots(id),

  -- Delta SIEMPRE en UoM base del producto. + entra, - sale.
  delta_qty    app.qty NOT NULL CHECK (delta_qty <> 0),
  -- Costo unitario de ESTA entrada (solo en delta_qty > 0)
  unit_cost    app.unit_cost,
  -- CPP vigente al momento de la salida -> congela el COGS de la venta
  cogs_unit_cost app.unit_cost,

  reason       text NOT NULL CHECK (reason IN (
                 'purchase','sale','sale_return','purchase_return','adjustment',
                 'transfer_out','transfer_in','initial','production_input',
                 'production_output','mortality','scrap','expiry','count',
                 'consumption','sample','theft')),
  -- Documento que lo origino (polimorfico y sin FK dura, para no acoplar)
  ref_type     text,                               -- 'sale','purchase_order','biological_lot'...
  ref_id       uuid,
  ref_line_id  uuid,

  note         text,
  -- Trazabilidad antirrobo
  user_id      uuid REFERENCES app.users(id),
  device_id    uuid REFERENCES app.devices(id),
  -- occurred_at = hora real del hecho (puede ser offline, en el pasado)
  -- recorded_at = hora en que el servidor lo acepto
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  -- Reloj logico global del tenant para el pull incremental del sync
  sync_seq     bigint
);

CREATE INDEX ON app.stock_events (tenant_id, variant_id, warehouse_id, occurred_at DESC);
CREATE INDEX ON app.stock_events (tenant_id, ref_type, ref_id);
CREATE INDEX ON app.stock_events (tenant_id, sync_seq);

CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.stock_events
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

-- ---------------------------------------------------------------------
-- Proyeccion materializada del ledger. Se lee en el POS (rapido);
-- se puede reconstruir 100% desde stock_events en cualquier momento.
-- ---------------------------------------------------------------------
CREATE TABLE app.stock_balances (
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  lot_id       uuid REFERENCES app.inventory_lots(id) ON DELETE CASCADE,
  -- Una PRIMARY KEY implica NOT NULL, y la mayoria de los productos NO
  -- llevan lote. Se deriva una clave con centinela para que "sin lote" sea
  -- una fila legitima y el upsert tenga un target de ON CONFLICT estable.
  lot_key      uuid GENERATED ALWAYS AS
               (COALESCE(lot_id, '00000000-0000-0000-0000-000000000000'::uuid)) STORED,
  qty_on_hand  app.qty NOT NULL DEFAULT 0,
  qty_reserved app.qty NOT NULL DEFAULT 0,         -- pedidos online sin despachar
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, variant_id, lot_key)
);

-- ---------------------------------------------------------------------
-- COSTO PROMEDIO PONDERADO (CPP) por variante, a nivel empresa.
-- Se actualiza en cada entrada; se congela en cada salida.
-- ---------------------------------------------------------------------
CREATE TABLE app.variant_costs (
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id  uuid PRIMARY KEY REFERENCES app.product_variants(id) ON DELETE CASCADE,
  avg_cost    app.unit_cost NOT NULL DEFAULT 0,
  last_cost   app.unit_cost NOT NULL DEFAULT 0,
  qty_on_hand app.qty NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Trigger unico que mantiene saldos + CPP a partir del ledger.
CREATE OR REPLACE FUNCTION app.tg_apply_stock_event() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_qty  app.qty;
  v_avg  app.unit_cost;
BEGIN
  -- 1) Saldo por almacen/lote
  INSERT INTO app.stock_balances (tenant_id, warehouse_id, variant_id, lot_id, qty_on_hand)
  VALUES (NEW.tenant_id, NEW.warehouse_id, NEW.variant_id, NEW.lot_id, NEW.delta_qty)
  ON CONFLICT (warehouse_id, variant_id, lot_key) DO UPDATE
    SET qty_on_hand = app.stock_balances.qty_on_hand + EXCLUDED.qty_on_hand,
        updated_at  = now();

  -- 2) Costo promedio ponderado
  SELECT qty_on_hand, avg_cost INTO v_qty, v_avg
    FROM app.variant_costs WHERE variant_id = NEW.variant_id FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO app.variant_costs (tenant_id, variant_id, avg_cost, last_cost, qty_on_hand)
    VALUES (NEW.tenant_id, NEW.variant_id,
            COALESCE(NEW.unit_cost, 0), COALESCE(NEW.unit_cost, 0),
            GREATEST(NEW.delta_qty, 0));
    RETURN NEW;
  END IF;

  IF NEW.delta_qty > 0 AND NEW.unit_cost IS NOT NULL THEN
    -- CPP = (valor existente + valor entrante) / cantidad total
    IF (v_qty + NEW.delta_qty) > 0 THEN
      v_avg := ((GREATEST(v_qty,0) * v_avg) + (NEW.delta_qty * NEW.unit_cost))
               / (GREATEST(v_qty,0) + NEW.delta_qty);
    ELSE
      v_avg := NEW.unit_cost;
    END IF;
    UPDATE app.variant_costs
       SET avg_cost = v_avg, last_cost = NEW.unit_cost,
           qty_on_hand = v_qty + NEW.delta_qty, updated_at = now()
     WHERE variant_id = NEW.variant_id;
  ELSE
    UPDATE app.variant_costs
       SET qty_on_hand = v_qty + NEW.delta_qty, updated_at = now()
     WHERE variant_id = NEW.variant_id;
  END IF;

  RETURN NEW;
END $fn$;

CREATE TRIGGER apply_stock AFTER INSERT ON app.stock_events
  FOR EACH ROW EXECUTE FUNCTION app.tg_apply_stock_event();

-- ---------------------------------------------------------------------
-- Transferencias entre almacenes/sucursales (con almacen de transito)
-- ---------------------------------------------------------------------
CREATE TABLE app.stock_transfers (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES app.warehouses(id),
  to_warehouse_id   uuid NOT NULL REFERENCES app.warehouses(id),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','in_transit','received','partially_received','canceled')),
  sent_by       uuid REFERENCES app.users(id),
  received_by   uuid REFERENCES app.users(id),
  sent_at       timestamptz,
  received_at   timestamptz,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE TABLE app.stock_transfer_lines (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  transfer_id uuid NOT NULL REFERENCES app.stock_transfers(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES app.product_variants(id),
  lot_id      uuid REFERENCES app.inventory_lots(id),
  qty_sent    app.qty NOT NULL,
  qty_received app.qty,
  discrepancy_note text
);

-- ---------------------------------------------------------------------
-- Conteo fisico / inventario ciclico
-- ---------------------------------------------------------------------
CREATE TABLE app.stock_counts (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','counting','review','applied','canceled')),
  started_by   uuid REFERENCES app.users(id),
  approved_by  uuid REFERENCES app.users(id),
  started_at   timestamptz NOT NULL DEFAULT now(),
  applied_at   timestamptz
);

CREATE TABLE app.stock_count_lines (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  count_id    uuid NOT NULL REFERENCES app.stock_counts(id) ON DELETE CASCADE,
  variant_id  uuid NOT NULL REFERENCES app.product_variants(id),
  lot_id      uuid REFERENCES app.inventory_lots(id),
  qty_system  app.qty NOT NULL,                    -- foto del saldo al abrir
  qty_counted app.qty,
  variance    app.qty GENERATED ALWAYS AS (COALESCE(qty_counted,0) - qty_system) STORED,
  counted_by  uuid REFERENCES app.users(id),
  counted_at  timestamptz
);

-- ---------------------------------------------------------------------
-- Alertas de inventario (stock minimo, caducidad, insumo critico)
-- ---------------------------------------------------------------------
CREATE TABLE app.inventory_alerts (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN
               ('low_stock','out_of_stock','near_expiry','expired','overstock',
                'critical_input','high_mortality','fcr_deviation')),
  severity     text NOT NULL DEFAULT 'warning' CHECK (severity IN ('info','warning','critical')),
  variant_id   uuid REFERENCES app.product_variants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES app.warehouses(id) ON DELETE CASCADE,
  lot_id       uuid REFERENCES app.inventory_lots(id) ON DELETE CASCADE,
  biological_lot_id uuid,                          -- FK en 05
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','acknowledged','resolved','snoozed')),
  snoozed_until timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX ON app.inventory_alerts (tenant_id, status, severity);
