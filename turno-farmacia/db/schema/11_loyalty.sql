-- =====================================================================
-- OC POS · 11 · Fidelización: Puntos, Cashback y Segmentación
-- =====================================================================

CREATE TABLE app.loyalty_programs (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  kind          text NOT NULL DEFAULT 'points'
                CHECK (kind IN ('points','cashback','stamps','tiers','visits')),
  -- Reglas declarativas del motor:
  -- points:   {"earn_per_currency":1,"redeem_value":0.05,"min_redeem":100}
  -- cashback: {"pct":0.03,"cap_per_sale":500,"wallet_expiry_days":90}
  -- stamps:   {"stamps_needed":10,"reward_variant_id":"...","per":"visit"}
  rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Multiplicadores por categoria/producto/dia
  modifiers     jsonb NOT NULL DEFAULT '[]'::jsonb,
  expiry_days   int,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.loyalty_accounts (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  program_id    uuid NOT NULL REFERENCES app.loyalty_programs(id) ON DELETE CASCADE,
  customer_id   uuid NOT NULL REFERENCES app.customers(id) ON DELETE CASCADE,
  points_balance   numeric(18,4) NOT NULL DEFAULT 0,
  cashback_balance app.money NOT NULL DEFAULT 0,
  stamps_count     int NOT NULL DEFAULT 0,
  tier          text,
  lifetime_points numeric(18,4) NOT NULL DEFAULT 0,
  enrolled_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, customer_id)
);

-- Ledger append-only (mismo patron: el saldo es la suma)
CREATE TABLE app.loyalty_movements (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES app.loyalty_accounts(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN
                ('earn','redeem','expire','adjust','refund_reversal','bonus')),
  points        numeric(18,4) NOT NULL DEFAULT 0,
  cashback      app.money NOT NULL DEFAULT 0,
  stamps        int NOT NULL DEFAULT 0,
  sale_id       uuid REFERENCES app.sales(id),
  expires_at    timestamptz,
  note          text,
  user_id       uuid REFERENCES app.users(id),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  sync_seq      bigint
);
CREATE INDEX ON app.loyalty_movements (tenant_id, account_id, occurred_at DESC);
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.loyalty_movements
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

CREATE OR REPLACE FUNCTION app.tg_apply_loyalty_movement() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE app.loyalty_accounts SET
    points_balance   = points_balance   + NEW.points,
    cashback_balance = cashback_balance + NEW.cashback,
    stamps_count     = stamps_count     + NEW.stamps,
    lifetime_points  = lifetime_points  + GREATEST(NEW.points, 0)
  WHERE id = NEW.account_id;
  RETURN NEW;
END $fn$;

CREATE TRIGGER apply_loyalty AFTER INSERT ON app.loyalty_movements
  FOR EACH ROW EXECUTE FUNCTION app.tg_apply_loyalty_movement();

-- Segmentos dinamicos para campanas de WhatsApp
CREATE TABLE app.customer_segments (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  -- Filtro declarativo evaluado contra app.customers:
  -- {"last_purchase_days_gt":30,"total_purchases_gt":5000,"tags":["mayorista"]}
  filter      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_dynamic  boolean NOT NULL DEFAULT true,
  member_count int NOT NULL DEFAULT 0,
  refreshed_at timestamptz,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.campaigns (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  channel      text NOT NULL DEFAULT 'whatsapp',
  segment_id   uuid REFERENCES app.customer_segments(id),
  template_code text,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  promotion_id uuid REFERENCES app.promotions(id),
  scheduled_at timestamptz,
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','scheduled','sending','sent','canceled')),
  sent_count   int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
