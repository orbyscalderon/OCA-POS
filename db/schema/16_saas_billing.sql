-- =====================================================================
-- OC POS · 16 · Facturación del propio SaaS (cobro al Tenant)
-- =====================================================================
-- Distinto del módulo fiscal: aquí OC POS le cobra a sus clientes.
-- Vive en el schema `platform` porque no pertenece a ningún tenant.
-- =====================================================================

CREATE TABLE platform.coupons (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code           text NOT NULL UNIQUE,
  description    text,
  discount_kind  text NOT NULL CHECK (discount_kind IN ('pct','amount','free_months')),
  discount_value numeric(12,4) NOT NULL,
  applies_to_plan_ids uuid[] NOT NULL DEFAULT '{}',
  duration_months smallint,                         -- null = para siempre
  max_redemptions int,
  redemptions    int NOT NULL DEFAULT 0,
  valid_from     timestamptz,
  valid_to       timestamptz,
  is_active      boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- SUSCRIPCIÓN. `platform.tenants` guarda el estado denormalizado
-- (subscription_status, current_period_end); aquí vive el detalle.
-- ---------------------------------------------------------------------
CREATE TABLE platform.subscriptions (
  id              uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  plan_id         uuid NOT NULL REFERENCES platform.plans(id),
  coupon_id       uuid REFERENCES platform.coupons(id),
  billing_cycle   text NOT NULL DEFAULT 'monthly'
                  CHECK (billing_cycle IN ('monthly','yearly')),
  currency_code   char(3) NOT NULL DEFAULT 'USD',
  unit_amount     app.money NOT NULL,
  quantity        int NOT NULL DEFAULT 1,           -- ej. cobro por sucursal
  status          text NOT NULL DEFAULT 'trialing'
                  CHECK (status IN ('trialing','active','past_due','paused','canceled','expired')),
  trial_ends_at   timestamptz,
  current_period_start timestamptz NOT NULL DEFAULT now(),
  current_period_end   timestamptz NOT NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at     timestamptz,
  cancel_reason   text,
  -- Pasarela de cobro recurrente
  provider        text,                             -- stripe, paddle, azul
  provider_customer_id     text,
  provider_subscription_id text,
  -- Reintentos de cobro fallido antes de suspender
  dunning_attempts smallint NOT NULL DEFAULT 0,
  grace_until     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER touch BEFORE UPDATE ON platform.subscriptions
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE UNIQUE INDEX subscriptions_one_active
  ON platform.subscriptions (tenant_id)
  WHERE status IN ('trialing','active','past_due','paused');
CREATE INDEX ON platform.subscriptions (status, current_period_end);

-- ---------------------------------------------------------------------
-- FACTURAS DE LA SUSCRIPCIÓN
-- ---------------------------------------------------------------------
CREATE TABLE platform.subscription_invoices (
  id              uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES platform.subscriptions(id) ON DELETE CASCADE,
  number          text NOT NULL UNIQUE,
  period_start    timestamptz NOT NULL,
  period_end      timestamptz NOT NULL,
  currency_code   char(3) NOT NULL,
  subtotal        app.money NOT NULL DEFAULT 0,
  discount_total  app.money NOT NULL DEFAULT 0,
  tax_total       app.money NOT NULL DEFAULT 0,
  total           app.money NOT NULL DEFAULT 0,
  paid_amount     app.money NOT NULL DEFAULT 0,
  balance         app.money GENERATED ALWAYS AS (total - paid_amount) STORED,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','open','paid','uncollectible','void','refunded')),
  due_date        date,
  issued_at       timestamptz,
  paid_at         timestamptz,
  pdf_url         text,
  provider_invoice_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);
CREATE INDEX ON platform.subscription_invoices (tenant_id, status, due_date);

CREATE TABLE platform.subscription_invoice_lines (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  invoice_id  uuid NOT NULL REFERENCES platform.subscription_invoices(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'plan'
              CHECK (kind IN ('plan','addon','overage','setup','discount','proration','tax')),
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1,
  unit_amount app.money NOT NULL,
  amount      app.money NOT NULL,
  metric_code text                                  -- si es overage: que metrica
);

CREATE TABLE platform.subscription_payments (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  invoice_id   uuid REFERENCES platform.subscription_invoices(id),
  amount       app.money NOT NULL CHECK (amount > 0),
  currency_code char(3) NOT NULL,
  method       text,                                -- card, transfer, cash, wallet
  provider     text,
  provider_payment_id text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','succeeded','failed','refunded','disputed')),
  failure_code text,
  paid_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON platform.subscription_payments (tenant_id, status);

-- ---------------------------------------------------------------------
-- MEDICIÓN DE USO — alimenta los límites de plan y los excedentes.
-- Un contador por tenant/métrica/periodo. Lo incrementa el backend.
-- ---------------------------------------------------------------------
CREATE TABLE platform.usage_counters (
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  metric_code  text NOT NULL,                       -- whatsapp_msgs, sales, products,
                                                    -- users, branches, devices, storage_mb
  period_start date NOT NULL,
  used         numeric(18,3) NOT NULL DEFAULT 0,
  included     numeric(18,3),                       -- copia del limite del plan
  overage_unit_price app.money,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, metric_code, period_start)
);

-- Incremento atómico usado por el backend en cada acción medida
CREATE OR REPLACE FUNCTION platform.bump_usage(
  p_tenant uuid, p_metric text, p_delta numeric DEFAULT 1
) RETURNS numeric
LANGUAGE plpgsql AS $fn$
DECLARE v_total numeric;
BEGIN
  INSERT INTO platform.usage_counters (tenant_id, metric_code, period_start, used)
  VALUES (p_tenant, p_metric, date_trunc('month', now())::date, p_delta)
  ON CONFLICT (tenant_id, metric_code, period_start) DO UPDATE
    SET used = platform.usage_counters.used + EXCLUDED.used,
        updated_at = now()
  RETURNING used INTO v_total;
  RETURN v_total;
END $fn$;

-- Estado consolidado de facturación por tenant
CREATE OR REPLACE VIEW platform.v_billing_status AS
SELECT
  t.id                      AS tenant_id,
  t.trade_name,
  t.country_code,
  p.code                    AS plan_code,
  s.status                  AS subscription_status,
  s.billing_cycle,
  s.current_period_end,
  s.dunning_attempts,
  COALESCE(SUM(i.balance) FILTER (WHERE i.status = 'open'), 0)  AS open_balance,
  COUNT(i.id) FILTER (WHERE i.status = 'open' AND i.due_date < CURRENT_DATE) AS overdue_invoices,
  MAX(pay.paid_at)          AS last_payment_at
FROM platform.tenants t
LEFT JOIN platform.subscriptions s
       ON s.tenant_id = t.id AND s.status IN ('trialing','active','past_due','paused')
LEFT JOIN platform.plans p ON p.id = COALESCE(s.plan_id, t.plan_id)
LEFT JOIN platform.subscription_invoices i ON i.tenant_id = t.id
LEFT JOIN platform.subscription_payments pay
       ON pay.tenant_id = t.id AND pay.status = 'succeeded'
GROUP BY t.id, t.trade_name, t.country_code, p.code,
         s.status, s.billing_cycle, s.current_period_end, s.dunning_attempts;
