-- =====================================================================
-- OC POS · 19 · Tablas rescatadas de los proyectos anteriores
-- =====================================================================
-- El modelo de OC POS se diseñó antes de revisar Turno, OC Credit y
-- Supermercado Silvia. Al consolidarlos aparecieron entidades que esos
-- sistemas YA tenían en producción y que aquí faltaban.
--
-- No son ideas nuevas: es funcionalidad que ya existe, escrita contra el
-- modelo unificado. Ver docs/05-CONSOLIDACION.md para el mapeo completo.
-- =====================================================================

-- =====================================================================
-- DE TURNO · Agenda (módulo appointments)
-- ---------------------------------------------------------------------
-- app.appointments ya existía, pero sin lo que la hace usable: el horario
-- de cada profesional y sus bloqueos. Sin esto no se pueden calcular los
-- huecos disponibles, que es el corazón del motor de reservas.
-- =====================================================================

-- Turno: modelo Disponibilidad
CREATE TABLE app.availability (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES app.employees(id) ON DELETE CASCADE,
  -- 0 = domingo … 6 = sábado (compatible con EXTRACT(dow))
  weekday      smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  starts_at    time NOT NULL,
  ends_at      time NOT NULL,
  -- Permite partir el día: 09:00-13:00 y 15:00-19:00 son dos filas
  is_active    boolean NOT NULL DEFAULT true,
  valid_from   date,
  valid_to     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON app.availability (tenant_id, employee_id, weekday) WHERE is_active;

-- Turno: modelo Bloqueo — vacaciones, ausencias, franjas cerradas
CREATE TABLE app.schedule_blocks (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id) ON DELETE CASCADE,
  -- employee_id NULL = cierra el negocio entero (feriado, inventario)
  employee_id  uuid REFERENCES app.employees(id) ON DELETE CASCADE,
  resource_id  uuid REFERENCES app.resources(id) ON DELETE CASCADE,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  slot         tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  reason       text,
  kind         text NOT NULL DEFAULT 'block'
               CHECK (kind IN ('block','vacation','sick_leave','holiday','maintenance')),
  created_by   uuid REFERENCES app.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  sync_seq     bigint,
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON app.schedule_blocks (tenant_id, employee_id, starts_at);
-- Un profesional no puede tener dos bloqueos solapados
ALTER TABLE app.schedule_blocks ADD CONSTRAINT schedule_blocks_no_overlap
  EXCLUDE USING gist (employee_id WITH =, slot WITH &&)
  WHERE (employee_id IS NOT NULL);

-- Turno: modelo Resena
CREATE TABLE app.reviews (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id),
  customer_id  uuid REFERENCES app.customers(id) ON DELETE SET NULL,
  employee_id  uuid REFERENCES app.employees(id) ON DELETE SET NULL,
  appointment_id uuid REFERENCES app.appointments(id) ON DELETE SET NULL,
  sale_id      uuid REFERENCES app.sales(id) ON DELETE SET NULL,
  rating       smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment      text,
  reply        text,                                -- respuesta del negocio
  replied_at   timestamptz,
  is_public    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Una reseña por cita: evita el spam de valoraciones
  UNIQUE (appointment_id)
);
CREATE INDEX ON app.reviews (tenant_id, employee_id) WHERE is_public;

-- Promedio y conteo, proyectados como en Turno (Negocio.ratingPromedio)
CREATE OR REPLACE FUNCTION app.tg_apply_review() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE app.employees e
     SET attributes = e.attributes || jsonb_build_object(
           'rating_avg', (SELECT round(avg(r.rating)::numeric, 2) FROM app.reviews r
                           WHERE r.employee_id = e.id AND r.is_public),
           'rating_count', (SELECT count(*) FROM app.reviews r
                             WHERE r.employee_id = e.id AND r.is_public))
   WHERE e.id = NEW.employee_id;
  RETURN NEW;
END $fn$;

CREATE TRIGGER apply_review AFTER INSERT OR UPDATE ON app.reviews
  FOR EACH ROW WHEN (NEW.employee_id IS NOT NULL)
  EXECUTE FUNCTION app.tg_apply_review();

-- =====================================================================
-- DE TURNO · Identidad
-- ---------------------------------------------------------------------
-- Turno tiene tres tablas de token (reset de contraseña, verificación de
-- email, refresh) y un flujo de invitación al equipo. app.sessions solo
-- cubría el refresh.
-- =====================================================================

