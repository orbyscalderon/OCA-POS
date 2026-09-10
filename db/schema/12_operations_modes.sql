-- =====================================================================
-- OC POS · 12 · Modos Operativos: Citas, Mesas/Comandas, Órdenes de
--                Servicio, Empleados, Asistencia y Comisiones
-- =====================================================================
-- Estas tablas existen SIEMPRE, pero el Engine de Nicho decide cuales
-- endpoints/pantallas se exponen. Una barberia ve "Citas"; un restaurante
-- ve "Mesas"; un taller ve "Ordenes de servicio"; una tienda no ve ninguna.
-- =====================================================================

-- ---------------------------------------------------------------------
-- EMPLEADOS (extiende app.users con datos laborales)
-- ---------------------------------------------------------------------
CREATE TABLE app.employees (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES app.users(id) ON DELETE SET NULL,
  branch_id      uuid REFERENCES app.branches(id),
  code           text,
  full_name      text NOT NULL,
  position       text,                              -- barbero, cajero, veterinario
  doc_number     text,
  phone_e164     text,
  hired_at       date,
  terminated_at  date,
  -- Remuneracion
  pay_kind       text NOT NULL DEFAULT 'salary'
                 CHECK (pay_kind IN ('salary','hourly','commission','mixed')),
  base_salary    app.money NOT NULL DEFAULT 0,
  hourly_rate    app.money NOT NULL DEFAULT 0,
  -- Reglas de comision, evaluadas por el motor al cerrar la venta:
  -- {"default_pct":0.40,
  --  "by_category":[{"category_id":"...","pct":0.5}],
  --  "by_product":[{"variant_id":"...","amount":50}],
  --  "on":"margin"}   on: revenue | margin | qty
  commission_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Agenda para el modo citas
  -- {"mon":[["09:00","18:00"]],"sat":[["09:00","14:00"]]}
  work_schedule  jsonb NOT NULL DEFAULT '{}'::jsonb,
  attributes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_bookable    boolean NOT NULL DEFAULT false,    -- aparece en la agenda
  color          text,
  photo_url      text,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

-- Cierra la referencia diferida desde 07_sales_pos: la linea de venta
-- registra QUE EMPLEADO la atendio, y employee_commissions liquida sobre
-- esa misma clave. Antes apuntaba a app.users y el join era imposible.
ALTER TABLE app.sale_lines
  ADD CONSTRAINT salelines_employee_fk
  FOREIGN KEY (employee_id) REFERENCES app.employees(id) ON DELETE SET NULL;

-- Marcaje de asistencia (clock in/out) — funciona offline
CREATE TABLE app.time_entries (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES app.employees(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES app.branches(id),
  device_id    uuid REFERENCES app.devices(id),
  entry_type   text NOT NULL CHECK (entry_type IN ('clock_in','clock_out','break_start','break_end')),
  occurred_at  timestamptz NOT NULL,
  -- Anti-fraude: geocerca y foto del marcaje
  geo_lat      numeric(10,7),
  geo_lng      numeric(10,7),
  geofence_ok  boolean,
  photo_url    text,
  note         text,
  edited_by    uuid REFERENCES app.users(id),       -- toda edicion queda auditada
  sync_seq     bigint
);
CREATE INDEX ON app.time_entries (tenant_id, employee_id, occurred_at DESC);

CREATE TABLE app.employee_commissions (
  id           uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  employee_id  uuid NOT NULL REFERENCES app.employees(id) ON DELETE CASCADE,
  sale_line_id uuid REFERENCES app.sale_lines(id) ON DELETE CASCADE,
  sale_id      uuid REFERENCES app.sales(id),
  basis        text NOT NULL CHECK (basis IN ('revenue','margin','qty','fixed')),
  basis_amount app.money NOT NULL DEFAULT 0,
  rate         app.rate,
  amount       app.money NOT NULL,
  period       date,                                -- periodo de liquidacion
  status       text NOT NULL DEFAULT 'accrued'
               CHECK (status IN ('accrued','approved','paid','canceled')),
  paid_at      timestamptz,
  expense_id   uuid REFERENCES app.expenses(id)
);
CREATE INDEX ON app.employee_commissions (tenant_id, employee_id, period);

-- ---------------------------------------------------------------------
-- MODO CITAS / RESERVAS (barberia, spa, veterinaria, taller)
-- ---------------------------------------------------------------------
CREATE TABLE app.resources (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('chair','room','bay','table','equipment')),
  code        text NOT NULL,
  name        text NOT NULL,
  capacity    smallint NOT NULL DEFAULT 1,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.appointments (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES app.branches(id),
  customer_id   uuid REFERENCES app.customers(id),
  employee_id   uuid REFERENCES app.employees(id),
  resource_id   uuid REFERENCES app.resources(id),
  code          text NOT NULL,
  -- Servicios reservados: [{"variant_id":"...","qty":1,"duration_min":30}]
  services      jsonb NOT NULL DEFAULT '[]'::jsonb,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  slot          tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  status        text NOT NULL DEFAULT 'booked'
                CHECK (status IN ('booked','confirmed','in_progress','completed',
                                  'no_show','canceled','rescheduled')),
  source        text NOT NULL DEFAULT 'pos'
                CHECK (source IN ('pos','storefront','whatsapp','phone','walk_in')),
  estimated_total app.money,
  deposit_amount  app.money NOT NULL DEFAULT 0,
  sale_id       uuid REFERENCES app.sales(id),
  note          text,
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  reminder_sent_at timestamptz,
  created_by    uuid REFERENCES app.users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  sync_seq      bigint,
  UNIQUE (tenant_id, code),
  CHECK (ends_at > starts_at)
);
-- La BD impide doble reserva del mismo barbero/silla en el mismo horario
ALTER TABLE app.appointments ADD CONSTRAINT appointments_no_overlap_employee
  EXCLUDE USING gist (employee_id WITH =, slot WITH &&)
  WHERE (status IN ('booked','confirmed','in_progress') AND employee_id IS NOT NULL);
ALTER TABLE app.appointments ADD CONSTRAINT appointments_no_overlap_resource
  EXCLUDE USING gist (resource_id WITH =, slot WITH &&)
  WHERE (status IN ('booked','confirmed','in_progress') AND resource_id IS NOT NULL);
CREATE INDEX ON app.appointments (tenant_id, branch_id, starts_at);

ALTER TABLE app.sale_lines
  ADD CONSTRAINT salelines_appointment_fk
  FOREIGN KEY (appointment_id) REFERENCES app.appointments(id);

-- ---------------------------------------------------------------------
-- MODO MESAS / COMANDAS (restaurante, bar, colmado con consumo)
-- ---------------------------------------------------------------------
CREATE TABLE app.service_areas (
  id         uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES app.branches(id) ON DELETE CASCADE,
  name       text NOT NULL,                         -- Salon, Terraza, Barra
  position   smallint NOT NULL DEFAULT 0
);

CREATE TABLE app.tables (
  id          uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  area_id     uuid NOT NULL REFERENCES app.service_areas(id) ON DELETE CASCADE,
  code        text NOT NULL,
  seats       smallint NOT NULL DEFAULT 4,
  status      text NOT NULL DEFAULT 'free'
              CHECK (status IN ('free','occupied','reserved','billing','cleaning')),
  -- Posicion en el plano visual del salon
  layout      jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.table_orders (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id    uuid NOT NULL REFERENCES app.branches(id),
  table_id     uuid REFERENCES app.tables(id),
  code         text NOT NULL,
  guests       smallint NOT NULL DEFAULT 1,
  waiter_id    uuid REFERENCES app.employees(id),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open','sent_to_kitchen','served','billing','closed','canceled')),
  -- Cuenta dividida: [{"label":"A","lines":[...]},{"label":"B",...}]
  split_config jsonb,
  opened_at    timestamptz NOT NULL DEFAULT now(),
  closed_at    timestamptz,
  sale_id      uuid REFERENCES app.sales(id),
  sync_seq     bigint,
  UNIQUE (tenant_id, code)
);

CREATE TABLE app.table_order_items (
  id           uuid PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES app.table_orders(id) ON DELETE CASCADE,
  variant_id   uuid NOT NULL REFERENCES app.product_variants(id),
  qty          app.qty NOT NULL,
  unit_price   app.money NOT NULL,
  -- Modificadores: [{"name":"Sin cebolla"},{"name":"Extra queso","price":50}]
  modifiers    jsonb NOT NULL DEFAULT '[]'::jsonb,
  course       smallint,                            -- tiempo (entrada/plato/postre)
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','preparing','ready','served','canceled')),
  sent_at      timestamptz,
  canceled_by  uuid REFERENCES app.users(id),
  cancel_reason text,
  note         text
);
CREATE INDEX ON app.table_order_items (tenant_id, order_id);

-- ---------------------------------------------------------------------
-- ORDENES DE SERVICIO / REPARACIONES (taller, tecnico, veterinaria)
-- ---------------------------------------------------------------------
CREATE TABLE app.service_orders (
  id            uuid PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid NOT NULL REFERENCES app.branches(id),
  customer_id   uuid REFERENCES app.customers(id),
  code          text NOT NULL,
  -- El objeto que entra al taller. Atributos definidos por el perfil:
  -- Taller:      {"marca":"Yamaha","placa":"K123456","km":18500}
  -- Veterinaria: {"mascota":"Firulais","especie":"canino","peso_kg":12}
  subject       jsonb NOT NULL DEFAULT '{}'::jsonb,
  reported_issue text,
  diagnosis     text,
  technician_id uuid REFERENCES app.employees(id),
  status        text NOT NULL DEFAULT 'received'
                CHECK (status IN ('received','diagnosing','quoted','approved','in_progress',
                                  'waiting_parts','completed','delivered','canceled')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  quoted_total  app.money,
  approved_at   timestamptz,
  promised_at   timestamptz,
  completed_at  timestamptz,
  delivered_at  timestamptz,
  warranty_days smallint,
  sale_id       uuid REFERENCES app.sales(id),
  attachments   text[] NOT NULL DEFAULT '{}',
  attributes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sync_seq      bigint,
  UNIQUE (tenant_id, code)
);
CREATE INDEX ON app.service_orders (tenant_id, status, created_at DESC);

ALTER TABLE app.sale_lines
  ADD CONSTRAINT salelines_serviceorder_fk
  FOREIGN KEY (service_order_id) REFERENCES app.service_orders(id);

-- Repuestos y mano de obra consumidos por la orden
CREATE TABLE app.service_order_lines (
  id            uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  service_order_id uuid NOT NULL REFERENCES app.service_orders(id) ON DELETE CASCADE,
  variant_id    uuid REFERENCES app.product_variants(id),
  kind          text NOT NULL DEFAULT 'part' CHECK (kind IN ('part','labor','fee')),
  description   text NOT NULL,
  qty           app.qty NOT NULL DEFAULT 1,
  unit_price    app.money NOT NULL DEFAULT 0,
  unit_cost     app.unit_cost NOT NULL DEFAULT 0,
  is_approved   boolean NOT NULL DEFAULT false,
  stock_event_id uuid REFERENCES app.stock_events(id)
);
