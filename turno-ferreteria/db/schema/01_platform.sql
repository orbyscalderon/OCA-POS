-- =====================================================================
-- OC POS · 01 · Plataforma: Tenants, planes, perfiles de negocio, países
-- Este schema NO lleva RLS por tenant: es el catálogo global del SaaS.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------
-- Catálogo de países / localización fiscal
-- ---------------------------------------------------------------------
CREATE TABLE platform.countries (
  code             char(2) PRIMARY KEY,            -- ISO 3166-1 alpha-2 (DO, CO, MX, PE)
  name             text NOT NULL,
  currency_code    char(3) NOT NULL,               -- ISO 4217
  currency_symbol  text NOT NULL DEFAULT '$',
  decimal_places   smallint NOT NULL DEFAULT 2,
  phone_prefix     text NOT NULL,
  timezone_default text NOT NULL,
  -- Motor fiscal: nombre del impuesto, regimen, reglas de redondeo, formato
  -- de identificacion tributaria, y si exige facturacion electronica.
  -- Ej. DO: {"tax_label":"ITBIS","tax_id_label":"RNC",
  --          "einvoice":{"required":false,"standard":"e-CF","authority":"DGII"},
  --          "document_types":["B01","B02","B14","B15"],
  --          "rounding":{"mode":"half_up","precision":2},
  --          "prices_include_tax":true}
  fiscal_config    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active        boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- Reglas fiscales base por pais (semilla; el tenant las puede sobreescribir)
-- ---------------------------------------------------------------------
CREATE TABLE platform.tax_templates (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  country_code char(2) NOT NULL REFERENCES platform.countries(code),
  code         text NOT NULL,                      -- ITBIS_18, IVA_19, EXENTO
  name         text NOT NULL,
  rate         app.rate NOT NULL,
  kind         text NOT NULL DEFAULT 'vat'
               CHECK (kind IN ('vat','sales_tax','excise','withholding','tip','exempt')),
  applies_to   text NOT NULL DEFAULT 'goods'
               CHECK (applies_to IN ('goods','services','both')),
  is_default   boolean NOT NULL DEFAULT false,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (country_code, code)
);

-- ---------------------------------------------------------------------
-- PERFILES DE NEGOCIO -- el corazon del Engine de Nicho.
-- Un perfil es una PLANTILLA versionada. El tenant la instancia y puede
-- divergir; el versionado permite publicar mejoras sin romper clientes.
-- ---------------------------------------------------------------------
CREATE TABLE platform.business_profiles (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug         text NOT NULL UNIQUE,               -- vape_shop, barberia, farmacia, prestamista
  name         text NOT NULL,
  description  text,
  icon         text,
  category     text NOT NULL,                      -- retail, servicios, alimentos, salud, financiero
  -- Modo de operacion primario que enciende el layout del POS
  primary_mode text NOT NULL
               CHECK (primary_mode IN ('quick_pos','variant_inventory','appointments',
                                      'lending','tables','biological_lots','search_first')),
  is_public    boolean NOT NULL DEFAULT true,      -- visible en onboarding
  sort_order   int NOT NULL DEFAULT 100,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.business_profile_versions (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  profile_id   uuid NOT NULL REFERENCES platform.business_profiles(id) ON DELETE CASCADE,
  version      int NOT NULL,
  -- El manifiesto completo: modulos, atributos dinamicos, layout de UI,
  -- catalogo semilla, reglas de negocio, plantillas de ticket.
  -- Ver config/profiles/*.json y docs/01-ENGINE-NICHO.md
  manifest     jsonb NOT NULL,
  changelog    text,
  status       text NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','published','deprecated')),
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, version)
);

CREATE INDEX ON platform.business_profile_versions USING gin (manifest jsonb_path_ops);

-- ---------------------------------------------------------------------
-- Planes y suscripcion SaaS
-- ---------------------------------------------------------------------
CREATE TABLE platform.plans (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  code          text NOT NULL UNIQUE,              -- free, pro, business, enterprise
  name          text NOT NULL,
  price_monthly app.money NOT NULL DEFAULT 0,
  price_yearly  app.money NOT NULL DEFAULT 0,
  currency_code char(3) NOT NULL DEFAULT 'USD',
  -- Limites duros verificados por el backend:
  -- {"branches":1,"users":2,"products":300,"devices":2,
  --  "whatsapp_msgs_month":100,"storefront":false,"einvoice":false}
  limits        jsonb NOT NULL DEFAULT '{}'::jsonb,
  features      jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active     boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- TENANTS (Negocios)
-- ---------------------------------------------------------------------
CREATE TABLE platform.tenants (
  id                  uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  slug                text NOT NULL UNIQUE,        -- subdominio: mitienda.ocpos.app
  legal_name          text NOT NULL,
  trade_name          text NOT NULL,
  tax_id              text,                        -- RNC / NIT / RFC / RUC
  country_code        char(2) NOT NULL REFERENCES platform.countries(code),
  timezone            text NOT NULL DEFAULT 'America/Santo_Domingo',
  currency_code       char(3) NOT NULL,
  locale              text NOT NULL DEFAULT 'es-DO',

  -- Vinculo con el Engine de Nicho
  profile_id          uuid REFERENCES platform.business_profiles(id),
  profile_version_id  uuid REFERENCES platform.business_profile_versions(id),
  -- Overrides del tenant sobre el manifiesto (merge profundo en runtime).
  -- Aqui vive lo que el dueno activa/desactiva desde Ajustes.
  config_overrides    jsonb NOT NULL DEFAULT '{}'::jsonb,

  plan_id             uuid REFERENCES platform.plans(id),
  subscription_status text NOT NULL DEFAULT 'trialing'
                      CHECK (subscription_status IN ('trialing','active','past_due','paused','canceled')),
  trial_ends_at       timestamptz,
  current_period_end  timestamptz,

  -- Branding para tickets, storefront y WhatsApp
  -- {"logo_url":"...","primary_color":"#0F172A","receipt_footer":"Gracias"}
  branding            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"phone":"+18095551234","whatsapp":"+18095551234","email":"...","address":"..."}
  contact             jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Aislamiento fisico opcional (Enterprise): si no es 'rls', el router de
  -- conexiones apunta a otra BD/schema en lugar de usar RLS compartido.
  isolation_mode      text NOT NULL DEFAULT 'rls'
                      CHECK (isolation_mode IN ('rls','schema','database')),
  dedicated_dsn_ref   text,

  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','suspended','archived')),
  onboarded_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER touch BEFORE UPDATE ON platform.tenants
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

CREATE INDEX ON platform.tenants (country_code, status);
CREATE INDEX ON platform.tenants (profile_id);

-- ---------------------------------------------------------------------
-- Identidad global: un humano puede pertenecer a varios negocios
-- (contador que atiende 15 MiPyMEs, dueno con 2 marcas).
-- ---------------------------------------------------------------------
CREATE TABLE platform.identities (
  id                uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  email             citext,
  phone_e164        text,
  password_hash     text,                          -- argon2id
  full_name         text NOT NULL,
  avatar_url        text,
  mfa_secret        text,
  mfa_enabled       boolean NOT NULL DEFAULT false,
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at     timestamptz,
  locked_until      timestamptz,
  failed_attempts   smallint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE UNIQUE INDEX ON platform.identities (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ON platform.identities (phone_e164) WHERE phone_e164 IS NOT NULL;

-- Membresia identidad <-> tenant (el detalle de roles vive en app.users)
CREATE TABLE platform.tenant_memberships (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  identity_id uuid NOT NULL REFERENCES platform.identities(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  is_owner    boolean NOT NULL DEFAULT false,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('invited','active','suspended','removed')),
  invited_at  timestamptz,
  joined_at   timestamptz,
  UNIQUE (identity_id, tenant_id)
);

-- Auditoria a nivel plataforma (impersonation de soporte, cambios de plan)
CREATE TABLE platform.platform_audit (
  id        bigserial PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  actor     text NOT NULL,
  tenant_id uuid,
  action    text NOT NULL,
  payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip        inet
);