CREATE TABLE platform.verification_tokens (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  identity_id  uuid NOT NULL REFERENCES platform.identities(id) ON DELETE CASCADE,
  purpose      text NOT NULL CHECK (purpose IN ('email_verify','password_reset','phone_verify','magic_link')),
  token_hash   text NOT NULL,                       -- nunca el token en claro
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON platform.verification_tokens (token_hash);
CREATE INDEX ON platform.verification_tokens (identity_id, purpose) WHERE used_at IS NULL;

-- Turno: modelo InvitacionNegocio
CREATE TABLE app.invitations (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id) ON DELETE CASCADE,
  role_id      uuid REFERENCES app.roles(id) ON DELETE SET NULL,
  email        citext,
  phone_e164   text,
  token_hash   text NOT NULL,
  invited_by   uuid REFERENCES app.users(id),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  accepted_by  uuid REFERENCES platform.identities(id),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON app.invitations (token_hash);
CREATE INDEX ON app.invitations (tenant_id) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- =====================================================================
-- DE OC CREDIT · Cobranza en ruta (módulo lending)
-- ---------------------------------------------------------------------
-- El préstamo de barrio no se cobra en el local: un cobrador recorre una
-- ruta con su teléfono. Sin esto, el módulo `lending` no es usable.
-- =====================================================================

CREATE TABLE app.collection_routes (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id),
  code         text NOT NULL,
  name         text NOT NULL,
  collector_id uuid REFERENCES app.employees(id) ON DELETE SET NULL,
  supervisor_id uuid REFERENCES app.employees(id) ON DELETE SET NULL,
  -- Días en que se recorre: 1=lunes … 7=domingo
  weekdays     smallint[] NOT NULL DEFAULT '{}',
  zone         text,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- Clientes asignados a la ruta, en orden de visita
CREATE TABLE app.route_customers (
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  route_id     uuid NOT NULL REFERENCES app.collection_routes(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES app.customers(id) ON DELETE CASCADE,
  position     smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (route_id, customer_id)
);

-- OC Credit: novedades_ruta — por qué no se cobró
CREATE TABLE app.route_events (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  route_id     uuid REFERENCES app.collection_routes(id) ON DELETE CASCADE,
  customer_id  uuid REFERENCES app.customers(id) ON DELETE SET NULL,
  account_id   uuid REFERENCES app.credit_accounts(id) ON DELETE SET NULL,
  employee_id  uuid REFERENCES app.employees(id),
  event_type   text NOT NULL CHECK (event_type IN
               ('visited','paid','partial','not_home','refused','moved',
                'promise','dispute','unreachable','closed_business')),
  promise_date date,
  amount       app.money,
  note         text,
  -- Prueba de que el cobrador estuvo allí
  geo_lat      numeric(10,7),
  geo_lng      numeric(10,7),
  geo_accuracy numeric(8,2),
  photo_url    text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  device_id    uuid REFERENCES app.devices(id),
  sync_seq     bigint
);
CREATE INDEX ON app.route_events (tenant_id, route_id, occurred_at DESC);
CREATE INDEX ON app.route_events (tenant_id, customer_id, occurred_at DESC);

-- OC Credit: feriados — un cronograma no puede vencer en día no laborable
CREATE TABLE app.holidays (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,
  country_code char(2) REFERENCES platform.countries(code),
  holiday_date date NOT NULL,
  name         text NOT NULL,
  -- Cómo se corre una cuota que cae en feriado
  shift_policy text NOT NULL DEFAULT 'next_business_day'
               CHECK (shift_policy IN ('next_business_day','previous_business_day','none')),
  is_national  boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (tenant_id, country_code, holiday_date)
);
CREATE INDEX ON app.holidays (holiday_date);

-- Corre una fecha al siguiente día hábil, saltando feriados
CREATE OR REPLACE FUNCTION app.next_business_day(
  p_date date, p_tenant uuid DEFAULT NULL, p_country char(2) DEFAULT NULL
) RETURNS date
LANGUAGE plpgsql STABLE AS $fn$
DECLARE d date := p_date; guard int := 0;
BEGIN
  LOOP
    EXIT WHEN guard > 30;
    IF EXTRACT(dow FROM d) NOT IN (0)                       -- domingo no laborable
       AND NOT EXISTS (SELECT 1 FROM app.holidays h
                        WHERE h.holiday_date = d
                          AND h.shift_policy <> 'none'
                          AND (h.tenant_id = p_tenant OR h.country_code = p_country))
    THEN RETURN d;
    END IF;
    d := d + 1; guard := guard + 1;
  END LOOP;
  RETURN d;
END $fn$;

-- =====================================================================
-- DE OC CREDIT · Detalle del préstamo
-- ---------------------------------------------------------------------
-- app.credit_accounts cubría el saldo, pero el préstamo de OC Credit
-- lleva un circuito de aprobación y renovaciones que hay que preservar.
-- =====================================================================
ALTER TABLE app.credit_accounts
  ADD COLUMN IF NOT EXISTS route_id            uuid REFERENCES app.collection_routes(id),
  ADD COLUMN IF NOT EXISTS collector_id        uuid REFERENCES app.employees(id),
  ADD COLUMN IF NOT EXISTS supervisor_id       uuid REFERENCES app.employees(id),
  ADD COLUMN IF NOT EXISTS approved_by         uuid REFERENCES app.users(id),
  ADD COLUMN IF NOT EXISTS approved_at         timestamptz,
  -- Solicitado vs aprobado vs entregado en mano: los tres difieren cuando
  -- se descuentan cargos o se liquida un préstamo anterior.
  ADD COLUMN IF NOT EXISTS requested_amount    app.money,
  ADD COLUMN IF NOT EXISTS disbursed_amount    app.money,
  -- Renovación: el préstamo nuevo liquida el saldo del viejo
  ADD COLUMN IF NOT EXISTS renews_account_id   uuid REFERENCES app.credit_accounts(id),
  ADD COLUMN IF NOT EXISTS settled_on_renewal  app.money,
  ADD COLUMN IF NOT EXISTS disbursed_at        timestamptz,
  ADD COLUMN IF NOT EXISTS first_due_date      date;

CREATE INDEX IF NOT EXISTS credit_accounts_route
  ON app.credit_accounts (tenant_id, route_id) WHERE route_id IS NOT NULL;

-- =====================================================================
-- DE OC CREDIT · Webhooks de pasarelas
-- ---------------------------------------------------------------------
-- Un webhook que llega dos veces no puede aplicar el pago dos veces.
-- =====================================================================
CREATE TABLE app.payment_webhooks (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid REFERENCES platform.tenants(id) ON DELETE CASCADE,
  provider      text NOT NULL,                      -- stripe, azul, wompi, cardnet
  event_type    text,
  -- Identificador del proveedor: la barrera contra el doble procesamiento
  provider_event_id text NOT NULL,
  signature     text,
  signature_valid boolean,
  payload       jsonb NOT NULL,
  status        text NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','processed','ignored','failed','duplicate')),
  error         text,
  attempts      smallint NOT NULL DEFAULT 0,
  -- A qué se aplicó
  payment_link_id uuid REFERENCES app.payment_links(id),
  credit_movement_id uuid REFERENCES app.credit_movements(id),
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (provider, provider_event_id)
);
CREATE INDEX ON app.payment_webhooks (status, received_at)
  WHERE status IN ('received','failed');

-- =====================================================================
-- DE SUPERMERCADO SILVIA · Comercio electrónico
-- ---------------------------------------------------------------------
-- app.online_orders cubría el pedido, pero no el carrito antes de
-- confirmarlo ni el flujo de devolución que Silvia ya tenía.
-- =====================================================================
CREATE TABLE app.carts (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  storefront_id uuid REFERENCES app.storefronts(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES app.customers(id) ON DELETE SET NULL,
  session_token text,                               -- comprador sin registro
  -- [{"variant_id":"…","qty":2,"unit_price":120}]
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal      app.money NOT NULL DEFAULT 0,
  expires_at    timestamptz,
  converted_order_id uuid REFERENCES app.online_orders(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.carts (tenant_id, storefront_id) WHERE converted_order_id IS NULL;
CREATE TRIGGER touch BEFORE UPDATE ON app.carts
  FOR EACH ROW EXECUTE FUNCTION app.tg_touch_updated_at();

-- Silvia: /devoluciones — solicitud del cliente, previa a la nota de crédito
CREATE TABLE app.return_requests (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  online_order_id uuid REFERENCES app.online_orders(id) ON DELETE CASCADE,
  sale_id       uuid REFERENCES app.sales(id) ON DELETE CASCADE,
  customer_id   uuid REFERENCES app.customers(id),
  code          text NOT NULL,
  reason        text NOT NULL,
  -- [{"sale_line_id":"…","qty":1,"reason":"dañado"}]
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos        text[] NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested','approved','rejected','received','refunded','canceled')),
  resolution_note text,
  reviewed_by   uuid REFERENCES app.users(id),
  reviewed_at   timestamptz,
  -- Se enlaza a la devolución real cuando se aprueba
  sale_return_id uuid REFERENCES app.sale_returns(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX ON app.return_requests (tenant_id, status, created_at DESC);
