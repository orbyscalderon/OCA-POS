-- =====================================================================
-- OC POS · 18 · Funciones operativas
-- =====================================================================
-- Cierra los cabos sueltos del modelo: columnas que estaban declaradas
-- pero que nadie mantenía (overdue_amount, expected_cash, qty_reserved),
-- más la reproyección de ledgers y la retención de históricos.
-- =====================================================================

-- =====================================================================
-- 1 · ESTADO DE MORA — mantiene customers.overdue_amount,
--     credit_accounts.days_overdue/status y credit_installments.
--     La ejecuta el job diario `accrue-interest` antes de devengar.
-- =====================================================================
CREATE OR REPLACE FUNCTION app.refresh_credit_status(p_tenant uuid)
RETURNS TABLE (accounts_updated int, customers_updated int)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_accounts  int;
  v_customers int;
BEGIN
  -- 1.1 Cuotas vencidas
  UPDATE app.credit_installments i
     SET days_overdue = GREATEST(CURRENT_DATE - i.due_date, 0),
         status = CASE
                    WHEN i.paid_amount >= i.total_due            THEN 'paid'
                    WHEN CURRENT_DATE > i.due_date               THEN 'overdue'
                    WHEN i.paid_amount > 0                       THEN 'partially_paid'
                    ELSE 'pending'
                  END
   WHERE i.tenant_id = p_tenant
     AND i.status <> 'waived';

  -- 1.2 Cuentas: días de atraso desde la cuota vencida más antigua,
  --     o desde due_date en las libretas de fiado sin cronograma.
  WITH oldest AS (
    SELECT i.account_id, MIN(i.due_date) AS first_due
      FROM app.credit_installments i
     WHERE i.tenant_id = p_tenant
       AND i.balance > 0
       AND i.status IN ('pending','partially_paid','overdue')
     GROUP BY i.account_id
  ),
  src AS (
    -- Una fila por cuenta del tenant, con o sin cronograma
    SELECT a.id AS account_id, o.first_due
      FROM app.credit_accounts a
      LEFT JOIN oldest o ON o.account_id = a.id
     WHERE a.tenant_id = p_tenant
  )
  UPDATE app.credit_accounts a
     SET days_overdue = GREATEST(
           CURRENT_DATE - COALESCE(src.first_due, a.due_date, CURRENT_DATE), 0),
         status = CASE
                    WHEN a.status IN ('written_off','legal','canceled')     THEN a.status
                    WHEN a.balance <= 0                                     THEN 'paid'
                    WHEN CURRENT_DATE > COALESCE(src.first_due, a.due_date,
                                                 CURRENT_DATE + 1)          THEN 'overdue'
                    ELSE 'current'
                  END,
         closed_at = CASE WHEN a.balance <= 0 AND a.closed_at IS NULL
                          THEN now() ELSE a.closed_at END,
         updated_at = now()
    FROM src
   WHERE a.id = src.account_id;
  GET DIAGNOSTICS v_accounts = ROW_COUNT;

  -- 1.3 Saldos agregados del cliente. `overdue_amount` es lo que estaba
  --     declarado y nunca se calculaba.
  UPDATE app.customers c
     SET balance_due = COALESCE(agg.total, 0),
         overdue_amount = COALESCE(agg.overdue, 0),
         updated_at = now()
    FROM (
      SELECT a.customer_id,
             SUM(a.balance)                                          AS total,
             SUM(a.balance) FILTER (WHERE a.status = 'overdue')      AS overdue
        FROM app.credit_accounts a
       WHERE a.tenant_id = p_tenant
         AND a.status NOT IN ('paid','canceled','written_off')
       GROUP BY a.customer_id
    ) agg
   WHERE c.id = agg.customer_id AND c.tenant_id = p_tenant;
  GET DIAGNOSTICS v_customers = ROW_COUNT;

  -- Clientes que quedaron sin cuentas abiertas vuelven a cero
  UPDATE app.customers c
     SET balance_due = 0, overdue_amount = 0, updated_at = now()
   WHERE c.tenant_id = p_tenant
     AND (c.balance_due <> 0 OR c.overdue_amount <> 0)
     AND NOT EXISTS (
       SELECT 1 FROM app.credit_accounts a
        WHERE a.customer_id = c.id
          AND a.status NOT IN ('paid','canceled','written_off')
          AND a.balance > 0);

  accounts_updated := v_accounts;
  customers_updated := v_customers;
  RETURN NEXT;
