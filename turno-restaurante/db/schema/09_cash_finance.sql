-- =====================================================================
-- OC POS · 09 · Caja, Arqueo, Descuadres y Finanzas
-- =====================================================================

CREATE TABLE app.cash_registers (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  device_id  uuid REFERENCES app.devices(id),
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------
-- ★ SESION DE CAJA (turno). Todo movimiento de dinero cuelga de aqui.
-- ---------------------------------------------------------------------
CREATE TABLE app.cash_sessions (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES app.branches(id),
  register_id    uuid NOT NULL REFERENCES app.cash_registers(id),
  device_id      uuid REFERENCES app.devices(id),
  opened_by      uuid NOT NULL REFERENCES app.users(id),
  closed_by      uuid REFERENCES app.users(id),
  -- Cierre revisado por un supervisor (control antirrobo)
  approved_by    uuid REFERENCES app.users(id),

  opening_amount app.money NOT NULL DEFAULT 0,      -- fondo inicial declarado
  -- Calculados al cerrar
  expected_cash  app.money NOT NULL DEFAULT 0,      -- fondo + ventas efectivo + ingresos - egresos
  counted_cash   app.money,                         -- lo que el cajero contó
  difference     app.money GENERATED ALWAYS AS
                 (COALESCE(counted_cash,0) - expected_cash) STORED,
  -- Totales por metodo de pago al cierre (snapshot para el reporte Z)
  -- {"CASH":12500,"CARD":8400,"TRANSFER":3200,"CREDIT":1500}
  totals_by_method jsonb NOT NULL DEFAULT '{}'::jsonb,
  sales_count    int NOT NULL DEFAULT 0,
  sales_total    app.money NOT NULL DEFAULT 0,
  refunds_total  app.money NOT NULL DEFAULT 0,
  credit_total   app.money NOT NULL DEFAULT 0,
  collections_total app.money NOT NULL DEFAULT 0,   -- abonos de fiado recibidos
  cash_in_total  app.money NOT NULL DEFAULT 0,
  cash_out_total app.money NOT NULL DEFAULT 0,

  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','closing','closed','reconciled')),
  opened_at      timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  closing_note   text,
  -- Si hubo descuadre, se exige justificacion y queda en auditoria
  variance_reason text,
  sync_seq       bigint
);
CREATE INDEX ON app.cash_sessions (tenant_id, branch_id, opened_at DESC);
CREATE UNIQUE INDEX cash_sessions_one_open
  ON app.cash_sessions (register_id) WHERE status = 'open';

ALTER TABLE app.sales
  ADD CONSTRAINT sales_session_fk FOREIGN KEY (cash_session_id) REFERENCES app.cash_sessions(id);
ALTER TABLE app.sale_returns
  ADD CONSTRAINT returns_session_fk FOREIGN KEY (cash_session_id) REFERENCES app.cash_sessions(id);
ALTER TABLE app.credit_movements
  ADD CONSTRAINT creditmov_session_fk FOREIGN KEY (cash_session_id) REFERENCES app.cash_sessions(id);
ALTER TABLE app.supplier_payments
  ADD CONSTRAINT suppay_session_fk FOREIGN KEY (cash_session_id) REFERENCES app.cash_sessions(id);
ALTER TABLE app.expenses
  ADD CONSTRAINT expense_session_fk FOREIGN KEY (cash_session_id) REFERENCES app.cash_sessions(id);

-- Entradas/salidas de efectivo que no son ventas
CREATE TABLE app.cash_movements (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES app.cash_sessions(id) ON DELETE CASCADE,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  kind         text NOT NULL CHECK (kind IN
               ('opening_float','withdrawal','deposit','expense','supplier_payment',
                'collection','tip_out','correction','bank_transfer','loan_disbursement')),
  amount       app.money NOT NULL CHECK (amount > 0),
  payment_method_id uuid REFERENCES app.payment_methods(id),
  expense_id   uuid REFERENCES app.expenses(id),
  reason       text NOT NULL,
  authorized_by uuid REFERENCES app.users(id),      -- retiros exigen supervisor
  user_id      uuid NOT NULL REFERENCES app.users(id),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  attachment_url text
);
CREATE INDEX ON app.cash_movements (tenant_id, session_id);
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.cash_movements
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

-- Conteo por denominacion (arqueo detallado, evita "me falto un billete")
CREATE TABLE app.cash_count_lines (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES app.cash_sessions(id) ON DELETE CASCADE,
  moment       text NOT NULL CHECK (moment IN ('opening','closing')),
  denomination app.money NOT NULL,                  -- 2000, 1000, 500, 0.25
  kind         text NOT NULL DEFAULT 'bill' CHECK (kind IN ('bill','coin')),
  count        int NOT NULL CHECK (count >= 0),
  subtotal     app.money GENERATED ALWAYS AS (denomination * count) STORED,
  UNIQUE (session_id, moment, denomination)
);

-- ---------------------------------------------------------------------
-- Cuentas bancarias / billeteras del negocio (conciliacion basica)
-- ---------------------------------------------------------------------
CREATE TABLE app.financial_accounts (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code         text NOT NULL,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('cash','bank','wallet','gateway','credit_card')),
  currency_code char(3) NOT NULL,
  bank_name    text,
  account_number_masked text,
  opening_balance app.money NOT NULL DEFAULT 0,
  current_balance app.money NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.financial_transactions (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES app.financial_accounts(id),
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  amount       app.money NOT NULL CHECK (amount > 0),
  category     text NOT NULL,                       -- sales, expense, transfer, payout, fee
  ref_type     text,
  ref_id       uuid,
  description  text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.financial_transactions (tenant_id, account_id, occurred_at DESC);

-- =====================================================================
-- VISTAS DE INTELIGENCIA DE NEGOCIO
-- =====================================================================

-- ★ P&L en tiempo real por sucursal y dia
CREATE OR REPLACE VIEW app.v_pnl_daily AS
WITH s AS (
  SELECT tenant_id, branch_id, (occurred_at AT TIME ZONE 'UTC')::date AS d,
         SUM(total - tax_total)            AS net_revenue,
         SUM(tax_total)                    AS taxes_collected,
         SUM(cost_total)                   AS cogs,
         SUM(discount_total)               AS discounts,
         COUNT(*)                          AS tickets
    FROM app.sales
   WHERE status IN ('completed','partially_refunded')
   GROUP BY 1,2,3
),
r AS (
  SELECT tenant_id, branch_id, (occurred_at AT TIME ZONE 'UTC')::date AS d,
         SUM(total) AS refunds
    FROM app.sale_returns GROUP BY 1,2,3
),
e AS (
  SELECT e.tenant_id, e.branch_id, e.expense_date AS d,
         SUM(e.amount) FILTER (WHERE COALESCE(ec.pl_bucket,'opex') = 'opex')    AS opex,
         SUM(e.amount) FILTER (WHERE ec.pl_bucket = 'payroll')                  AS payroll,
         SUM(e.amount) FILTER (WHERE ec.pl_bucket NOT IN ('opex','payroll'))    AS other_exp
    FROM app.expenses e
    LEFT JOIN app.expense_categories ec ON ec.id = e.category_id
   GROUP BY 1,2,3
)
SELECT
  COALESCE(s.tenant_id, e.tenant_id)            AS tenant_id,
  COALESCE(s.branch_id, e.branch_id)            AS branch_id,
  COALESCE(s.d, e.d)                            AS day,
  COALESCE(s.net_revenue,0)                     AS net_revenue,
  COALESCE(r.refunds,0)                         AS refunds,
  COALESCE(s.cogs,0)                            AS cogs,
  COALESCE(s.net_revenue,0) - COALESCE(r.refunds,0) - COALESCE(s.cogs,0) AS gross_profit,
  COALESCE(e.opex,0)                            AS opex,
  COALESCE(e.payroll,0)                         AS payroll,
  COALESCE(e.other_exp,0)                       AS other_expenses,
  COALESCE(s.net_revenue,0) - COALESCE(r.refunds,0) - COALESCE(s.cogs,0)
    - COALESCE(e.opex,0) - COALESCE(e.payroll,0) - COALESCE(e.other_exp,0) AS net_profit,
  COALESCE(s.tickets,0)                         AS tickets,
  ROUND(COALESCE(s.net_revenue,0) / NULLIF(s.tickets,0), 2) AS avg_ticket
FROM s
FULL OUTER JOIN e ON e.tenant_id = s.tenant_id AND e.branch_id = s.branch_id AND e.d = s.d
LEFT JOIN r ON r.tenant_id = s.tenant_id AND r.branch_id = s.branch_id AND r.d = s.d;

-- Horas pico y ticket promedio por hora
CREATE OR REPLACE VIEW app.v_sales_by_hour AS
SELECT tenant_id, branch_id,
       EXTRACT(dow  FROM occurred_at)::int AS day_of_week,
       EXTRACT(hour FROM occurred_at)::int AS hour_of_day,
       COUNT(*)      AS tickets,
       SUM(total)    AS revenue,
       AVG(total)    AS avg_ticket
FROM app.sales
WHERE status = 'completed'
GROUP BY 1,2,3,4;

-- Ranking de productos con margen real
CREATE OR REPLACE VIEW app.v_product_performance AS
SELECT
  sl.tenant_id,
  sl.variant_id,
  v.sku,
  p.name,
  SUM(sl.qty_in_base)                          AS units_sold,
  SUM(sl.line_total)                           AS revenue,
  SUM(sl.line_cost)                            AS cost,
  SUM(sl.line_margin)                          AS margin,
  ROUND(100 * SUM(sl.line_margin) / NULLIF(SUM(sl.line_total - sl.tax_amount),0), 2) AS margin_pct
FROM app.sale_lines sl
JOIN app.sales s          ON s.id = sl.sale_id AND s.status = 'completed'
JOIN app.product_variants v ON v.id = sl.variant_id
JOIN app.products p        ON p.id = v.product_id
GROUP BY 1,2,3,4;
