-- =====================================================================
-- OC POS · 06 · Proveedores, Compras, CXP, Gastos y Reabastecimiento
-- =====================================================================

CREATE TABLE app.suppliers (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text,
  name          text NOT NULL,
  legal_name    text,
  tax_id        text,
  phone_e164    text,
  whatsapp_e164 text,
  email         citext,
  address       text,
  payment_terms_days smallint NOT NULL DEFAULT 0,   -- 0 = contado
  credit_limit  app.money,
  currency_code char(3),
  -- Categoria de suministro; en agro distingue 'feed','vet','genetics'
  supplier_kind text NOT NULL DEFAULT 'general',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX ON app.suppliers USING gin (name gin_trgm_ops);

ALTER TABLE app.inventory_lots
  ADD CONSTRAINT invlot_supplier_fk FOREIGN KEY (supplier_id) REFERENCES app.suppliers(id);
ALTER TABLE app.biological_lots
  ADD CONSTRAINT biolot_supplier_fk FOREIGN KEY (supplier_id) REFERENCES app.suppliers(id);

-- Historial de precios de compra por proveedor (para sugerir el mas barato)
CREATE TABLE app.supplier_products (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  supplier_id  uuid NOT NULL REFERENCES app.suppliers(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  supplier_sku text,
  last_cost    app.unit_cost,
  purchase_uom_id uuid REFERENCES app.uoms(id),     -- compra en TON, stock en KG
  min_order_qty app.qty,
  lead_time_days smallint,
  UNIQUE (tenant_id, supplier_id, variant_id)
);

-- ---------------------------------------------------------------------
-- ORDENES DE COMPRA
-- ---------------------------------------------------------------------
CREATE TABLE app.purchase_orders (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES app.branches(id),
  warehouse_id  uuid NOT NULL REFERENCES app.warehouses(id),
  supplier_id   uuid NOT NULL REFERENCES app.suppliers(id),
  code          text NOT NULL,
  status        text NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','sent','confirmed','partially_received',
                                  'received','billed','canceled')),
  -- 'auto' = generada por el motor de reabastecimiento
  origin        text NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual','auto','reorder_rule')),
  expected_at   date,
  currency_code char(3),
  exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
  subtotal      app.money NOT NULL DEFAULT 0,
  tax_total     app.money NOT NULL DEFAULT 0,
  discount_total app.money NOT NULL DEFAULT 0,
  freight_total app.money NOT NULL DEFAULT 0,
  total         app.money NOT NULL DEFAULT 0,
  note          text,
  created_by    uuid REFERENCES app.users(id),
  approved_by   uuid REFERENCES app.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

CREATE TABLE app.purchase_order_lines (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  po_id        uuid NOT NULL REFERENCES app.purchase_orders(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  -- Se compra en la UoM del proveedor y se convierte a base al recibir
  qty_ordered  app.qty NOT NULL,
  uom_id       uuid NOT NULL REFERENCES app.uoms(id),
  qty_in_base  app.qty NOT NULL,
  qty_received app.qty NOT NULL DEFAULT 0,
  unit_cost    app.unit_cost NOT NULL,
  discount_pct app.rate NOT NULL DEFAULT 0,
  tax_group_id uuid,
  line_total   app.money NOT NULL DEFAULT 0,
  -- Si el insumo se destina directo a un lote biologico, se imputa alli
  biological_lot_id uuid REFERENCES app.biological_lots(id),
  lot_code     text,
  expiry_date  date,
  position     smallint NOT NULL DEFAULT 0
);
CREATE INDEX ON app.purchase_order_lines (tenant_id, po_id);

-- Recepciones parciales -> generan stock_events reason='purchase'
CREATE TABLE app.purchase_receipts (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  po_id        uuid REFERENCES app.purchase_orders(id),
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id),
  code         text NOT NULL,
  received_by  uuid REFERENCES app.users(id),
  received_at  timestamptz NOT NULL DEFAULT now(),
  note         text,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.purchase_receipt_lines (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  receipt_id   uuid NOT NULL REFERENCES app.purchase_receipts(id) ON DELETE CASCADE,
  po_line_id   uuid REFERENCES app.purchase_order_lines(id),
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  qty_in_base  app.qty NOT NULL,
  unit_cost    app.unit_cost NOT NULL,
  lot_id       uuid REFERENCES app.inventory_lots(id),
  stock_event_id uuid REFERENCES app.stock_events(id)
);

-- ---------------------------------------------------------------------
-- ★ CUENTAS POR PAGAR (CXP)
-- ---------------------------------------------------------------------
CREATE TABLE app.supplier_bills (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid REFERENCES app.branches(id),
  supplier_id   uuid NOT NULL REFERENCES app.suppliers(id),
  po_id         uuid REFERENCES app.purchase_orders(id),
  bill_number   text NOT NULL,                      -- numero de factura del proveedor
  fiscal_number text,                               -- NCF/CFDI recibido (credito fiscal)
  issue_date    date NOT NULL,
  due_date      date NOT NULL,
  currency_code char(3),
  exchange_rate numeric(18,8) NOT NULL DEFAULT 1,
  subtotal      app.money NOT NULL DEFAULT 0,
  tax_total     app.money NOT NULL DEFAULT 0,
  total         app.money NOT NULL,
  paid_amount   app.money NOT NULL DEFAULT 0,
  balance       app.money GENERATED ALWAYS AS (total - paid_amount) STORED,
  status        text NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','partially_paid','paid','overdue','void')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, supplier_id, bill_number)
);
CREATE INDEX ON app.supplier_bills (tenant_id, status, due_date);

CREATE TABLE app.supplier_payments (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  supplier_id    uuid NOT NULL REFERENCES app.suppliers(id),
  bill_id        uuid REFERENCES app.supplier_bills(id),
  payment_method_id uuid,                           -- FK en 07
  cash_session_id uuid,                             -- si sale de caja (FK en 09)
  amount         app.money NOT NULL CHECK (amount > 0),
  paid_at        timestamptz NOT NULL DEFAULT now(),
  reference      text,
  note           text,
  user_id        uuid REFERENCES app.users(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- GASTOS OPERATIVOS / CAJA CHICA
-- (alquiler, luz, nomina, gas del galpon, transporte)
-- ---------------------------------------------------------------------
CREATE TABLE app.expense_categories (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  parent_id   uuid REFERENCES app.expense_categories(id),
  code        text NOT NULL,
  name        text NOT NULL,
  -- Clasificacion para el P&L: costo de ventas vs gasto operativo
  pl_bucket   text NOT NULL DEFAULT 'opex'
              CHECK (pl_bucket IN ('cogs','opex','payroll','financial','tax','capex','other')),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.expenses (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id),
  category_id  uuid REFERENCES app.expense_categories(id),
  supplier_id  uuid REFERENCES app.suppliers(id),
  description  text NOT NULL,
  amount       app.money NOT NULL CHECK (amount > 0),
  tax_amount   app.money NOT NULL DEFAULT 0,
  currency_code char(3),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method_id uuid,
  cash_session_id   uuid,
  -- Imputacion a centro de costo: lote biologico o sucursal
  biological_lot_id uuid REFERENCES app.biological_lots(id),
  cost_type    text,                                -- mapea a biological_costs.cost_type
  is_recurring boolean NOT NULL DEFAULT false,
  recurrence   jsonb,                               -- {"freq":"monthly","day":5}
  receipt_url  text,
  fiscal_number text,
  attributes   jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id      uuid REFERENCES app.users(id),
  device_id    uuid REFERENCES app.devices(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.expenses (tenant_id, expense_date DESC);
CREATE INDEX ON app.expenses (tenant_id, biological_lot_id) WHERE biological_lot_id IS NOT NULL;

ALTER TABLE app.biological_costs
  ADD CONSTRAINT biocost_expense_fk FOREIGN KEY (expense_id) REFERENCES app.expenses(id);

-- ---------------------------------------------------------------------
-- MOTOR DE REABASTECIMIENTO PREDICTIVO
-- Job diario que calcula demanda media, cobertura y sugiere PO.
-- Arranca con media movil + desviacion (sin ML); el campo `model` deja la
-- puerta abierta a Holt-Winters/Prophet sin migrar el esquema.
-- ---------------------------------------------------------------------
CREATE TABLE app.demand_forecasts (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  warehouse_id  uuid NOT NULL REFERENCES app.warehouses(id) ON DELETE CASCADE,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  model         text NOT NULL DEFAULT 'moving_avg_28d',
  avg_daily_qty app.qty NOT NULL,
  stddev_qty    numeric(18,4),
  days_of_cover numeric(10,2),                      -- stock actual / demanda diaria
  safety_stock  app.qty,
  suggested_reorder_point app.qty,
  suggested_order_qty     app.qty,
  stockout_risk_pct numeric(5,2),
  UNIQUE (variant_id, warehouse_id)
);

CREATE TABLE app.reorder_suggestions (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES app.warehouses(id),
  supplier_id  uuid REFERENCES app.suppliers(id),
  suggested_qty app.qty NOT NULL,
  reason       text NOT NULL,                       -- 'below_reorder_point','forecast_stockout'
  urgency      text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high','critical')),
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','accepted','dismissed','ordered')),
  po_id        uuid REFERENCES app.purchase_orders(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.reorder_suggestions (tenant_id, status, urgency);