END $fn$;

-- =====================================================================
-- 2 · CIERRE DE CAJA — calcula expected_cash y el desglose por método.
--     `expected_cash` estaba declarada y nadie la computaba.
-- =====================================================================
CREATE OR REPLACE FUNCTION app.close_cash_session(
  p_session   uuid,
  p_counted   app.money,
  p_user      uuid,
  p_note      text DEFAULT NULL,
  p_variance_reason text DEFAULT NULL
) RETURNS app.cash_sessions
LANGUAGE plpgsql AS $fn$
DECLARE
  s            app.cash_sessions%ROWTYPE;
  v_cash_sales     app.money := 0;
  v_cash_collect   app.money := 0;
  v_cash_refunds   app.money := 0;
  v_in             app.money := 0;
  v_out            app.money := 0;
  v_by_method      jsonb     := '{}'::jsonb;
BEGIN
  SELECT * INTO s FROM app.cash_sessions WHERE id = p_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión de caja % inexistente', p_session;
  END IF;
  IF s.status = 'closed' THEN
    RAISE EXCEPTION 'La sesión de caja % ya está cerrada', p_session
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- Ventas cobradas en efectivo (neto del vuelto entregado)
  SELECT COALESCE(SUM(sp.amount - sp.change), 0) INTO v_cash_sales
    FROM app.sale_payments sp
    JOIN app.sales sa            ON sa.id = sp.sale_id
    JOIN app.payment_methods pm  ON pm.id = sp.payment_method_id
   WHERE sa.cash_session_id = p_session
     AND sa.status <> 'voided'
     AND pm.kind = 'cash';

  -- Abonos de fiado recibidos en efectivo (los pagos van con signo negativo)
  SELECT COALESCE(SUM(ABS(cm.amount)), 0) INTO v_cash_collect
    FROM app.credit_movements cm
    JOIN app.payment_methods pm ON pm.id = cm.payment_method_id
   WHERE cm.cash_session_id = p_session
     AND cm.movement_type = 'payment'
     AND pm.kind = 'cash';

  -- Devoluciones pagadas en efectivo
  SELECT COALESCE(SUM(r.total), 0) INTO v_cash_refunds
    FROM app.sale_returns r
   WHERE r.cash_session_id = p_session
     AND r.refund_method IN ('cash','original');

  -- Entradas y salidas manuales de la gaveta
  SELECT COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'in'), 0),
         COALESCE(SUM(m.amount) FILTER (WHERE m.direction = 'out'), 0)
    INTO v_in, v_out
    FROM app.cash_movements m
   WHERE m.session_id = p_session
     AND m.kind <> 'opening_float';   -- el fondo ya está en opening_amount

  -- Desglose por método para el reporte Z
  SELECT COALESCE(jsonb_object_agg(pm.code, t), '{}'::jsonb) INTO v_by_method
    FROM (
      SELECT sp.payment_method_id AS mid, SUM(sp.amount) AS t
        FROM app.sale_payments sp
        JOIN app.sales sa ON sa.id = sp.sale_id
       WHERE sa.cash_session_id = p_session AND sa.status <> 'voided'
       GROUP BY sp.payment_method_id
    ) x
    JOIN app.payment_methods pm ON pm.id = x.mid;

  UPDATE app.cash_sessions SET
    expected_cash     = s.opening_amount + v_cash_sales + v_cash_collect
                        + v_in - v_out - v_cash_refunds,
    counted_cash      = p_counted,
    totals_by_method  = v_by_method,
    collections_total = v_cash_collect,
    cash_in_total     = v_in,
    cash_out_total    = v_out,
    refunds_total     = v_cash_refunds,
    sales_count       = (SELECT COUNT(*) FROM app.sales
                          WHERE cash_session_id = p_session AND status <> 'voided'),
    sales_total       = (SELECT COALESCE(SUM(total), 0) FROM app.sales
                          WHERE cash_session_id = p_session AND status <> 'voided'),
    credit_total      = (SELECT COALESCE(SUM(credit_total), 0) FROM app.sales
                          WHERE cash_session_id = p_session AND status <> 'voided'),
    status            = 'closed',
    closed_by         = p_user,
    closed_at         = now(),
    closing_note      = p_note,
    variance_reason   = p_variance_reason
  WHERE id = p_session
  RETURNING * INTO s;

  -- Todo cierre queda auditado; el descuadre se marca como crítico.
  INSERT INTO app.audit_logs
    (tenant_id, branch_id, user_id, action, entity_type, entity_id,
     severity, amount, reason, after_data)
  VALUES (s.tenant_id, s.branch_id, p_user, 'cash.close', 'cash_session', s.id,
          CASE WHEN ABS(s.difference) > 0 THEN 'critical' ELSE 'info' END,
          s.difference, p_variance_reason,
          jsonb_build_object('expected', s.expected_cash,
                             'counted',  s.counted_cash,
                             'difference', s.difference,
                             'by_method', s.totals_by_method));
  RETURN s;
