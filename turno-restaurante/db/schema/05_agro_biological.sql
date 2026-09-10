-- =====================================================================
-- OC POS · 05 · AGRO ENGINE — Inventario Vivo y Lotes Biológicos
-- =====================================================================
-- Problema que resuelve: el inventario tradicional asume que una unidad
-- comprada es la misma unidad vendida. En agro NO:
--   · La unidad MUERE (mortalidad) y su costo se redistribuye entre las vivas.
--   · La unidad CONSUME insumos que se capitalizan en su costo (alimento,
--     vacunas, medicina, mano de obra).
--   · La unidad se TRANSFORMA en otra cosa al cosechar/faenar
--     (1,000 pollos vivos -> 950 kg de carne + 120 kg de menudencia).
--   · La unidad PRODUCE a diario sin desaparecer (gallina -> huevos).
--
-- Modelo: un LOTE BIOLOGICO es un centro de costo con dos ledgers paralelos
--   A) app.biological_events  -> poblacion (cuantos animales/plantas hay)
--   B) app.biological_costs   -> dinero acumulado en el lote
-- y una salida: app.harvests -> convierte poblacion+costo en SKU vendibles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Unidad productiva fisica: galpon, corral, estanque, invernadero, potrero
-- Se enlaza a un almacen para que el consumo de insumos descuente stock real.
-- ---------------------------------------------------------------------
CREATE TABLE app.farm_units (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES app.warehouses(id),  -- almacen de insumos de la unidad
  code         text NOT NULL,                       -- 'GALPON-3'
  name         text NOT NULL,
  kind         text NOT NULL DEFAULT 'shed'
               CHECK (kind IN ('shed','pen','pond','greenhouse','paddock','hive','plot','cage')),
  capacity     app.qty,                             -- aves/cerdos/plantas maximas
  area_m2      numeric(12,2),
  -- Atributos dinamicos del perfil agro: {"ventilacion":"tunel","comederos":40}
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------
-- ★ LOTE BIOLOGICO / CAMADA / CRIANZA
-- Ej: "Lote Pollos Galpon 3 - Ingreso 2026-08-01 - 1,000 aves"
-- ---------------------------------------------------------------------
CREATE TABLE app.biological_lots (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES app.branches(id),
  farm_unit_id  uuid REFERENCES app.farm_units(id),
  code          text NOT NULL,                      -- 'POLLO-G3-2026-08'
  name          text NOT NULL,

  -- Que se cria. 'species' es texto libre alimentado por el manifiesto del
  -- perfil (broiler, layer, swine, tilapia, cattle, shrimp, crop...)
  species       text NOT NULL,
  production_kind text NOT NULL DEFAULT 'meat'
                CHECK (production_kind IN ('meat','eggs','milk','breeding','fish','honey','crop','wool')),
  breed         text,                               -- linea genetica: Hy-Line Brown, Cobb 500
  -- Producto 'livestock' que representa el animal vivo (opcional, para
  -- vender animales en pie desde el POS)
  livestock_variant_id uuid REFERENCES app.product_variants(id),

  -- Poblacion
  initial_qty      app.qty NOT NULL CHECK (initial_qty > 0),
  current_qty      app.qty NOT NULL DEFAULT 0,      -- proyeccion de biological_events
  uom_id           uuid NOT NULL REFERENCES app.uoms(id),  -- normalmente UND

  -- Fechas del ciclo
  entry_date       date NOT NULL,
  expected_harvest_date date,
  actual_close_date date,
  -- Duracion del ciclo YA CERRADO. No puede incluir CURRENT_DATE: una
  -- columna generada debe ser inmutable. La edad del lote activo se
  -- calcula en app.v_biological_lot_costing.
  closed_cycle_days int GENERATED ALWAYS AS (actual_close_date - entry_date) STORED,

  -- Costo inicial de la materia prima viva (pollitos BB, alevines, lechones)
  initial_unit_cost app.unit_cost NOT NULL DEFAULT 0,
  supplier_id       uuid,                           -- FK en 06

  -- Metas del lote para alertas automaticas
  -- {"target_fcr":1.65,"max_mortality_pct":5,"target_weight_g":2400,
  --  "target_eggs_per_day":900}
  targets       jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Atributos dinamicos del perfil (galpon, tipo de cama, plan sanitario)
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,

  status        text NOT NULL DEFAULT 'active'
                CHECK (status IN ('planned','active','harvesting','closed','lost')),
  closed_by     uuid REFERENCES app.users(id),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.biological_lots
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE INDEX ON app.biological_lots (tenant_id, status, entry_date DESC);
CREATE INDEX biological_lots_attrs_gin ON app.biological_lots USING gin (attributes jsonb_path_ops);

ALTER TABLE app.inventory_alerts
  ADD CONSTRAINT alerts_biolot_fk
  FOREIGN KEY (biological_lot_id) REFERENCES app.biological_lots(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------
-- ★ LEDGER A: POBLACION (append-only, deltas conmutativos como stock_events)
-- ---------------------------------------------------------------------
CREATE TABLE app.biological_events (
  id            uuid PRIMARY KEY,                   -- generado en cliente (offline)
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES app.biological_lots(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN (
                  'entry',        -- ingreso inicial o reposicion
                  'mortality',    -- baja por muerte
                  'cull',         -- descarte/sacrificio sanitario
                  'theft',        -- robo/depredacion
                  'transfer_out', -- sale hacia otro lote/galpon
                  'transfer_in',
                  'sale_live',    -- venta en pie
                  'harvest',      -- entra a faena/cosecha
                  'adjustment')),
  delta_qty     app.qty NOT NULL CHECK (delta_qty <> 0),  -- + entra, - sale
  -- Causa de la baja: alimenta el reporte sanitario
  cause         text,                               -- 'ascitis','aplastamiento','depredador'
  avg_weight_g  numeric(12,3),                      -- peso promedio del evento
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  ref_type      text,
  ref_id        uuid,
  note          text,
  user_id       uuid REFERENCES app.users(id),
  device_id     uuid REFERENCES app.devices(id),
  sync_seq      bigint
);
CREATE INDEX ON app.biological_events (tenant_id, lot_id, occurred_at DESC);
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.biological_events
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

CREATE OR REPLACE FUNCTION app.tg_apply_biological_event() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE app.biological_lots
     SET current_qty = current_qty + NEW.delta_qty,
         updated_at  = now()
   WHERE id = NEW.lot_id;
  RETURN NEW;
END $fn$;

CREATE TRIGGER apply_population AFTER INSERT ON app.biological_events
  FOR EACH ROW EXECUTE FUNCTION app.tg_apply_biological_event();

-- ---------------------------------------------------------------------
-- ★ LEDGER B: COSTOS IMPUTADOS AL LOTE (append-only)
-- Todo lo que se gasta en el lote se capitaliza aqui. El origen puede ser:
--   · un stock_event de consumo de alimento/medicina (descuenta inventario)
--   · un gasto operativo (mano de obra, luz, gas de calefaccion)
--   · un prorrateo de gastos indirectos
-- ---------------------------------------------------------------------
CREATE TABLE app.biological_costs (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES app.biological_lots(id) ON DELETE CASCADE,
  cost_type     text NOT NULL CHECK (cost_type IN (
                  'livestock',   -- costo de los animales/alevines/semilla
                  'feed',        -- alimento
                  'medicine',    -- vacunas, antibioticos, vitaminas
                  'supplies',    -- cama, gas, desinfectante
                  'labor',       -- mano de obra
                  'utilities',   -- luz, agua
                  'transport',
                  'depreciation',
                  'overhead',    -- prorrateo indirecto
                  'other')),
  -- Si vino de consumo de inventario, se enlaza al evento de stock
  stock_event_id uuid REFERENCES app.stock_events(id),
  variant_id     uuid REFERENCES app.product_variants(id),
  expense_id     uuid,                              -- FK en 06 (gastos operativos)

  qty           app.qty,                            -- cantidad consumida
  uom_id        uuid REFERENCES app.uoms(id),
  unit_cost     app.unit_cost,
  amount        app.money NOT NULL,                 -- SIEMPRE positivo (costo)
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  note          text,
  user_id       uuid REFERENCES app.users(id),
  device_id     uuid REFERENCES app.devices(id),
  sync_seq      bigint
);
CREATE INDEX ON app.biological_costs (tenant_id, lot_id, cost_type);
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.biological_costs
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

-- ---------------------------------------------------------------------
-- REGISTRO DIARIO (la pantalla que el granjero llena en el galpon, offline)
-- Una fila por lote/dia. Es un AGREGADO de conveniencia: al guardarla el
-- backend emite los biological_events y biological_costs correspondientes.
-- ---------------------------------------------------------------------
CREATE TABLE app.biological_daily_records (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  lot_id         uuid NOT NULL REFERENCES app.biological_lots(id) ON DELETE CASCADE,
  record_date    date NOT NULL,
  age_days       int,                               -- edad del lote ese dia

  qty_dead       app.qty NOT NULL DEFAULT 0,
  qty_culled     app.qty NOT NULL DEFAULT 0,
  death_causes   jsonb NOT NULL DEFAULT '{}'::jsonb,-- {"ascitis":3,"aplastamiento":1}

  feed_qty       app.qty NOT NULL DEFAULT 0,        -- en UoM base del alimento (kg)
  feed_variant_id uuid REFERENCES app.product_variants(id),
  water_liters   numeric(12,2),
  avg_weight_g   numeric(12,3),                     -- muestreo de pesaje
  uniformity_pct numeric(5,2),

  -- Produccion diaria (ponedoras, lecheria, apicultura)
  output_qty     app.qty,                           -- 870 huevos / 45 L de leche
  output_variant_id uuid REFERENCES app.product_variants(id),
  output_grade   jsonb NOT NULL DEFAULT '{}'::jsonb,-- {"A":600,"B":220,"rotos":50}

  temperature_c  numeric(5,2),
  humidity_pct   numeric(5,2),
  -- Atributos dinamicos definidos por el perfil agro del tenant
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note           text,

  recorded_by    uuid REFERENCES app.users(id),
  device_id      uuid REFERENCES app.devices(id),
  -- Estado de proyeccion: 'pending' = capturado offline, aun sin generar
  -- los eventos de poblacion/costo en el servidor.
  posting_status text NOT NULL DEFAULT 'pending'
                 CHECK (posting_status IN ('pending','posted','failed','superseded')),
  posted_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, lot_id, record_date)
);
CREATE INDEX ON app.biological_daily_records (tenant_id, lot_id, record_date DESC);

-- ---------------------------------------------------------------------
-- ★ COSECHA / FAENA / RECOLECCION
-- Convierte poblacion viva + costo acumulado en SKU vendibles.
-- Ej: entran 1,000 pollos vivos -> salen 950 kg carne + 90 kg menudencia.
-- ---------------------------------------------------------------------
CREATE TABLE app.harvests (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES app.biological_lots(id),
  code          text NOT NULL,
  harvest_kind  text NOT NULL DEFAULT 'slaughter'
                CHECK (harvest_kind IN ('slaughter','partial','daily_yield','milking',
                                        'egg_collection','crop_harvest','weaning','shearing')),
  harvest_date  date NOT NULL,

  -- Entrada al proceso
  qty_input        app.qty NOT NULL,                -- 1000 aves
  input_weight_kg  numeric(14,3),                   -- 2,450 kg vivos
  -- Salida total (suma de harvest_outputs, denormalizada para reportes)
  output_weight_kg numeric(14,3),
  -- Rendimiento = salida / entrada
  yield_pct     numeric(6,3),

  -- Almacen donde entra el producto terminado
  warehouse_id  uuid NOT NULL REFERENCES app.warehouses(id),
  -- Costo total volcado del lote hacia esta cosecha
  allocated_cost app.money NOT NULL DEFAULT 0,
  -- Metodo de reparto del costo entre las salidas
  allocation_method text NOT NULL DEFAULT 'by_weight'
                CHECK (allocation_method IN ('by_weight','by_market_value','by_qty','manual')),
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','posted','canceled')),
  processed_by  uuid REFERENCES app.users(id),
  note          text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.harvest_outputs (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  harvest_id   uuid NOT NULL REFERENCES app.harvests(id) ON DELETE CASCADE,
  -- SKU comercializable resultante: "Pollo entero kg", "Pechuga kg",
  -- "Cubeta 30 huevos A", "Menudencia kg", "Gallinaza saco"
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  qty          app.qty NOT NULL,
  uom_id       uuid NOT NULL REFERENCES app.uoms(id),
  qty_in_base  app.qty NOT NULL,                    -- convertido a UoM base
  -- Peso/valor usado para prorratear el costo
  allocation_weight numeric(14,4),
  -- Costo unitario resultante = costo asignado / qty_in_base
  -- ESTE es el numero que entra al CPP del producto terminado.
  unit_cost    app.unit_cost NOT NULL DEFAULT 0,
  allocated_cost app.money NOT NULL DEFAULT 0,
  is_byproduct boolean NOT NULL DEFAULT false,
  lot_id       uuid REFERENCES app.inventory_lots(id),  -- lote de trazabilidad creado
  grade        text,                                -- A, B, comercial, exportacion
  stock_event_id uuid REFERENCES app.stock_events(id)
);
CREATE INDEX ON app.harvest_outputs (tenant_id, harvest_id);

-- ---------------------------------------------------------------------
-- Plan sanitario / calendario productivo (vacunas, desparasitacion, riego)
-- ---------------------------------------------------------------------
CREATE TABLE app.biological_schedules (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  lot_id      uuid REFERENCES app.biological_lots(id) ON DELETE CASCADE,
  -- Plantilla reutilizable por especie cuando lot_id es null
  species     text,
  task_type   text NOT NULL CHECK (task_type IN
              ('vaccine','medication','feed_change','weighing','cleaning',
               'inspection','irrigation','fertilization','harvest')),
  name        text NOT NULL,
  day_offset  int NOT NULL,                         -- dias desde entry_date
  variant_id  uuid REFERENCES app.product_variants(id),  -- insumo a aplicar
  qty_per_animal app.qty,
  due_date    date,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','done','skipped','overdue')),
  done_at     timestamptz,
  done_by     uuid REFERENCES app.users(id),
  note        text
);
CREATE INDEX ON app.biological_schedules (tenant_id, lot_id, due_date) WHERE status = 'pending';

-- =====================================================================
-- VISTAS DE COSTEO REAL AGROPECUARIO
-- =====================================================================

-- Costo acumulado por tipo, para el lote
CREATE OR REPLACE VIEW app.v_biological_lot_cost_breakdown AS
SELECT
  c.tenant_id,
  c.lot_id,
  c.cost_type,
  SUM(c.amount)                                              AS amount,
  SUM(c.qty)                                                 AS qty
FROM app.biological_costs c
GROUP BY c.tenant_id, c.lot_id, c.cost_type;

-- ★ Tablero de costeo del lote: costo total, costo por animal vivo,
--   mortalidad, conversion alimenticia (FCR) y costo por kg producido.
CREATE OR REPLACE VIEW app.v_biological_lot_costing AS
WITH pop AS (
  SELECT lot_id,
         SUM(CASE WHEN event_type IN ('entry','transfer_in') THEN delta_qty ELSE 0 END) AS qty_in,
         SUM(CASE WHEN event_type = 'mortality' THEN -delta_qty ELSE 0 END)             AS qty_dead,
         SUM(CASE WHEN event_type = 'cull'      THEN -delta_qty ELSE 0 END)             AS qty_culled,
         SUM(CASE WHEN event_type = 'harvest'   THEN -delta_qty ELSE 0 END)             AS qty_harvested
    FROM app.biological_events
   GROUP BY lot_id
),
cost AS (
  SELECT lot_id,
         SUM(amount)                                                        AS total_cost,
         SUM(amount) FILTER (WHERE cost_type = 'feed')                      AS feed_cost,
         SUM(qty)    FILTER (WHERE cost_type = 'feed')                      AS feed_qty_kg,
         SUM(amount) FILTER (WHERE cost_type = 'medicine')                  AS medicine_cost,
         SUM(amount) FILTER (WHERE cost_type = 'livestock')                 AS livestock_cost,
         SUM(amount) FILTER (WHERE cost_type IN ('labor','utilities','supplies',
                                                 'transport','depreciation','overhead','other'))
                                                                            AS opex_cost
    FROM app.biological_costs
   GROUP BY lot_id
),
out AS (
  -- OJO: el peso de salida vive en la CABECERA de la faena. Sumarlo tras un
  -- JOIN con las líneas lo multiplicaría por el número de productos
  -- obtenidos (1900 kg pasarían a 3800 con dos salidas), y el FCR saldría
  -- exactamente a la mitad. Las líneas se agregan aparte, con LATERAL.
  SELECT h.lot_id,
         SUM(o.qty)                                                         AS output_qty,
         SUM(h.output_weight_kg)                                            AS output_kg
    FROM app.harvests h
    LEFT JOIN LATERAL (
      SELECT SUM(ho.qty_in_base) AS qty
        FROM app.harvest_outputs ho
       WHERE ho.harvest_id = h.id
    ) o ON true
   WHERE h.status = 'posted'
   GROUP BY h.lot_id
)
SELECT
  l.tenant_id,
  l.id                                        AS lot_id,
  l.code,
  l.name,
  l.species,
  l.production_kind,
  l.status,
  l.entry_date,
  COALESCE(l.actual_close_date, CURRENT_DATE) - l.entry_date AS cycle_days,
  l.initial_qty,
  l.current_qty,
  COALESCE(p.qty_dead, 0)                     AS qty_dead,
  COALESCE(p.qty_culled, 0)                   AS qty_culled,
  -- Mortalidad acumulada %
  ROUND(100 * (COALESCE(p.qty_dead,0) + COALESCE(p.qty_culled,0))
        / NULLIF(COALESCE(p.qty_in, l.initial_qty), 0), 3)   AS mortality_pct,

  COALESCE(c.livestock_cost,0)                AS livestock_cost,
  COALESCE(c.feed_cost,0)                     AS feed_cost,
  COALESCE(c.medicine_cost,0)                 AS medicine_cost,
  COALESCE(c.opex_cost,0)                     AS opex_cost,
  COALESCE(c.total_cost,0)                    AS total_cost,

  -- ★ Costo unitario del animal VIVO hoy. Sube automaticamente con cada
  --   muerte porque el denominador baja pero el costo ya gastado se queda.
  ROUND(COALESCE(c.total_cost,0) / NULLIF(l.current_qty,0), 6)  AS cost_per_live_unit,

  -- ★ Conversion alimenticia (FCR) = kg alimento / kg producidos
  ROUND(COALESCE(c.feed_qty_kg,0) / NULLIF(o.output_kg,0), 4)   AS fcr,

  COALESCE(o.output_qty,0)                    AS output_qty,
  COALESCE(o.output_kg,0)                     AS output_kg,
  -- ★ Costo real por kg/unidad producida (el numero que define el precio)
  ROUND(COALESCE(c.total_cost,0) / NULLIF(o.output_kg,0), 6)    AS cost_per_output_kg,
  ROUND(COALESCE(c.total_cost,0) / NULLIF(o.output_qty,0), 6)   AS cost_per_output_unit
FROM app.biological_lots l
LEFT JOIN pop  p ON p.lot_id = l.id
LEFT JOIN cost c ON c.lot_id = l.id
LEFT JOIN out  o ON o.lot_id = l.id;

-- Curva diaria: mortalidad, consumo y peso para graficar contra el estandar
CREATE OR REPLACE VIEW app.v_biological_daily_kpi AS
SELECT
  d.tenant_id,
  d.lot_id,
  d.record_date,
  d.age_days,
  d.qty_dead + d.qty_culled                                     AS losses,
  d.feed_qty,
  d.avg_weight_g,
  d.output_qty,
  SUM(d.qty_dead + d.qty_culled) OVER w                         AS cum_losses,
  SUM(d.feed_qty)                OVER w                         AS cum_feed,
  ROUND(100 * SUM(d.qty_dead + d.qty_culled) OVER w
        / NULLIF(l.initial_qty,0), 3)                           AS cum_mortality_pct,
  -- FCR parcial estimado con peso vivo del muestreo
  ROUND(SUM(d.feed_qty) OVER w
        / NULLIF((d.avg_weight_g/1000.0) * l.current_qty, 0), 4) AS fcr_estimate
FROM app.biological_daily_records d
JOIN app.biological_lots l ON l.id = d.lot_id
WINDOW w AS (PARTITION BY d.lot_id ORDER BY d.record_date
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW);
