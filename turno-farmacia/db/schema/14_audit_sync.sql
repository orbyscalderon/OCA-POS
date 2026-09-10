-- =====================================================================
-- OC POS · 14 · Auditoría Imborrable y Motor de Sincronización
-- =====================================================================

-- ---------------------------------------------------------------------
-- RELOJ LOGICO GLOBAL
-- Cada fila sincronizable recibe un sync_seq monotono. El cliente guarda
-- su cursor y pide "dame todo lo que tenga sync_seq > mi_cursor".
-- Simple, sin depender de relojes de pared (que en tablets van mal).
-- ---------------------------------------------------------------------
CREATE SEQUENCE app.sync_seq_global AS bigint START 1;

CREATE OR REPLACE FUNCTION app.tg_stamp_sync_seq() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.sync_seq := nextval('app.sync_seq_global');
  RETURN NEW;
END $fn$;

-- Se aplica a toda tabla que tenga la columna sync_seq
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'app' AND c.column_name = 'sync_seq'
  LOOP
    EXECUTE format(
      'CREATE TRIGGER stamp_sync_seq BEFORE INSERT OR UPDATE ON app.%I
         FOR EACH ROW EXECUTE FUNCTION app.tg_stamp_sync_seq()', r.table_name);
  END LOOP;
END $do$;

-- =====================================================================
-- ★ AUDIT LOG IMBORRABLE (cadena de hash tipo blockchain ligera)
-- ---------------------------------------------------------------------
-- Cada registro incluye el hash del anterior DEL MISMO TENANT. Si alguien
-- con acceso a la BD borra o edita una fila, la cadena se rompe y el
-- verificador lo detecta. Ademas:
--   · trigger que prohibe UPDATE/DELETE
--   · el rol de aplicacion solo tiene INSERT y SELECT (ver 99)
-- =====================================================================
-- PARTICIONADO POR MES. Es la tabla que crece sin techo y la única que
-- necesita retención por antigüedad: separar un mes viejo es un DETACH
-- instantáneo en vez de un DELETE de millones de filas.
-- Nota: al particionar, la PK debe incluir la clave de partición.
-- `audit_logs` lo tolera porque nadie la referencia por FK y su
-- identidad operativa es (tenant_id, seq), no `seq` a secas.
CREATE TABLE app.audit_logs (
  seq           bigint GENERATED ALWAYS AS IDENTITY,
  id            uuid NOT NULL DEFAULT app.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  branch_id     uuid,
  -- QUIEN
  user_id       uuid,
  user_name     text,                               -- snapshot: el usuario puede borrarse
  role_code     text,
  device_id     uuid,
  ip            inet,
  -- QUE
  action        text NOT NULL,                      -- 'sale.void','stock.adjust','cash.open'
  entity_type   text NOT NULL,
  entity_id     uuid,
  severity      text NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','notice','warning','critical')),
  -- Los eventos marcados 'critical' alimentan el tablero antirrobo:
  -- anulaciones, descuentos fuera de politica, ajustes de stock a la baja,
  -- aperturas de caja fuera de horario, edicion de marcajes.
  before_data   jsonb,
  after_data    jsonb,
  -- Contexto libre: motivo, monto, supervisor que autorizo
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount        app.money,
  reason        text,
  approved_by   uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  -- CADENA DE INTEGRIDAD
  prev_hash     bytea,
  row_hash      bytea NOT NULL,
  sync_seq      bigint,
  PRIMARY KEY (seq, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ON app.audit_logs (tenant_id, occurred_at DESC);
CREATE INDEX ON app.audit_logs (tenant_id, seq DESC);   -- lo usa la cadena de hash
CREATE INDEX ON app.audit_logs (tenant_id, action, occurred_at DESC);
CREATE INDEX ON app.audit_logs (tenant_id, user_id, occurred_at DESC);
CREATE INDEX ON app.audit_logs (tenant_id, entity_type, entity_id);
CREATE INDEX ON app.audit_logs (tenant_id, severity) WHERE severity = 'critical';

-- Crea la partición del mes indicado si no existe. La invoca un job
-- mensual con 3 meses de anticipación; es idempotente.
CREATE OR REPLACE FUNCTION app.ensure_audit_partition(p_month date)
RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE
  v_start date := date_trunc('month', p_month)::date;
  v_end   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name  text := format('audit_logs_%s', to_char(v_start, 'YYYY_MM'));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app' AND c.relname = v_name
  ) THEN
    EXECUTE format(
      'CREATE TABLE app.%I PARTITION OF app.audit_logs FOR VALUES FROM (%L) TO (%L)',
      v_name, v_start, v_end);
  END IF;
  RETURN v_name;
END $fn$;

-- Partición de escape: nada se pierde si el job de mantenimiento falla.
CREATE TABLE app.audit_logs_default PARTITION OF app.audit_logs DEFAULT;

-- Particiones del mes actual y los tres siguientes
DO $do$
DECLARE i int;
BEGIN
  FOR i IN 0..3 LOOP
    PERFORM app.ensure_audit_partition((CURRENT_DATE + (i || ' month')::interval)::date);
  END LOOP;
END $do$;

CREATE OR REPLACE FUNCTION app.tg_audit_hash_chain() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_prev bytea;
BEGIN
  -- Serializa las inserciones del tenant para que la cadena no se bifurque
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text, 42));

  SELECT row_hash INTO v_prev
    FROM app.audit_logs
   WHERE tenant_id = NEW.tenant_id
   ORDER BY seq DESC LIMIT 1;

  NEW.prev_hash := v_prev;
  NEW.recorded_at := now();
  NEW.row_hash := digest(
      COALESCE(encode(v_prev, 'hex'), 'GENESIS')
      || '|' || NEW.tenant_id::text
      || '|' || COALESCE(NEW.user_id::text, '-')
      || '|' || NEW.action
      || '|' || NEW.entity_type
      || '|' || COALESCE(NEW.entity_id::text, '-')
      || '|' || COALESCE(NEW.amount::text, '-')
      || '|' || COALESCE(NEW.before_data::text, '-')
      || '|' || COALESCE(NEW.after_data::text, '-')
      || '|' || NEW.occurred_at::text,
    'sha256');
  RETURN NEW;