END $fn$;

-- =====================================================================
-- 3 · RESERVA DE STOCK — respalda stock_balances.qty_reserved, que estaba
--     declarada sin mecanismo. La usa el checkout de la tienda online.
-- =====================================================================
CREATE OR REPLACE FUNCTION app.reserve_stock(
  p_tenant uuid, p_warehouse uuid, p_variant uuid, p_qty app.qty,
  p_lot uuid DEFAULT NULL, p_allow_oversell boolean DEFAULT false
) RETURNS app.qty
LANGUAGE plpgsql AS $fn$
DECLARE v_available app.qty;
BEGIN
  IF p_qty <= 0 THEN
    RAISE EXCEPTION 'La cantidad a reservar debe ser positiva';
  END IF;

  INSERT INTO app.stock_balances (tenant_id, warehouse_id, variant_id, lot_id, qty_on_hand)
  VALUES (p_tenant, p_warehouse, p_variant, p_lot, 0)
  ON CONFLICT (warehouse_id, variant_id, lot_key) DO NOTHING;

  SELECT qty_on_hand - qty_reserved INTO v_available
    FROM app.stock_balances
   WHERE warehouse_id = p_warehouse AND variant_id = p_variant
     AND lot_key = COALESCE(p_lot, '00000000-0000-0000-0000-000000000000'::uuid)
   FOR UPDATE;

  IF v_available < p_qty AND NOT p_allow_oversell THEN
    RAISE EXCEPTION 'Stock insuficiente para reservar: disponible %, solicitado %',
      v_available, p_qty USING ERRCODE = 'restrict_violation';
  END IF;

  UPDATE app.stock_balances
     SET qty_reserved = qty_reserved + p_qty, updated_at = now()
   WHERE warehouse_id = p_warehouse AND variant_id = p_variant
     AND lot_key = COALESCE(p_lot, '00000000-0000-0000-0000-000000000000'::uuid);

  RETURN v_available - p_qty;
END $fn$;

-- Libera la reserva. Se llama al despachar (el stock_event ya descuenta el
-- saldo real), al cancelar el pedido, o al expirar el carrito.
CREATE OR REPLACE FUNCTION app.release_stock(
  p_warehouse uuid, p_variant uuid, p_qty app.qty, p_lot uuid DEFAULT NULL
) RETURNS void
LANGUAGE sql AS $fn$
  UPDATE app.stock_balances
     SET qty_reserved = GREATEST(qty_reserved - p_qty, 0), updated_at = now()
   WHERE warehouse_id = p_warehouse AND variant_id = p_variant
     AND lot_key = COALESCE(p_lot, '00000000-0000-0000-0000-000000000000'::uuid);
$fn$;

