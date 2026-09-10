-- =====================================================================
-- OC POS · 17 · Cuentas de WhatsApp y catálogo de plantillas
-- =====================================================================
-- `app.messages_outbox.template_code` referenciaba plantillas que no
-- existían en ninguna parte. Aquí vive el catálogo real.
--
-- Meta exige que toda plantilla de negocio esté aprobada ANTES de
-- enviarse, y las aprueba por WABA (cuenta), no por producto. Por eso el
-- catálogo es por tenant: cada negocio tiene su propia cuenta y su propio
-- estado de aprobación.
-- =====================================================================

CREATE TABLE app.messaging_accounts (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  channel        text NOT NULL DEFAULT 'whatsapp'
                 CHECK (channel IN ('whatsapp','sms','email','push')),
  provider       text NOT NULL,                     -- meta_cloud, twilio, 360dialog, resend
  display_name   text NOT NULL,
  phone_e164     text,                              -- número del negocio
  -- Identificadores del proveedor. Los secretos van cifrados con pgcrypto
  -- por la capa de aplicación; aquí solo se guarda la referencia a KMS.
  waba_id        text,
  phone_number_id text,
  credentials_ref text,
  -- Calidad y límites que impone Meta; si baja, se frena la cobranza masiva
  quality_rating text CHECK (quality_rating IN ('green','yellow','red','unknown')),
  messaging_limit int,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','connected','suspended','disconnected')),
  verified_at    timestamptz,
  last_error     text,
  is_default     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER touch BEFORE UPDATE ON app.messaging_accounts
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE UNIQUE INDEX messaging_accounts_default
  ON app.messaging_accounts (tenant_id, channel) WHERE is_default;

-- ---------------------------------------------------------------------
-- ★ CATÁLOGO DE PLANTILLAS
-- Las plantillas base las publica la plataforma (account_id NULL) y el
-- provisioner las clona al tenant al hacer onboarding; el tenant puede
-- editarlas y volver a someterlas a aprobación.
-- ---------------------------------------------------------------------
CREATE TABLE app.message_templates (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  account_id     uuid REFERENCES app.messaging_accounts(id) ON DELETE CASCADE,
  code           text NOT NULL,                     -- 'collection_due_soon'
  name           text NOT NULL,
  channel        text NOT NULL DEFAULT 'whatsapp'
                 CHECK (channel IN ('whatsapp','sms','email','push')),
  -- Debe coincidir con messages_outbox.purpose
  purpose        text NOT NULL CHECK (purpose IN
                 ('invoice','collection','promo','appointment_reminder',
                  'order_status','low_stock','daily_summary','otp')),
  -- Categoría que exige Meta al someter la plantilla
  category       text NOT NULL DEFAULT 'utility'
                 CHECK (category IN ('utility','marketing','authentication','service')),
  language       text NOT NULL DEFAULT 'es',

  header_kind    text CHECK (header_kind IN ('none','text','image','document','video')),
  header_text    text,
  -- Cuerpo con marcadores posicionales: "Hola {{1}}, tu saldo es {{2}}."
  body_text      text NOT NULL,
  footer_text    text,
  -- Botones: [{"kind":"url","label":"Pagar ahora","url":"{{1}}"},
  --           {"kind":"quick_reply","label":"Ya pagué"}]
  buttons        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Mapeo marcador -> expresión de datos, lo resuelve el renderer:
  -- [{"index":1,"source":"customer.full_name"},
  --  {"index":2,"source":"account.balance","format":"money"}]
  variables      jsonb NOT NULL DEFAULT '[]'::jsonb,
  sample_values  jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Ciclo de aprobación de Meta
  approval_status text NOT NULL DEFAULT 'draft'
                 CHECK (approval_status IN ('draft','submitted','approved','rejected','paused','disabled')),
  provider_template_id text,
  rejection_reason text,
  submitted_at   timestamptz,
  approved_at    timestamptz,

  is_system      boolean NOT NULL DEFAULT false,    -- sembrada por el perfil
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, language)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.message_templates
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();
CREATE INDEX ON app.message_templates (tenant_id, purpose, approval_status);

-- Plantillas base publicadas por la plataforma, clonadas en el onboarding
CREATE TABLE platform.message_template_library (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code          text NOT NULL,
  name          text NOT NULL,
  purpose       text NOT NULL,
  category      text NOT NULL DEFAULT 'utility',
  language      text NOT NULL DEFAULT 'es',
  country_code  char(2) REFERENCES platform.countries(code),  -- null = todos
  header_kind   text,
  header_text   text,
  body_text     text NOT NULL,
  footer_text   text,
  buttons       jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Perfiles que la reciben; vacío = todos
  profile_slugs text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  -- NULLS NOT DISTINCT (PG 15+): una plantilla global lleva country_code NULL
  -- y debe seguir siendo única. Sin esto, reejecutar la semilla duplicaría.
  UNIQUE NULLS NOT DISTINCT (code, language, country_code)
);

-- Ahora messages_outbox referencia el catálogo en vez de un texto suelto
ALTER TABLE app.messages_outbox
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES app.message_templates(id),
  ADD COLUMN IF NOT EXISTS account_id  uuid REFERENCES app.messaging_accounts(id);
CREATE INDEX ON app.messages_outbox (tenant_id, template_id);

-- ---------------------------------------------------------------------
-- Guardia: no se puede encolar un envío con una plantilla no aprobada.
-- Meta lo rechazaría igual, pero fallar aquí da un error entendible y no
-- consume cuota ni degrada la calificación de calidad de la cuenta.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_guard_template_approved() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE v_status text; v_channel text;
BEGIN
  IF NEW.template_id IS NULL THEN
    RETURN NEW;                                     -- mensaje libre (sesión abierta)
  END IF;
  SELECT approval_status, channel INTO v_status, v_channel
    FROM app.message_templates WHERE id = NEW.template_id;

  IF v_channel = 'whatsapp' AND v_status <> 'approved' THEN
    RAISE EXCEPTION 'Plantilla % no está aprobada (estado: %)', NEW.template_id, v_status
      USING ERRCODE = 'restrict_violation',
            HINT = 'Somete la plantilla a aprobación antes de programar envíos.';
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER guard_template_approved BEFORE INSERT ON app.messages_outbox
  FOR EACH ROW EXECUTE FUNCTION app.tg_guard_template_approved();

-- ---------------------------------------------------------------------
-- Registro de entregas/lecturas devuelto por el webhook del proveedor
-- ---------------------------------------------------------------------
CREATE TABLE app.message_events (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  outbox_id    uuid REFERENCES app.messages_outbox(id) ON DELETE CASCADE,
  provider_message_id text,
  event        text NOT NULL CHECK (event IN
               ('queued','sent','delivered','read','failed','replied','clicked','opted_out')),
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.message_events (tenant_id, outbox_id, occurred_at);
CREATE INDEX ON app.message_events (provider_message_id);

-- Lista de exclusión: quien pide parar, para. Se consulta antes de encolar.
CREATE TABLE app.messaging_optouts (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  channel     text NOT NULL,
  address     text NOT NULL,                        -- E.164 o email
  scope       text NOT NULL DEFAULT 'marketing'
              CHECK (scope IN ('marketing','all')),
  reason      text,
  opted_out_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, address, scope)
);