END $fn$;

CREATE TRIGGER hash_chain BEFORE INSERT ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.tg_audit_hash_chain();

CREATE TRIGGER no_update BEFORE UPDATE OR DELETE ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.tg_append_only();

-- Verificador: recorre la cadena y devuelve la primera rotura
CREATE OR REPLACE FUNCTION app.verify_audit_chain(p_tenant uuid)
RETURNS TABLE (broken_seq bigint, expected bytea, found bytea)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  r      record;
  v_prev bytea := NULL;
  v_calc bytea;
BEGIN
  FOR r IN
    SELECT * FROM app.audit_logs WHERE tenant_id = p_tenant ORDER BY seq
  LOOP
    v_calc := digest(
        COALESCE(encode(v_prev, 'hex'), 'GENESIS')
        || '|' || r.tenant_id::text
        || '|' || COALESCE(r.user_id::text, '-')
        || '|' || r.action
        || '|' || r.entity_type
        || '|' || COALESCE(r.entity_id::text, '-')
        || '|' || COALESCE(r.amount::text, '-')
        || '|' || COALESCE(r.before_data::text, '-')
        || '|' || COALESCE(r.after_data::text, '-')
        || '|' || r.occurred_at::text,
      'sha256');
    IF v_calc IS DISTINCT FROM r.row_hash THEN
      broken_seq := r.seq; expected := v_calc; found := r.row_hash;
      RETURN NEXT;
      RETURN;
    END IF;
    v_prev := r.row_hash;
  END LOOP;
END $fn$;

-- =====================================================================
-- ★ MOTOR DE SINCRONIZACION OFFLINE -> ONLINE
-- =====================================================================

-- Bitacora de operaciones recibidas del cliente. Es el punto de
-- IDEMPOTENCIA: si la tablet reintenta el mismo push 5 veces, se aplica 1.
CREATE TABLE app.sync_operations (
  id             uuid PRIMARY KEY,                  -- generado en el cliente
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  device_id      uuid NOT NULL REFERENCES app.devices(id),
  user_id        uuid REFERENCES app.users(id),
  -- Lote de push: permite aplicar N operaciones en una sola transaccion
  batch_id       uuid NOT NULL,
  -- Contador monotono POR DISPOSITIVO. Garantiza que las operaciones de una
  -- misma tablet se apliquen en el orden en que ocurrieron.
  device_lamport bigint NOT NULL,
  entity_type    text NOT NULL,                     -- 'sale','stock_event','credit_movement'
  entity_id      uuid NOT NULL,
  op             text NOT NULL CHECK (op IN ('insert','update','delete','command')),
  payload        jsonb NOT NULL,
  -- Version de la entidad que el cliente creia tener (para deteccion de
  -- conflicto en entidades de estado, no en las de ledger)
  base_version   bigint,
  client_time    timestamptz NOT NULL,
  received_at    timestamptz NOT NULL DEFAULT now(),
  applied_at     timestamptz,
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','applied','conflict','rejected','duplicate')),
  result         jsonb,
  error          text,
  attempts       smallint NOT NULL DEFAULT 0,
  UNIQUE (device_id, device_lamport)
);
CREATE INDEX ON app.sync_operations (tenant_id, status, received_at);
CREATE INDEX ON app.sync_operations (tenant_id, batch_id);