-- =====================================================================
-- 4 · REPROYECCIÓN DE LEDGERS
--     docs/02-SYNC-OFFLINE §6 promete reconstruir los saldos desde cero
--     y comparar. Aquí está la implementación.
-- =====================================================================
CREATE OR REPLACE FUNCTION app.rebuild_stock_balances(p_tenant uuid)
RETURNS TABLE (variant_id uuid, warehouse_id uuid, stored app.qty, rebuilt app.qty, drift app.qty)
LANGUAGE plpgsql AS $fn$
BEGIN
  RETURN QUERY
  WITH truth AS (
    SELECT e.variant_id, e.warehouse_id,
           COALESCE(e.lot_id, '00000000-0000-0000-0000-000000000000'::uuid) AS lot_key,
           SUM(e.delta_qty) AS qty
      FROM app.stock_events e
     WHERE e.tenant_id = p_tenant
     GROUP BY 1, 2, 3
  ),
  cmp AS (
    SELECT COALESCE(t.variant_id, b.variant_id)     AS variant_id,
           COALESCE(t.warehouse_id, b.warehouse_id) AS warehouse_id,
           COALESCE(b.qty_on_hand, 0)               AS stored,
           COALESCE(t.qty, 0)                       AS rebuilt
      FROM truth t
      FULL OUTER JOIN app.stock_balances b
        ON b.tenant_id = p_tenant
       AND b.variant_id = t.variant_id
       AND b.warehouse_id = t.warehouse_id
       AND b.lot_key = t.lot_key
  )
  -- Los COALESCE devuelven numeric; el tipo de retorno es el dominio
  -- app.qty, así que hay que castear explícitamente.
  SELECT c.variant_id, c.warehouse_id,
         c.stored::app.qty, c.rebuilt::app.qty, (c.rebuilt - c.stored)::app.qty
    FROM cmp c
   WHERE c.stored IS DISTINCT FROM c.rebuilt;
END $fn$;

COMMENT ON FUNCTION app.rebuild_stock_balances IS
  'Compara el saldo materializado contra la suma del ledger. Debe devolver '
  'cero filas. Cualquier fila es un bug del trigger de proyección, no un '
  'descuadre operativo. Lo ejecuta el job semanal reproject-ledgers.';

-- Recalcula el costo promedio ponderado reproduciendo el ledger en orden.
CREATE OR REPLACE FUNCTION app.rebuild_variant_cost(p_variant uuid)
RETURNS app.unit_cost
LANGUAGE plpgsql AS $fn$
DECLARE
  r     record;
  v_qty app.qty      := 0;
  v_avg app.unit_cost := 0;
BEGIN
  FOR r IN
    SELECT delta_qty, unit_cost FROM app.stock_events
     WHERE variant_id = p_variant
     ORDER BY occurred_at, recorded_at, id
  LOOP
    IF r.delta_qty > 0 AND r.unit_cost IS NOT NULL THEN
      IF (GREATEST(v_qty, 0) + r.delta_qty) > 0 THEN
        v_avg := ((GREATEST(v_qty, 0) * v_avg) + (r.delta_qty * r.unit_cost))
                 / (GREATEST(v_qty, 0) + r.delta_qty);
      ELSE
        v_avg := r.unit_cost;
      END IF;
    END IF;
    v_qty := v_qty + r.delta_qty;
  END LOOP;

  UPDATE app.variant_costs
     SET avg_cost = v_avg, qty_on_hand = v_qty, updated_at = now()
   WHERE variant_costs.variant_id = p_variant;
  RETURN v_avg;
END $fn$;

