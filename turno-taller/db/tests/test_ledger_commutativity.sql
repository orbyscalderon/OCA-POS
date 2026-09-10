-- =====================================================================
-- OC POS · TEST · Ledger de inventario
-- ---------------------------------------------------------------------
-- Verifica la garantía sobre la que descansa TODO el modo offline: el
-- saldo converge al mismo valor sin importar en qué orden lleguen los
-- eventos de dos cajas que vendieron sin conexión.
-- =====================================================================

DO $test$
DECLARE
  S constant text := 'ledger';
  v_tenant  uuid;
  v_branch  uuid;
  v_wh      uuid;
  v_uom     uuid;
  v_product uuid;
  v_variant uuid;
  v_qty     app.qty;
  v_avg     app.unit_cost;
  v_before  app.qty;
  v_dup     uuid;
BEGIN
  -- ── Montaje ────────────────────────────────────────────────────────
  v_tenant := test.new_tenant('test-ledger');

  INSERT INTO app.branches (tenant_id, code, name)
  VALUES (v_tenant, 'M1', 'Principal') RETURNING id INTO v_branch;

  INSERT INTO app.warehouses (tenant_id, branch_id, code, name)
  VALUES (v_tenant, v_branch, 'ALM1', 'Almacén') RETURNING id INTO v_wh;

  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_tenant, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_uom;

  INSERT INTO app.products (tenant_id, name, base_uom_id)
  VALUES (v_tenant, 'Producto de prueba', v_uom) RETURNING id INTO v_product;

  INSERT INTO app.product_variants (tenant_id, product_id, sku, price, is_default)
  VALUES (v_tenant, v_product, 'TEST-001', 100, true) RETURNING id INTO v_variant;

  -- ── 1 · Costo promedio ponderado ───────────────────────────────────
  -- Entran 10 @ 5.00 y luego 10 @ 7.00  ->  CPP = 6.00
  INSERT INTO app.stock_events (id, tenant_id, warehouse_id, variant_id,
                                delta_qty, unit_cost, reason, occurred_at)
  VALUES (app.uuid_v7(), v_tenant, v_wh, v_variant, 10, 5.00, 'purchase', now() - interval '3 days'),
         (app.uuid_v7(), v_tenant, v_wh, v_variant, 10, 7.00, 'purchase', now() - interval '2 days');

  SELECT qty_on_hand, avg_cost INTO v_qty, v_avg
    FROM app.variant_costs WHERE variant_id = v_variant;

  PERFORM test.eq(S, 'CPP: cantidad tras dos compras', v_qty, 20);
  PERFORM test.eq(S, 'CPP: 10@5 + 10@7 = 6.00 por unidad', v_avg, 6.00);

  -- ── 2 · Conmutatividad ─────────────────────────────────────────────
  -- Quedan 20. La Caja A vendió 14 a las 10:00 y la Caja B 12 a las 10:01,
  -- ambas offline. La Caja B sincroniza PRIMERO: el orden de llegada está
  -- invertido respecto al orden real de los hechos.
  INSERT INTO app.stock_events (id, tenant_id, warehouse_id, variant_id,
                                delta_qty, reason, occurred_at, recorded_at)
  VALUES (app.uuid_v7(), v_tenant, v_wh, v_variant, -12, 'sale',
          now() - interval '1 hour' + interval '1 minute', now()),
         (app.uuid_v7(), v_tenant, v_wh, v_variant, -14, 'sale',
          now() - interval '1 hour', now() + interval '1 second');

  SELECT qty_on_hand INTO v_qty
    FROM app.stock_balances
   WHERE warehouse_id = v_wh AND variant_id = v_variant
     AND lot_key = '00000000-0000-0000-0000-000000000000'::uuid;

  PERFORM test.eq(S, 'Conmutatividad: 20 - 12 - 14 = -6, ninguna venta perdida', v_qty, -6);

  -- ── 3 · La sobreventa se registra, no se oculta ────────────────────
  PERFORM test.ok(S, 'Sobreventa registrada como conflicto accionable',
    EXISTS (SELECT 1 FROM app.sync_conflicts
             WHERE tenant_id = v_tenant AND kind = 'oversell' AND requires_action),
    'el trigger detect_oversell debía registrar el faltante');

  -- ── 4 · La proyección coincide con el ledger ───────────────────────
  PERFORM test.eq(S, 'Reproyección: saldo materializado == suma del ledger',
    (SELECT count(*) FROM app.rebuild_stock_balances(v_tenant)), 0);

  -- ── 5 · Inmutabilidad ──────────────────────────────────────────────
  PERFORM test.raises(S, 'stock_events rechaza UPDATE',
    format('UPDATE app.stock_events SET delta_qty = 999 WHERE tenant_id = %L', v_tenant),
    '23001');
  PERFORM test.raises(S, 'stock_events rechaza DELETE',
    format('DELETE FROM app.stock_events WHERE tenant_id = %L', v_tenant),
    '23001');

  -- ── 6 · Idempotencia del sync ──────────────────────────────────────
  -- Reenviar el mismo evento (misma PK) no puede descontar dos veces.
  v_dup := app.uuid_v7();
  SELECT qty_on_hand INTO v_before FROM app.stock_balances
   WHERE warehouse_id = v_wh AND variant_id = v_variant
     AND lot_key = '00000000-0000-0000-0000-000000000000'::uuid;

  INSERT INTO app.stock_events (id, tenant_id, warehouse_id, variant_id, delta_qty, reason)
  VALUES (v_dup, v_tenant, v_wh, v_variant, -1, 'sale');

  INSERT INTO app.stock_events (id, tenant_id, warehouse_id, variant_id, delta_qty, reason)
  VALUES (v_dup, v_tenant, v_wh, v_variant, -1, 'sale')
  ON CONFLICT (id) DO NOTHING;

  SELECT qty_on_hand INTO v_qty FROM app.stock_balances
   WHERE warehouse_id = v_wh AND variant_id = v_variant
     AND lot_key = '00000000-0000-0000-0000-000000000000'::uuid;

  PERFORM test.eq(S, 'Idempotencia: el reenvío del mismo evento no duplica', v_qty, v_before - 1);

  -- ── 7 · El CPP se puede reconstruir desde el ledger ────────────────
  PERFORM test.eq(S, 'CPP reconstruido desde el ledger coincide',
    app.rebuild_variant_cost(v_variant), 6.00);