-- Conflictos detectados y como se resolvieron (visible para el dueno)
CREATE TABLE app.sync_conflicts (
  id             uuid PRIMARY KEY DEFAULT app.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN (
                   'oversell',            -- se vendio mas stock del que habia
                   'concurrent_update',   -- dos dispositivos editaron lo mismo
                   'duplicate_document',  -- mismo numero fiscal/local
                   'credit_limit_exceeded',
                   'closed_period',       -- venta con fecha de una caja ya cerrada
                   'deleted_entity',      -- se vendio un producto borrado en otro equipo
                   'price_mismatch')),
  entity_type    text NOT NULL,
  entity_id      uuid,
  variant_id     uuid REFERENCES app.product_variants(id),
  warehouse_id   uuid REFERENCES app.warehouses(id),
  operation_id   uuid REFERENCES app.sync_operations(id),
  -- Estados en pugna
  server_state   jsonb,
  client_state   jsonb,
  -- Resolucion automatica aplicada
  resolution     text NOT NULL CHECK (resolution IN (
                   'accepted_both',       -- ledger conmutativo: ambas ventas valen
                   'server_wins','client_wins','merged','manual_required','rejected')),
  resolution_note text,
  -- Efecto colateral que hay que resolver en el mundo real
  requires_action boolean NOT NULL DEFAULT false,
  action_taken   text,
  resolved_by    uuid REFERENCES app.users(id),
  resolved_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.sync_conflicts (tenant_id, requires_action, created_at DESC);

-- Estado del cursor de cada dispositivo por entidad (pull incremental)
CREATE TABLE app.sync_cursors (
  tenant_id    uuid NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  device_id    uuid NOT NULL REFERENCES app.devices(id) ON DELETE CASCADE,
  entity_type  text NOT NULL,
  last_seq     bigint NOT NULL DEFAULT 0,
  last_pull_at timestamptz,
  PRIMARY KEY (device_id, entity_type)
);

-- ---------------------------------------------------------------------
-- Deteccion de sobreventa. NO bloquea el sync (la venta ya ocurrio en el
-- mundo real y el ticket ya se imprimio): registra el conflicto, deja el
-- stock en negativo y avisa al dueno para que decida.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.detect_oversell() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  v_qty   app.qty;
  v_allow boolean;
BEGIN
  IF NEW.delta_qty >= 0 OR NEW.reason NOT IN ('sale','consumption','production_input') THEN
    RETURN NEW;
  END IF;

  SELECT b.qty_on_hand INTO v_qty
    FROM app.stock_balances b
   WHERE b.warehouse_id = NEW.warehouse_id
     AND b.variant_id   = NEW.variant_id
     AND b.lot_id IS NOT DISTINCT FROM NEW.lot_id;

  IF v_qty IS NOT NULL AND v_qty < 0 THEN
    SELECT p.allow_negative_stock INTO v_allow
      FROM app.product_variants v JOIN app.products p ON p.id = v.product_id
     WHERE v.id = NEW.variant_id;

    IF NOT COALESCE(v_allow, false) THEN
      INSERT INTO app.sync_conflicts
        (tenant_id, kind, entity_type, entity_id, variant_id, warehouse_id,
         server_state, client_state, resolution, resolution_note, requires_action)
      VALUES (NEW.tenant_id, 'oversell', 'stock_event', NEW.id,
              NEW.variant_id, NEW.warehouse_id,
              jsonb_build_object('qty_on_hand_after', v_qty),
              jsonb_build_object('delta_qty', NEW.delta_qty,
                                 'device_id', NEW.device_id,
                                 'occurred_at', NEW.occurred_at),
              'accepted_both',
              'Venta aceptada: el ledger es conmutativo y el ticket ya se entrego. '
              || 'Stock quedo negativo; requiere reposicion o nota de credito.',
              true);
    END IF;
  END IF;
  RETURN NEW;
END $fn$;

CREATE TRIGGER detect_oversell AFTER INSERT ON app.stock_events
  FOR EACH ROW EXECUTE FUNCTION app.detect_oversell();
