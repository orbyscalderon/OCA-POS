-- =====================================================================
-- OC POS · 08 · Clientes, FIADO, CXC, Créditos y Cobranza
-- =====================================================================
-- Este es el modulo que hace ganar a Treinta: la libreta de fiado.
-- Se generaliza en TRES formas de credito sobre el mismo motor:
--   'open_account' -> libreta de fiado (saldo revolvente, sin cuotas)
--   'installment'  -> venta a plazos con cronograma
--   'loan'         -> prestamo de dinero (perfil Prestamista)
-- =====================================================================

CREATE TABLE app.customers (
  id            uuid PRIMARY KEY,                   -- generado en cliente (alta offline)
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code          text,
  full_name     text NOT NULL,
  doc_type      text,                               -- cedula, RNC, pasaporte
  doc_number    text,
  phone_e164    text,
  whatsapp_e164 text,
  email         citext,
  address       text,
  birthdate     date,
  gender        text,
  -- Atributos dinamicos por perfil:
  -- Barberia: {"tipo_cabello":"rizado","barbero_preferido":"..."}
  -- Farmacia: {"alergias":["penicilina"],"seguro":"ARS Humano"}
  -- Granja:   {"tipo_comprador":"mayorista","ruta":"Norte"}
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ★ Perfil crediticio
  credit_enabled   boolean NOT NULL DEFAULT false,
  credit_limit     app.money NOT NULL DEFAULT 0,
  credit_terms_days smallint NOT NULL DEFAULT 30,
  -- Saldo total adeudado (proyeccion de credit_movements; se lee en el POS
  -- para bloquear ventas a fiado que excedan el limite)
  balance_due      app.money NOT NULL DEFAULT 0,
  overdue_amount   app.money NOT NULL DEFAULT 0,
  -- Score interno 0-100 calculado con historial de pago
  risk_score       smallint,
  is_blocked       boolean NOT NULL DEFAULT false,
  blocked_reason   text,

  -- CRM
  first_purchase_at timestamptz,
  last_purchase_at  timestamptz,
  total_purchases   app.money NOT NULL DEFAULT 0,
  purchase_count    int NOT NULL DEFAULT 0,
  tags              text[] NOT NULL DEFAULT '{}',
  price_list_id     uuid REFERENCES app.price_lists(id),
  marketing_opt_in  boolean NOT NULL DEFAULT false,

  is_active     boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES app.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  sync_seq      bigint,
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.customers
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE INDEX ON app.customers USING gin (full_name gin_trgm_ops);
CREATE INDEX ON app.customers (tenant_id, phone_e164);
CREATE INDEX ON app.customers (tenant_id) WHERE balance_due > 0;
CREATE INDEX customers_attrs_gin ON app.customers USING gin (attributes jsonb_path_ops);

ALTER TABLE app.sales
  ADD CONSTRAINT sales_customer_fk FOREIGN KEY (customer_id) REFERENCES app.customers(id);

-- ---------------------------------------------------------------------
-- ★ CUENTAS DE CREDITO (CXC)
-- ---------------------------------------------------------------------
CREATE TABLE app.credit_accounts (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id      uuid REFERENCES app.branches(id),
  customer_id    uuid NOT NULL REFERENCES app.customers(id),
  code           text NOT NULL,
  kind           text NOT NULL DEFAULT 'open_account'
                 CHECK (kind IN ('open_account','installment','loan')),
  -- Venta que la origino (null en prestamos de dinero puros)
  sale_id        uuid REFERENCES app.sales(id),

  currency_code  char(3) NOT NULL,
  -- Capital: lo fiado o desembolsado
  principal      app.money NOT NULL DEFAULT 0,
  -- Intereses e intereses moratorios devengados
  interest_accrued app.money NOT NULL DEFAULT 0,
  late_fee_accrued app.money NOT NULL DEFAULT 0,
  paid_amount    app.money NOT NULL DEFAULT 0,
  -- Saldo total exigible
  balance        app.money GENERATED ALWAYS AS
                 (principal + interest_accrued + late_fee_accrued - paid_amount) STORED,

  -- ★ Configuracion de interes y mora (declarativa, evaluada por el motor)
  -- {"interest":{"rate":0.05,"period":"monthly","method":"flat"},
  --  "late_fee":{"kind":"pct_per_day","value":0.005,"cap_pct":0.30},
  --  "grace_days":5}
  -- method: flat | simple | french (cuota fija) | none
  terms          jsonb NOT NULL DEFAULT '{}'::jsonb,
  installments_count smallint NOT NULL DEFAULT 0,   -- 0 = sin cronograma
  frequency      text CHECK (frequency IN ('daily','weekly','biweekly','monthly','custom')),

  opened_at      timestamptz NOT NULL DEFAULT now(),
  due_date       date,                              -- vencimiento (open_account)
  closed_at      timestamptz,
  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','current','overdue','in_collection',
                                   'paid','written_off','legal','canceled')),
  days_overdue   int NOT NULL DEFAULT 0,
  guarantor_name text,
  collateral     jsonb,                             -- prenda/garantia (prestamista)
  attachments    text[] NOT NULL DEFAULT '{}',      -- foto de la cedula, pagare
  note           text,
  created_by     uuid REFERENCES app.users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  sync_seq       bigint,
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.credit_accounts
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE INDEX ON app.credit_accounts (tenant_id, customer_id, status);
CREATE INDEX ON app.credit_accounts (tenant_id, status, due_date);