END $test$;

-- =====================================================================
-- Cadena de auditoría
-- =====================================================================
DO $audit$
DECLARE
  S constant text := 'auditoría';
  v_tenant uuid;
  v_seq    bigint;
BEGIN
  v_tenant := test.new_tenant('test-audit');

  INSERT INTO app.audit_logs (tenant_id, action, entity_type, severity, reason, amount)
  VALUES (v_tenant, 'sale.void',       'sale',  'critical', 'prueba 1', 1500),
         (v_tenant, 'inventory.adjust','stock', 'critical', 'prueba 2', NULL),
         (v_tenant, 'cash.close',      'cash',  'info',     'prueba 3', -230);

  PERFORM test.eq(S, 'Se registraron 3 eventos',
    (SELECT count(*) FROM app.audit_logs WHERE tenant_id = v_tenant), 3);

  PERFORM test.ok(S, 'Cada evento encadena el hash del anterior',
    (SELECT count(*) FROM app.audit_logs
      WHERE tenant_id = v_tenant AND row_hash IS NOT NULL) = 3
    AND (SELECT count(*) FROM app.audit_logs
          WHERE tenant_id = v_tenant AND prev_hash IS NOT NULL) = 2,
    'el primero es génesis (prev_hash NULL), los otros dos encadenan');

  SELECT broken_seq INTO v_seq FROM app.verify_audit_chain(v_tenant);
  PERFORM test.ok(S, 'La cadena verifica íntegra', v_seq IS NULL,
    format('rotura detectada en seq %s', v_seq));

  PERFORM test.raises(S, 'audit_logs rechaza UPDATE',
    format('UPDATE app.audit_logs SET reason = ''manipulado'' WHERE tenant_id = %L', v_tenant),
    '23001');
  PERFORM test.raises(S, 'audit_logs rechaza DELETE',
    format('DELETE FROM app.audit_logs WHERE tenant_id = %L', v_tenant),
    '23001');

  PERFORM test.ok(S, 'audit_logs está particionada por mes',
    (SELECT count(*) FROM pg_inherits i
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace n ON n.oid = p.relnamespace
      WHERE n.nspname = 'app' AND p.relname = 'audit_logs') >= 4,
    'deben existir la partición por defecto y al menos 3 mensuales');
END $audit$;