-- =====================================================================
-- 5 · GENERACIÓN DE ALERTAS DE INVENTARIO
--     Respalda las automatizaciones declaradas en los manifiestos
--     (low_stock_alert, expiry_alert, feed_stock_alert).
-- =====================================================================
CREATE OR REPLACE FUNCTION app.refresh_inventory_alerts(p_tenant uuid)
RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE v_created int := 0; v_n int;
BEGIN
  -- Stock bajo / agotado
  INSERT INTO app.inventory_alerts (tenant_id, kind, severity, variant_id, warehouse_id, payload)
  SELECT p_tenant,
         CASE WHEN b.qty_on_hand <= 0 THEN 'out_of_stock' ELSE 'low_stock' END,
         CASE WHEN b.qty_on_hand <= 0 THEN 'critical' ELSE 'warning' END,
         b.variant_id, b.warehouse_id,
         jsonb_build_object('qty_on_hand', b.qty_on_hand,
                            'reorder_point', pr.reorder_point,
                            'suggested_qty', pr.reorder_qty)
    FROM app.stock_balances b
    JOIN app.product_variants v ON v.id = b.variant_id
    JOIN app.products pr        ON pr.id = v.product_id
   WHERE b.tenant_id = p_tenant
     AND pr.track_inventory AND pr.is_active
     AND pr.reorder_point IS NOT NULL
     AND b.qty_on_hand <= pr.reorder_point
     AND NOT EXISTS (
       SELECT 1 FROM app.inventory_alerts a
        WHERE a.tenant_id = p_tenant AND a.variant_id = b.variant_id
          AND a.warehouse_id = b.warehouse_id
          AND a.kind IN ('low_stock','out_of_stock')
          AND a.status IN ('open','snoozed'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_created := v_created + v_n;

  -- Próximos a vencer y vencidos
  INSERT INTO app.inventory_alerts (tenant_id, kind, severity, variant_id, lot_id, payload)
  SELECT p_tenant,
         CASE WHEN l.expiry_date < CURRENT_DATE THEN 'expired' ELSE 'near_expiry' END,
         CASE WHEN l.expiry_date < CURRENT_DATE THEN 'critical' ELSE 'warning' END,
         l.variant_id, l.id,
         jsonb_build_object('expiry_date', l.expiry_date,
                            'days_left', l.expiry_date - CURRENT_DATE,
                            'lot_code', l.lot_code)
    FROM app.inventory_lots l
   WHERE l.tenant_id = p_tenant
     AND l.expiry_date IS NOT NULL
     AND NOT l.is_blocked
     AND l.expiry_date <= CURRENT_DATE + 7
     AND EXISTS (SELECT 1 FROM app.stock_balances b
                  WHERE b.lot_id = l.id AND b.qty_on_hand > 0)
     AND NOT EXISTS (
       SELECT 1 FROM app.inventory_alerts a
        WHERE a.tenant_id = p_tenant AND a.lot_id = l.id
          AND a.kind IN ('near_expiry','expired')
          AND a.status IN ('open','snoozed'));
  GET DIAGNOSTICS v_n = ROW_COUNT; v_created := v_created + v_n;

  -- Agro: mortalidad diaria y desvío de conversión alimenticia
  INSERT INTO app.inventory_alerts (tenant_id, kind, severity, biological_lot_id, payload)
  SELECT p_tenant, 'high_mortality', 'critical', d.lot_id,
         jsonb_build_object('record_date', d.record_date,
                            'losses', d.qty_dead + d.qty_culled,
                            'daily_pct', ROUND(100 * (d.qty_dead + d.qty_culled)
                                               / NULLIF(l.current_qty, 0), 3))
    FROM app.biological_daily_records d
    JOIN app.biological_lots l ON l.id = d.lot_id
   WHERE d.tenant_id = p_tenant
     AND d.record_date >= CURRENT_DATE - 1
     AND l.status = 'active'
     AND (d.qty_dead + d.qty_culled) / NULLIF(l.current_qty, 0)
         > COALESCE((l.targets ->> 'max_daily_mortality_pct')::numeric, 0.5) / 100
     AND NOT EXISTS (
       SELECT 1 FROM app.inventory_alerts a
        WHERE a.tenant_id = p_tenant AND a.biological_lot_id = d.lot_id
          AND a.kind = 'high_mortality' AND a.status = 'open'
          AND a.created_at::date = CURRENT_DATE);
  GET DIAGNOSTICS v_n = ROW_COUNT; v_created := v_created + v_n;

  RETURN v_created;
END $fn$;

-- =====================================================================
-- 6 · RETENCIÓN DE HISTÓRICOS
-- ---------------------------------------------------------------------
-- `stock_events` NO se particiona a propósito: su PK de una sola columna
-- (UUID generado en el cliente) es lo que garantiza la idempotencia del
-- sync, y una tabla particionada no puede tener una clave única global
-- que no incluya la clave de partición. Correctitud antes que operación.
--
-- La escala se resuelve con dos herramientas más baratas:
--   · un índice BRIN sobre occurred_at, ideal en tablas append-only
--     (ocupa kilobytes donde un B-tree ocuparía gigabytes)
--   · archivado a un schema aparte pasado el período de retención legal
-- =====================================================================
CREATE INDEX IF NOT EXISTS stock_events_occurred_brin
  ON app.stock_events USING brin (occurred_at) WITH (pages_per_range = 64);
CREATE INDEX IF NOT EXISTS biological_events_occurred_brin
  ON app.biological_events USING brin (occurred_at) WITH (pages_per_range = 64);

CREATE SCHEMA IF NOT EXISTS archive;

CREATE TABLE IF NOT EXISTS archive.stock_events (LIKE app.stock_events INCLUDING ALL);

-- Mueve eventos anteriores al corte. Solo debe ejecutarse sobre períodos
-- ya cerrados contablemente y respetando la retención fiscal del país.
CREATE OR REPLACE FUNCTION app.archive_stock_events(p_before date)
RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE v_moved bigint;
BEGIN
  WITH moved AS (
    DELETE FROM app.stock_events e
     WHERE e.occurred_at < p_before
     RETURNING e.*
  )
  INSERT INTO archive.stock_events SELECT * FROM moved;
  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END $fn$;

-- =====================================================================
-- 7 · PURGA DE UN TENANT
-- ---------------------------------------------------------------------
-- Los ledgers son append-only por diseño, así que un `DELETE FROM
-- platform.tenants` en cascada FALLA: los triggers lo bloquean. Eso es
-- correcto — pero deja sin salida dos necesidades legítimas:
--   · el derecho al borrado de datos que reconocen varias legislaciones
--   · dar de baja de verdad a un cliente que se fue
--
-- Por eso la purga existe, pero es explícita, irreversible y auditada
-- fuera del tenant. No es un DELETE: es una operación con nombre propio
-- que exige confirmación literal.
-- =====================================================================
CREATE OR REPLACE FUNCTION platform.purge_tenant(
  p_tenant uuid,
  p_confirm text,
  p_reason text DEFAULT NULL
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE
  v_slug text;
  v_n    int;
BEGIN
  IF p_confirm IS DISTINCT FROM 'BORRAR DEFINITIVAMENTE' THEN
    RAISE EXCEPTION 'La purga exige la confirmación literal "BORRAR DEFINITIVAMENTE"'
      USING ERRCODE = 'restrict_violation',
            HINT = 'Esta operación es irreversible y elimina los ledgers inmutables.';
  END IF;

  SELECT slug INTO v_slug FROM platform.tenants WHERE id = p_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El tenant % no existe', p_tenant;
  END IF;

  -- Queda constancia ANTES de borrar, y en el schema de plataforma, que
  -- sobrevive a la purga.
  INSERT INTO platform.platform_audit (actor, tenant_id, action, payload)
  VALUES (COALESCE(current_setting('app.user_id', true), session_user),
          p_tenant, 'tenant.purge',
          jsonb_build_object('slug', v_slug, 'reason', p_reason, 'at', now()));

  -- Desactiva los triggers append-only SOLO dentro de esta transacción.
  PERFORM set_config('session_replication_role', 'replica', true);

  DELETE FROM platform.tenants WHERE id = p_tenant;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM set_config('session_replication_role', 'origin', true);
  RETURN v_n;
END $fn$;

REVOKE ALL ON FUNCTION platform.purge_tenant(uuid, text, text) FROM PUBLIC;

COMMENT ON FUNCTION platform.purge_tenant IS
  'Borrado irreversible de un tenant y todos sus datos, incluidos los '
  'ledgers append-only. Solo para baja definitiva o solicitud de borrado '
  'del titular. Queda registrado en platform.platform_audit.';

-- Desprende particiones de auditoría vencidas sin bloquear la tabla
CREATE OR REPLACE FUNCTION app.detach_audit_partitions(p_before date)
RETURNS TABLE (partition_name text)
LANGUAGE plpgsql AS $fn$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class p    ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace
     WHERE n.nspname = 'app' AND p.relname = 'audit_logs'
       AND c.relname ~ '^audit_logs_\d{4}_\d{2}$'
       AND to_date(right(c.relname, 7), 'YYYY_MM') < date_trunc('month', p_before)
  LOOP
    EXECUTE format('ALTER TABLE app.audit_logs DETACH PARTITION app.%I', r.relname);
    partition_name := r.relname;
    RETURN NEXT;
  END LOOP;
END $fn$;
