-- =====================================================================
-- OC POS · 07 · Ventas, Detalle, Pagos y Devoluciones
-- =====================================================================

CREATE TABLE app.payment_methods (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text NOT NULL,                      -- CASH, TRANSFER, CARD, CREDIT, WALLET
  name          text NOT NULL,
  kind          text NOT NULL CHECK (kind IN
                ('cash','card','transfer','wallet','credit','voucher','points','crypto','other')),
  -- 'credit' NO ingresa dinero a la caja: genera CXC (fiado)
  affects_cash_drawer boolean NOT NULL DEFAULT true,
  creates_receivable  boolean NOT NULL DEFAULT false,
  requires_reference  boolean NOT NULL DEFAULT false, -- num. de transferencia
  fee_pct       app.rate NOT NULL DEFAULT 0,        -- comision de la pasarela
  provider      text,                               -- stripe, azul, wompi, yappy
  provider_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  position      smallint NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

ALTER TABLE app.supplier_payments
  ADD CONSTRAINT suppay_method_fk FOREIGN KEY (payment_method_id) REFERENCES app.payment_methods(id);
ALTER TABLE app.expenses
  ADD CONSTRAINT expense_method_fk FOREIGN KEY (payment_method_id) REFERENCES app.payment_methods(id);

-- ---------------------------------------------------------------------
-- ★ VENTAS
-- El id lo genera el DISPOSITIVO (uuid v7) -> la venta existe y se imprime
-- sin internet, y el sync es idempotente por PK.
-- ---------------------------------------------------------------------
CREATE TABLE app.sales (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES app.branches(id),
  warehouse_id   uuid NOT NULL REFERENCES app.warehouses(id),
  device_id      uuid REFERENCES app.devices(id),
  cash_session_id uuid,                             -- FK en 09
  user_id        uuid NOT NULL REFERENCES app.users(id),
  customer_id    uuid,                              -- FK en 11
  -- Numeracion legible: por dispositivo, nunca colisiona offline.
  -- Formato: <branch_code>-<device_no>-<consecutivo>  ej. "SD1-02-000431"
  local_number   text NOT NULL,
  -- Consecutivo global del tenant, asignado por el SERVIDOR al sincronizar
  server_number  bigint,

  channel        text NOT NULL DEFAULT 'pos'
                 CHECK (channel IN ('pos','storefront','whatsapp','delivery','wholesale','api')),
  -- Modo operativo que la origino (define la UI de reimpresion/reapertura)
  operation_mode text NOT NULL DEFAULT 'quick_pos'
                 CHECK (operation_mode IN ('quick_pos','variant_inventory','appointments',
                                           'lending','tables','biological_lots','search_first')),
  status         text NOT NULL DEFAULT 'completed'
                 CHECK (status IN ('draft','held','completed','voided','refunded','partially_refunded')),

  currency_code  char(3) NOT NULL,
  exchange_rate  numeric(18,8) NOT NULL DEFAULT 1,
  subtotal       app.money NOT NULL DEFAULT 0,      -- antes de impuestos y descuentos
  discount_total app.money NOT NULL DEFAULT 0,
  tax_total      app.money NOT NULL DEFAULT 0,
  tip_total      app.money NOT NULL DEFAULT 0,
  rounding_adj   app.money NOT NULL DEFAULT 0,      -- redondeo a la moneda menor
  total          app.money NOT NULL DEFAULT 0,
  paid_total     app.money NOT NULL DEFAULT 0,
  change_given   app.money NOT NULL DEFAULT 0,
  -- Lo que quedo FIADO. Debe cuadrar con el saldo de app.credit_accounts.
  credit_total   app.money NOT NULL DEFAULT 0,
  -- Costo total de la venta (suma de COGS congelado por linea) -> margen real
  cost_total     app.money NOT NULL DEFAULT 0,
  margin_total   app.money GENERATED ALWAYS AS
                 (total - tax_total - cost_total) STORED,

  -- Documento fiscal emitido (FK en 10)
  fiscal_document_id uuid,

  note           text,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,-- campos extra del perfil
  -- Trazabilidad offline
  is_offline_origin boolean NOT NULL DEFAULT false,
  occurred_at    timestamptz NOT NULL,              -- hora real del cobro
  synced_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  -- Anulacion (nunca se borra una venta)
  voided_at      timestamptz,
  voided_by      uuid REFERENCES app.users(id),
  void_reason    text,
  -- Autorizacion de supervisor exigida por el RBAC
  void_approved_by uuid REFERENCES app.users(id),

  sync_seq       bigint,
  UNIQUE (tenant_id, local_number)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.sales
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE INDEX ON app.sales (tenant_id, branch_id, occurred_at DESC);
CREATE INDEX ON app.sales (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX ON app.sales (tenant_id, cash_session_id);
CREATE INDEX ON app.sales (tenant_id, sync_seq);
CREATE INDEX ON app.sales (tenant_id, status) WHERE status IN ('held','draft');

-- ---------------------------------------------------------------------
-- DETALLE DE VENTA
-- Regla clave: se guarda un SNAPSHOT del producto. Si manana cambian el
-- nombre, el precio o los atributos, el ticket historico no muta.
-- ---------------------------------------------------------------------
CREATE TABLE app.sale_lines (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES app.sales(id) ON DELETE CASCADE,
  position      smallint NOT NULL DEFAULT 0,

  variant_id    uuid REFERENCES app.product_variants(id),
  packaging_id  uuid REFERENCES app.product_packagings(id),
  lot_id        uuid REFERENCES app.inventory_lots(id),
  -- Snapshot inmutable
  sku_snapshot  text,
  name_snapshot text NOT NULL,
  attributes_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Cantidad en la UoM de venta + su equivalente en UoM base
  qty           app.qty NOT NULL,
  uom_id        uuid REFERENCES app.uoms(id),
  qty_in_base   app.qty NOT NULL,
  -- Peso capturado por balanza (venta por peso variable)
  weight_kg     numeric(14,3),
  scale_reading jsonb,                              -- traza de la balanza

  unit_price    app.money NOT NULL,
  discount_pct  app.rate NOT NULL DEFAULT 0,
  discount_amount app.money NOT NULL DEFAULT 0,
  discount_reason text,
  discount_approved_by uuid REFERENCES app.users(id),

  tax_group_id  uuid,
  tax_amount    app.money NOT NULL DEFAULT 0,
  -- Desglose por impuesto: [{"code":"ITBIS_18","rate":0.18,"base":100,"amount":18}]
  tax_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  line_subtotal app.money NOT NULL,
  line_total    app.money NOT NULL,

  -- ★ COGS congelado: CPP vigente al momento de vender
  unit_cost     app.unit_cost NOT NULL DEFAULT 0,
  line_cost     app.money NOT NULL DEFAULT 0,
  line_margin   app.money GENERATED ALWAYS AS (line_total - tax_amount - line_cost) STORED,

  -- Comision del empleado que atendio (barberia, ventas).
  -- Apunta a app.employees (NO a app.users): un barbero comisionable puede
  -- no tener usuario del sistema. La FK se declara en 12_operations_modes,
  -- que es donde se crea la tabla.
  employee_id   uuid,
  commission_amount app.money NOT NULL DEFAULT 0,

  -- Enlaces de otros modos operativos
  appointment_id  uuid,
  service_order_id uuid,
  biological_lot_id uuid REFERENCES app.biological_lots(id),

  note          text,
  stock_event_id uuid REFERENCES app.stock_events(id),
  qty_refunded  app.qty NOT NULL DEFAULT 0
);
CREATE INDEX ON app.sale_lines (tenant_id, sale_id);
CREATE INDEX ON app.sale_lines (tenant_id, variant_id);
CREATE INDEX ON app.sale_lines (tenant_id, employee_id) WHERE employee_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- PAGOS (una venta admite N metodos: mitad efectivo, mitad transferencia,
-- resto fiado)
-- ---------------------------------------------------------------------
CREATE TABLE app.sale_payments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES app.sales(id) ON DELETE CASCADE,
  payment_method_id uuid NOT NULL REFERENCES app.payment_methods(id),
  amount        app.money NOT NULL CHECK (amount > 0),
  tendered      app.money,                          -- efectivo recibido
  change        app.money NOT NULL DEFAULT 0,
  reference     text,                               -- voucher, num. transferencia
  -- Pasarela
  provider          text,
  provider_txn_id   text,
  provider_status   text,
  fee_amount    app.money NOT NULL DEFAULT 0,
  -- Si el metodo es 'credit', apunta a la CXC generada (FK en 08)
  credit_account_id uuid,
  paid_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.sale_payments (tenant_id, sale_id);

-- ---------------------------------------------------------------------
-- DEVOLUCIONES / NOTAS DE CREDITO
-- ---------------------------------------------------------------------
CREATE TABLE app.sale_returns (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  sale_id       uuid NOT NULL REFERENCES app.sales(id),
  branch_id     uuid NOT NULL REFERENCES app.branches(id),
  code          text NOT NULL,
  reason        text NOT NULL,
  refund_method text NOT NULL DEFAULT 'cash'
                CHECK (refund_method IN ('cash','original','store_credit','exchange','credit_note')),
  subtotal      app.money NOT NULL DEFAULT 0,
  tax_total     app.money NOT NULL DEFAULT 0,
  total         app.money NOT NULL DEFAULT 0,
  restock       boolean NOT NULL DEFAULT true,
  fiscal_document_id uuid,
  user_id       uuid REFERENCES app.users(id),
  approved_by   uuid REFERENCES app.users(id),
  cash_session_id uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.sale_return_lines (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  return_id    uuid NOT NULL REFERENCES app.sale_returns(id) ON DELETE CASCADE,
  sale_line_id uuid NOT NULL REFERENCES app.sale_lines(id),
  qty_in_base  app.qty NOT NULL CHECK (qty_in_base > 0),
  amount       app.money NOT NULL,
  condition    text CHECK (condition IN ('resellable','damaged','expired','defective')),
  stock_event_id uuid REFERENCES app.stock_events(id)
);

-- ---------------------------------------------------------------------
-- Promociones y descuentos por volumen (motor de reglas declarativo)
-- ---------------------------------------------------------------------
CREATE TABLE app.promotions (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN
              ('pct_off','amount_off','buy_x_get_y','bundle','volume_tier','happy_hour','free_shipping')),
  -- Condiciones y efecto, evaluados por el mismo motor en servidor y en el
  -- cliente offline (misma libreria TS compartida en packages/pricing).
  -- {"scope":"category","category_ids":[...],"min_qty":3,
  --  "days":[5,6],"hours":["18:00","21:00"]}
  conditions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  effect      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"pct":15} | {"buy":3,"get":1}
  channels    text[] NOT NULL DEFAULT '{pos,storefront}',
  priority    smallint NOT NULL DEFAULT 0,
  stackable   boolean NOT NULL DEFAULT false,
  starts_at   timestamptz,
  ends_at     timestamptz,
  usage_limit int,
  usage_count int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);