ALTER TABLE app.sale_payments
  ADD CONSTRAINT salepay_credit_fk
  FOREIGN KEY (credit_account_id) REFERENCES app.credit_accounts(id);

-- ---------------------------------------------------------------------
-- CRONOGRAMA DE PAGOS
-- ---------------------------------------------------------------------
CREATE TABLE app.credit_installments (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES app.credit_accounts(id) ON DELETE CASCADE,
  number         smallint NOT NULL,                 -- cuota 1..N
  due_date       date NOT NULL,
  principal_due  app.money NOT NULL DEFAULT 0,
  interest_due   app.money NOT NULL DEFAULT 0,
  late_fee_due   app.money NOT NULL DEFAULT 0,
  total_due      app.money NOT NULL,
  paid_amount    app.money NOT NULL DEFAULT 0,
  balance        app.money GENERATED ALWAYS AS (total_due - paid_amount) STORED,
  paid_at        timestamptz,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','partially_paid','paid','overdue','waived')),
  days_overdue   int NOT NULL DEFAULT 0,
  UNIQUE (account_id, number)
);
CREATE INDEX ON app.credit_installments (tenant_id, due_date, status)
  WHERE status IN ('pending','partially_paid','overdue');

-- ---------------------------------------------------------------------
-- ★ LEDGER DE CREDITO (append-only). Todo movimiento de la deuda.
-- El saldo del cliente es la SUMA de este ledger, nunca un UPDATE directo
-- -> mismo beneficio de conmutatividad que el ledger de stock en offline.
-- ---------------------------------------------------------------------
CREATE TABLE app.credit_movements (
  id             uuid PRIMARY KEY,
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES app.credit_accounts(id) ON DELETE CASCADE,
  customer_id    uuid NOT NULL REFERENCES app.customers(id),
  movement_type  text NOT NULL CHECK (movement_type IN (
                   'charge',      -- nueva venta fiada / desembolso
                   'payment',     -- abono del cliente
                   'interest',    -- interes devengado
                   'late_fee',    -- cargo por mora
                   'discount',    -- condonacion / descuento por pronto pago
                   'adjustment',
                   'write_off',   -- incobrable
                   'refund')),
  -- + aumenta la deuda, - la disminuye
  amount         app.money NOT NULL CHECK (amount <> 0),
  installment_id uuid REFERENCES app.credit_installments(id),
  payment_method_id uuid REFERENCES app.payment_methods(id),
  cash_session_id uuid,
  sale_id        uuid REFERENCES app.sales(id),
  reference      text,
  note           text,
  -- Comprobante entregado al cliente (recibo de abono)
  receipt_number text,
  user_id        uuid REFERENCES app.users(id),
  device_id      uuid REFERENCES app.devices(id),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  recorded_at    timestamptz NOT NULL DEFAULT now(),
  sync_seq       bigint
);
CREATE INDEX ON app.credit_movements (tenant_id, account_id, occurred_at DESC);
CREATE INDEX ON app.credit_movements (tenant_id, customer_id, occurred_at DESC);
CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.credit_movements
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

-- Proyeccion: mantiene los saldos de cuenta y de cliente
CREATE OR REPLACE FUNCTION app.tg_apply_credit_movement() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE app.credit_accounts SET
    principal        = principal + CASE WHEN NEW.movement_type = 'charge'    THEN NEW.amount ELSE 0 END,
    interest_accrued = interest_accrued + CASE WHEN NEW.movement_type = 'interest' THEN NEW.amount ELSE 0 END,
    late_fee_accrued = late_fee_accrued + CASE WHEN NEW.movement_type = 'late_fee' THEN NEW.amount ELSE 0 END,
    paid_amount      = paid_amount + CASE
                         WHEN NEW.movement_type IN ('payment','discount','write_off') THEN ABS(NEW.amount)
                         WHEN NEW.movement_type = 'refund' THEN -ABS(NEW.amount)
                         ELSE 0 END,
    updated_at       = now()
  WHERE id = NEW.account_id;

  UPDATE app.customers c SET
    balance_due = (SELECT COALESCE(SUM(a.balance),0) FROM app.credit_accounts a
                    WHERE a.customer_id = c.id AND a.status NOT IN ('paid','canceled','written_off')),
    updated_at  = now()
  WHERE c.id = NEW.customer_id;

  RETURN NEW;
