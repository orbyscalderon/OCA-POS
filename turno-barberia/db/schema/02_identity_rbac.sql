-- =====================================================================
-- OC POS · 02 · Sucursales, Usuarios, RBAC granular y Dispositivos
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sucursales y almacenes
-- ---------------------------------------------------------------------
CREATE TABLE app.branches (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  address     text,
  phone       text,
  timezone    text,
  is_primary  boolean NOT NULL DEFAULT false,
  -- Overrides de config a nivel sucursal (ej. impresora, caja, storefront)
  settings    jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.branches
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

-- Un almacen es donde vive el stock. Una sucursal puede tener varios
-- (salon, bodega, vitrina, galpon, nevera) y existen almacenes virtuales
-- (transito, merma, consignacion) que hacen cuadrar el ledger.
CREATE TABLE app.warehouses (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL DEFAULT 'stock'
             CHECK (kind IN ('stock','transit','scrap','consignment','production','livestock')),
  is_default boolean NOT NULL DEFAULT false,
  is_active  boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- ---------------------------------------------------------------------
-- RBAC: permisos atomicos -> roles -> usuarios
-- El catalogo de permisos es global (semilla), pero un rol puede estar
-- OCULTO segun el perfil de negocio (ej. 'lending.*' solo en prestamista).
-- ---------------------------------------------------------------------
CREATE TABLE platform.permissions (
  code        text PRIMARY KEY,                    -- 'sales.void', 'inventory.adjust'
  module      text NOT NULL,                       -- sales, inventory, credit, finance, agro...
  name        text NOT NULL,
  description text,
  -- Permiso de alto riesgo: siempre auditado y puede exigir PIN de supervisor
  is_sensitive boolean NOT NULL DEFAULT false,
  -- Solo visible si el manifiesto del perfil habilita estos modulos
  requires_modules text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE app.roles (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  code         text NOT NULL,                      -- admin, cajero, inventario, contador
  name         text NOT NULL,
  description  text,
  is_system    boolean NOT NULL DEFAULT false,     -- creado por el engine, no borrable
  -- Restricciones operativas del rol, evaluadas en el POS:
  -- {"max_discount_pct":10,"can_sell_below_cost":false,
  --  "requires_supervisor_pin":["sales.void","inventory.adjust"],
  --  "shift_window":{"from":"08:00","to":"22:00"}}
  constraints  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.role_permissions (
  tenant_id       uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  role_id         uuid NOT NULL REFERENCES app.roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES platform.permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE app.users (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  identity_id   uuid REFERENCES platform.identities(id) ON DELETE SET NULL,
  role_id       uuid NOT NULL REFERENCES app.roles(id),
  display_name  text NOT NULL,
  -- PIN corto (hash) para cambio rapido de cajero en la misma tablet
  pin_hash      text,
  employee_code text,
  -- Overrides puntuales sobre el rol, sin crear un rol nuevo
  extra_permissions   text[] NOT NULL DEFAULT '{}',
  revoked_permissions text[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, identity_id)
);
CREATE TRIGGER touch BEFORE UPDATE ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

-- Alcance por sucursal: un cajero solo ve su tienda; el contador ve todas
CREATE TABLE app.user_branch_access (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, branch_id)
);

-- ---------------------------------------------------------------------
-- Dispositivos (crítico para offline-first y numeracion fiscal)
-- ---------------------------------------------------------------------
CREATE TABLE app.devices (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id      uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  -- Identificador corto y UNICO por tenant. Se usa como prefijo/offset en la
  -- numeracion de documentos offline para que nunca colisionen dos cajas.
  device_no      smallint NOT NULL CHECK (device_no BETWEEN 1 AND 999),
  name           text NOT NULL,                    -- "Caja 1 - Tablet Samsung"
  platform       text,                             -- android, ios, web, windows
  push_token     text,
  -- Hardware conectado, leido por el frontend para habilitar UI
  -- {"printer":{"kind":"escpos_bt","mac":"..","width":58},
  --  "scanner":{"kind":"usb_hid"},
  --  "scale":{"kind":"serial","protocol":"cas_ap","port":"COM3"}}
  peripherals    jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at   timestamptz,
  last_sync_at   timestamptz,
  -- Reloj logico del dispositivo para el algoritmo de sync (ver 14_audit_sync)
  last_pulled_seq bigint NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, device_no)
);

-- Sesiones / refresh tokens
CREATE TABLE app.sessions (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
  device_id     uuid REFERENCES app.devices(id) ON DELETE SET NULL,
  refresh_hash  text NOT NULL,
  ip            inet,
  user_agent    text,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.sessions (tenant_id, user_id) WHERE revoked_at IS NULL;