END $fn$;

CREATE TRIGGER apply_credit AFTER INSERT ON app.credit_movements
  FOR EACH ROW EXECUTE FUNCTION app.tg_apply_credit_movement();

-- ---------------------------------------------------------------------
-- ★ COBRANZA AUTOMATIZADA POR WHATSAPP
-- ---------------------------------------------------------------------
CREATE TABLE app.collection_rules (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- Disparo relativo al vencimiento: -3 = 3 dias antes, +1 = 1 dia despues
  trigger_days_offset int NOT NULL,
  channel      text NOT NULL DEFAULT 'whatsapp'
               CHECK (channel IN ('whatsapp','sms','email','push')),
  template_code text NOT NULL,                      -- plantilla aprobada por Meta
  -- Filtros: solo montos > X, solo cierto tag de cliente
  conditions   jsonb NOT NULL DEFAULT '{}'::jsonb,
  include_payment_link boolean NOT NULL DEFAULT true,
  is_active    boolean NOT NULL DEFAULT true,
  max_per_account int NOT NULL DEFAULT 3
);

CREATE TABLE app.payment_links (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  token         text NOT NULL UNIQUE,               -- slug publico corto
  account_id    uuid REFERENCES app.credit_accounts(id) ON DELETE CASCADE,
  installment_id uuid REFERENCES app.credit_installments(id),
  sale_id       uuid REFERENCES app.sales(id),
  online_order_id uuid,
  customer_id   uuid REFERENCES app.customers(id),
  amount        app.money NOT NULL,
  currency_code char(3) NOT NULL,
  concept       text,
  provider      text,                               -- stripe, azul, wompi, mercadopago
  provider_intent_id text,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','viewed','paid','expired','canceled','failed')),
  expires_at    timestamptz,
  viewed_at     timestamptz,
  paid_at       timestamptz,
  credit_movement_id uuid REFERENCES app.credit_movements(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.payment_links (tenant_id, status);

CREATE TABLE app.messages_outbox (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  channel       text NOT NULL CHECK (channel IN ('whatsapp','sms','email','push')),
  purpose       text NOT NULL CHECK (purpose IN
                ('invoice','collection','promo','appointment_reminder',
                 'order_status','low_stock','daily_summary','otp')),
  customer_id   uuid REFERENCES app.customers(id),
  supplier_id   uuid REFERENCES app.suppliers(id),
  to_address    text NOT NULL,                      -- E.164 o email
  template_code text,
  -- Variables de la plantilla + adjuntos (PDF de factura, link de pago)
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  body_preview  text,
  payment_link_id uuid REFERENCES app.payment_links(id),
  rule_id       uuid REFERENCES app.collection_rules(id),
  credit_account_id uuid REFERENCES app.credit_accounts(id),
  status        text NOT NULL DEFAULT 'queued'
                CHECK (status IN ('queued','sending','sent','delivered','read','failed','canceled')),
  provider_message_id text,
  error         text,
  attempts      smallint NOT NULL DEFAULT 0,
  scheduled_at  timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.messages_outbox (tenant_id, status, scheduled_at);

-- ---------------------------------------------------------------------
-- Vista de antiguedad de saldos (aging) para el tablero de cobranza
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_receivables_aging AS
SELECT
  a.tenant_id,
  a.customer_id,
  c.full_name,
  c.whatsapp_e164,
  a.id AS account_id,
  a.code,
  a.kind,
  a.balance,
  a.due_date,
  GREATEST(CURRENT_DATE - a.due_date, 0) AS days_overdue,
  CASE
    WHEN a.due_date IS NULL OR CURRENT_DATE <= a.due_date THEN 'current'
    WHEN CURRENT_DATE - a.due_date BETWEEN 1  AND 30  THEN '1_30'
    WHEN CURRENT_DATE - a.due_date BETWEEN 31 AND 60  THEN '31_60'
    WHEN CURRENT_DATE - a.due_date BETWEEN 61 AND 90  THEN '61_90'
    ELSE '90_plus'
  END AS aging_bucket
FROM app.credit_accounts a
JOIN app.customers c ON c.id = a.customer_id
WHERE a.status NOT IN ('paid','canceled','written_off') AND a.balance > 0;
