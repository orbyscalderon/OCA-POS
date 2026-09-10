-- =====================================================================
-- OC POS · TEST · Lógica de negocio
-- Unidades de medida · Folios fiscales · Caja · Crédito · Reservas ·
-- Merge LWW · Agro (mortalidad, FCR, costeo) · Citas · Mensajería
-- =====================================================================

-- ---------------------------------------------------------------------
-- Unidades de medida multidimensionales
-- ---------------------------------------------------------------------
DO $uom$
DECLARE
  S constant text := 'uom';
  v_t uuid; v_kg uuid; v_lb uuid; v_ton uuid; v_saco uuid; v_und uuid; v_p uuid;
BEGIN
  v_t := test.new_tenant('test-uom');

  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_t, 'KG', 'Kilogramo', 'weight', 1, true) RETURNING id INTO v_kg;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base)
  VALUES (v_t, 'LB', 'Libra', 'weight', 0.45359237) RETURNING id INTO v_lb;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base)
  VALUES (v_t, 'TON', 'Tonelada', 'weight', 1000) RETURNING id INTO v_ton;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base)
  VALUES (v_t, 'SACO', 'Saco', 'weight', 45.36) RETURNING id INTO v_saco;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_t, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_und;

  INSERT INTO app.products (tenant_id, name, base_uom_id)
  VALUES (v_t, 'Alimento balanceado', v_kg) RETURNING id INTO v_p;

  -- Conversión canónica dentro de la misma dimensión
  PERFORM test.eq(S, '1 tonelada = 1000 kg', app.uom_factor(v_p, v_ton, v_kg), 1000);
  PERFORM test.eq(S, '1 kg = 2.20462 libras', app.uom_factor(v_p, v_kg, v_lb), 2.2046226, 0.0001);
  PERFORM test.eq(S, '1 saco = 45.36 kg', app.uom_factor(v_p, v_saco, v_kg), 45.36);
  PERFORM test.eq(S, 'Conversión a sí misma es 1', app.uom_factor(v_p, v_kg, v_kg), 1);

  -- Conversión específica del producto: gana sobre el factor canónico.
  -- Este saco de ESTA marca pesa 40 kg, no los 45.36 genéricos.
  INSERT INTO app.uom_conversions (tenant_id, product_id, from_uom_id, to_uom_id, factor)
  VALUES (v_t, v_p, v_saco, v_kg, 40);
  PERFORM test.eq(S, 'La regla del producto gana al factor genérico',
    app.uom_factor(v_p, v_saco, v_kg), 40);
  PERFORM test.eq(S, 'La regla inversa se deduce automáticamente',
    app.uom_factor(v_p, v_kg, v_saco), 0.025, 0.000001);

  -- Cruzar dimensiones sin regla explícita debe fallar, no inventar
  PERFORM test.raises(S, 'Convertir peso a unidad sin regla falla',
    format('SELECT app.uom_factor(%L, %L, %L)', v_p, v_kg, v_und), '22000');
END $uom$;

-- ---------------------------------------------------------------------
-- Folios fiscales en bloques por dispositivo
-- ---------------------------------------------------------------------
DO $fiscal$
DECLARE
  S constant text := 'fiscal';
  v_t uuid; v_b uuid; v_dt uuid; v_seq uuid;
  v_d1 uuid; v_d2 uuid;
  b1 app.fiscal_sequence_blocks; b2 app.fiscal_sequence_blocks;
BEGIN
  v_t := test.new_tenant('test-fiscal');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'M1', 'Principal')
  RETURNING id INTO v_b;
  INSERT INTO app.devices (tenant_id, branch_id, device_no, name)
  VALUES (v_t, v_b, 1, 'Caja 1') RETURNING id INTO v_d1;
  INSERT INTO app.devices (tenant_id, branch_id, device_no, name)
  VALUES (v_t, v_b, 2, 'Caja 2') RETURNING id INTO v_d2;

  INSERT INTO app.fiscal_document_types (tenant_id, code, name, document_class)
  VALUES (v_t, 'B02', 'Consumidor Final', 'invoice') RETURNING id INTO v_dt;

  INSERT INTO app.fiscal_sequences
    (tenant_id, branch_id, document_type_id, prefix, range_from, range_to, next_number)
  VALUES (v_t, v_b, v_dt, 'B02', 1, 1000, 1) RETURNING id INTO v_seq;

  b1 := app.allocate_fiscal_block(v_seq, v_d1, 200);
  b2 := app.allocate_fiscal_block(v_seq, v_d2, 200);

  PERFORM test.eq(S, 'Caja 1 recibe el rango 1-200', b1.block_from, 1);
  PERFORM test.eq(S, 'Caja 1 termina en 200', b1.block_to, 200);
  PERFORM test.eq(S, 'Caja 2 arranca donde terminó la 1', b2.block_from, 201);
  PERFORM test.ok(S, 'Los bloques de dos cajas nunca se solapan',
    b1.block_to < b2.block_from,
    'dos dispositivos offline emitirían el mismo folio');

  -- La restricción EXCLUDE lo impide a nivel de base de datos, no de app
  PERFORM test.raises(S, 'La BD rechaza un bloque solapado',
    format($q$INSERT INTO app.fiscal_sequence_blocks
              (tenant_id, sequence_id, device_id, block_from, block_to, next_number)
              VALUES (%L, %L, %L, 150, 250, 150)$q$, v_t, v_seq, v_d1),
    '23P01');

  -- Agotar el talonario debe fallar de forma explícita
  PERFORM app.allocate_fiscal_block(v_seq, v_d1, 600);
  PERFORM test.raises(S, 'Talonario agotado falla con mensaje claro',
    format('SELECT app.allocate_fiscal_block(%L, %L, 100)', v_seq, v_d1));
END $fiscal$;

-- ---------------------------------------------------------------------
-- Cierre de caja: expected_cash y descuadre
-- ---------------------------------------------------------------------
DO $cash$
DECLARE
  S constant text := 'caja';
  v_t uuid; v_b uuid; v_wh uuid; v_u uuid; v_role uuid; v_reg uuid; v_sess uuid;
  v_cash uuid; v_card uuid; v_sale uuid;
  v_row app.cash_sessions;
BEGIN
  v_t := test.new_tenant('test-cash');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'M1', 'Principal')
  RETURNING id INTO v_b;
  INSERT INTO app.warehouses (tenant_id, branch_id, code, name)
  VALUES (v_t, v_b, 'A1', 'Almacén') RETURNING id INTO v_wh;
  INSERT INTO app.roles (tenant_id, code, name) VALUES (v_t, 'admin', 'Admin')
  RETURNING id INTO v_role;
  INSERT INTO app.users (tenant_id, role_id, display_name)
  VALUES (v_t, v_role, 'Cajero') RETURNING id INTO v_u;
  INSERT INTO app.cash_registers (tenant_id, branch_id, code, name)
  VALUES (v_t, v_b, 'C1', 'Caja 1') RETURNING id INTO v_reg;

  INSERT INTO app.payment_methods (tenant_id, code, name, kind)
  VALUES (v_t, 'CASH', 'Efectivo', 'cash') RETURNING id INTO v_cash;
  INSERT INTO app.payment_methods (tenant_id, code, name, kind, affects_cash_drawer)
  VALUES (v_t, 'CARD', 'Tarjeta', 'card', false) RETURNING id INTO v_card;

  INSERT INTO app.cash_sessions (id, tenant_id, branch_id, register_id, opened_by, opening_amount)
  VALUES (app.uuid_v7(), v_t, v_b, v_reg, v_u, 1000) RETURNING id INTO v_sess;

  -- Venta de 500: 300 en efectivo (con 20 de vuelto) + 200 con tarjeta
  INSERT INTO app.sales (id, tenant_id, branch_id, warehouse_id, cash_session_id,
                         user_id, local_number, currency_code, total, occurred_at)
  VALUES (app.uuid_v7(), v_t, v_b, v_wh, v_sess, v_u, 'M1-01-000001', 'DOP', 500, now())
  RETURNING id INTO v_sale;

  INSERT INTO app.sale_payments (id, tenant_id, sale_id, payment_method_id, amount, tendered, change)
  VALUES (app.uuid_v7(), v_t, v_sale, v_cash, 320, 340, 20),
         (app.uuid_v7(), v_t, v_sale, v_card, 200, NULL, 0);

  -- Un retiro de 100 y un gasto pagado de caja por 50
  INSERT INTO app.cash_movements (id, tenant_id, session_id, direction, kind, amount, reason, user_id)
  VALUES (app.uuid_v7(), v_t, v_sess, 'out', 'withdrawal', 100, 'Retiro a bóveda', v_u),
         (app.uuid_v7(), v_t, v_sess, 'out', 'expense', 50, 'Agua de la oficina', v_u);

  -- Esperado = 1000 (fondo) + 300 (efectivo neto de vuelto) - 150 (salidas) = 1150
  v_row := app.close_cash_session(v_sess, 1140, v_u, 'Cierre de prueba', 'Faltó un billete de 10');

  PERFORM test.eq(S, 'expected_cash = fondo + efectivo neto - salidas', v_row.expected_cash, 1150);
  PERFORM test.eq(S, 'El descuadre se calcula solo', v_row.difference, -10);
  PERFORM test.eq(S, 'sales_total incluye toda la venta', v_row.sales_total, 500);
  PERFORM test.eq(S, 'cash_out_total suma retiro y gasto', v_row.cash_out_total, 150);
  PERFORM test.eq_text(S, 'La sesión queda cerrada', v_row.status, 'closed');
  PERFORM test.eq(S, 'totals_by_method desglosa efectivo',
    (v_row.totals_by_method ->> 'CASH')::numeric, 320);
  PERFORM test.eq(S, 'totals_by_method desglosa tarjeta',
    (v_row.totals_by_method ->> 'CARD')::numeric, 200);

  -- El descuadre queda auditado como crítico: es la señal antirrobo
  PERFORM test.ok(S, 'El descuadre genera auditoría crítica',
    EXISTS (SELECT 1 FROM app.audit_logs
             WHERE tenant_id = v_t AND action = 'cash.close' AND severity = 'critical'),
    'un cierre descuadrado debe quedar registrado como crítico');

  -- No se puede cerrar dos veces
  PERFORM test.raises(S, 'Una caja cerrada no se cierra de nuevo',
    format('SELECT app.close_cash_session(%L, 1140, %L)', v_sess, v_u), '23001');
END $cash$;

-- ---------------------------------------------------------------------
-- Crédito: fiado, abonos, mora
-- ---------------------------------------------------------------------
DO $credit$
DECLARE
  S constant text := 'crédito';
  v_t uuid; v_b uuid; v_cust uuid; v_acc uuid;
  v_balance app.money; v_due app.money; v_overdue app.money; v_days int;
BEGIN
  v_t := test.new_tenant('test-credit');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'M1', 'Principal')
  RETURNING id INTO v_b;

  INSERT INTO app.customers (id, tenant_id, full_name, credit_enabled, credit_limit)
  VALUES (app.uuid_v7(), v_t, 'Cliente Fiado', true, 5000) RETURNING id INTO v_cust;

  INSERT INTO app.credit_accounts (id, tenant_id, branch_id, customer_id, code,
                                   kind, currency_code, due_date)
  VALUES (app.uuid_v7(), v_t, v_b, v_cust, 'CXC-001', 'open_account', 'DOP',
          CURRENT_DATE - 10)
  RETURNING id INTO v_acc;

  -- Se fía 3000, luego se abona 1000, luego se fía 500 más
  INSERT INTO app.credit_movements (id, tenant_id, account_id, customer_id, movement_type, amount)
  VALUES (app.uuid_v7(), v_t, v_acc, v_cust, 'charge', 3000);
  INSERT INTO app.credit_movements (id, tenant_id, account_id, customer_id, movement_type, amount)
  VALUES (app.uuid_v7(), v_t, v_acc, v_cust, 'payment', -1000);
  INSERT INTO app.credit_movements (id, tenant_id, account_id, customer_id, movement_type, amount)
  VALUES (app.uuid_v7(), v_t, v_acc, v_cust, 'charge', 500);
  -- Interés por mora
  INSERT INTO app.credit_movements (id, tenant_id, account_id, customer_id, movement_type, amount)
  VALUES (app.uuid_v7(), v_t, v_acc, v_cust, 'late_fee', 75);

  SELECT balance INTO v_balance FROM app.credit_accounts WHERE id = v_acc;
  PERFORM test.eq(S, 'Saldo = 3000 - 1000 + 500 + 75 mora', v_balance, 2575);

  SELECT balance_due INTO v_due FROM app.customers WHERE id = v_cust;
  PERFORM test.eq(S, 'El saldo del cliente se proyecta desde el ledger', v_due, 2575);

  -- refresh_credit_status marca la mora y llena overdue_amount, que antes
  -- estaba declarada y nadie mantenía
  PERFORM app.refresh_credit_status(v_t);

  SELECT days_overdue INTO v_days FROM app.credit_accounts WHERE id = v_acc;
  SELECT overdue_amount INTO v_overdue FROM app.customers WHERE id = v_cust;

  PERFORM test.eq(S, 'days_overdue = 10 días desde el vencimiento', v_days, 10);
  PERFORM test.eq_text(S, 'La cuenta queda marcada en mora',
    (SELECT status FROM app.credit_accounts WHERE id = v_acc), 'overdue');
  PERFORM test.eq(S, 'overdue_amount del cliente se calcula', v_overdue, 2575);

  -- El ledger de crédito también es inmutable
  PERFORM test.raises(S, 'credit_movements rechaza UPDATE',
    format('UPDATE app.credit_movements SET amount = 1 WHERE tenant_id = %L', v_t), '23001');

  -- Vista de antigüedad
  PERFORM test.eq_text(S, 'El aging clasifica en el tramo 1-30 días',
    (SELECT aging_bucket FROM app.v_receivables_aging WHERE account_id = v_acc), '1_30');
END $credit$;

-- ---------------------------------------------------------------------
-- Reserva de stock para pedidos online
-- ---------------------------------------------------------------------
DO $reserve$
DECLARE
  S constant text := 'reservas';
  v_t uuid; v_b uuid; v_wh uuid; v_uom uuid; v_p uuid; v_v uuid;
  v_left app.qty; v_res app.qty;
BEGIN
  v_t := test.new_tenant('test-reserve');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'M1', 'P') RETURNING id INTO v_b;
  INSERT INTO app.warehouses (tenant_id, branch_id, code, name) VALUES (v_t, v_b, 'A1', 'A')
  RETURNING id INTO v_wh;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_t, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_uom;
  INSERT INTO app.products (tenant_id, name, base_uom_id) VALUES (v_t, 'Prod', v_uom)
  RETURNING id INTO v_p;
  INSERT INTO app.product_variants (tenant_id, product_id, sku, price)
  VALUES (v_t, v_p, 'R-1', 50) RETURNING id INTO v_v;

  INSERT INTO app.stock_events (id, tenant_id, warehouse_id, variant_id, delta_qty, unit_cost, reason)
  VALUES (app.uuid_v7(), v_t, v_wh, v_v, 10, 20, 'purchase');

  v_left := app.reserve_stock(v_t, v_wh, v_v, 4);
  PERFORM test.eq(S, 'Reservar 4 de 10 deja 6 disponibles', v_left, 6);

  SELECT qty_reserved INTO v_res FROM app.stock_balances
   WHERE warehouse_id = v_wh AND variant_id = v_v
     AND lot_key = '00000000-0000-0000-0000-000000000000'::uuid;
  PERFORM test.eq(S, 'qty_reserved refleja la reserva', v_res, 4);

  PERFORM test.raises(S, 'No se puede reservar más de lo disponible',
    format('SELECT app.reserve_stock(%L, %L, %L, 20)', v_t, v_wh, v_v), '23001');

  PERFORM app.release_stock(v_wh, v_v, 4);
  SELECT qty_reserved INTO v_res FROM app.stock_balances
   WHERE warehouse_id = v_wh AND variant_id = v_v
     AND lot_key = '00000000-0000-0000-0000-000000000000'::uuid;
  PERFORM test.eq(S, 'Liberar la reserva la devuelve a cero', v_res, 0);
END $reserve$;

-- ---------------------------------------------------------------------
-- Merge por campo (LWW) para entidades de estado mutable
-- ---------------------------------------------------------------------
DO $lww$
DECLARE
  S constant text := 'lww';
  r jsonb;
BEGIN
  -- Caja A cambió el nombre (reloj 10), Caja B el stock mínimo (reloj 12).
  -- Ambos cambios deben sobrevivir: es el caso que un LWW por fila rompe.
  r := app.lww_merge(
        '{"name":"Original","reorder_point":5}'::jsonb,
        '{"name":{"v":1,"d":1},"reorder_point":{"v":1,"d":1}}'::jsonb,
        '{"name":"Nuevo nombre","reorder_point":9}'::jsonb,
        '{"name":{"v":10,"d":2},"reorder_point":{"v":12,"d":3}}'::jsonb);

  PERFORM test.eq_text(S, 'El nombre más reciente gana',
    r -> 'data' ->> 'name', 'Nuevo nombre');
  PERFORM test.eq(S, 'El stock mínimo más reciente gana',
    (r -> 'data' ->> 'reorder_point')::numeric, 9);

  -- Reloj más viejo: no pisa
  r := app.lww_merge(
        '{"name":"Actual"}'::jsonb, '{"name":{"v":20,"d":1}}'::jsonb,
        '{"name":"Viejo"}'::jsonb,  '{"name":{"v":5,"d":9}}'::jsonb);
  PERFORM test.eq_text(S, 'Un reloj más viejo no sobrescribe',
    r -> 'data' ->> 'name', 'Actual');

  -- Empate de reloj: desempata el device_no, de forma determinista
  r := app.lww_merge(
        '{"name":"A"}'::jsonb, '{"name":{"v":7,"d":1}}'::jsonb,
        '{"name":"B"}'::jsonb, '{"name":{"v":7,"d":2}}'::jsonb);
  PERFORM test.eq_text(S, 'El empate se resuelve por device_no mayor',
    r -> 'data' ->> 'name', 'B');

  -- Campo protegido: el servidor gana aunque el cliente traiga reloj mayor
  r := app.lww_merge(
        '{"price":100}'::jsonb, '{"price":{"v":1,"d":1}}'::jsonb,
        '{"price":1}'::jsonb,   '{"price":{"v":999,"d":9}}'::jsonb);
  PERFORM test.eq(S, 'El precio es campo protegido: gana el servidor',
    (r -> 'data' ->> 'price')::numeric, 100);
  PERFORM test.ok(S, 'El conflicto de precio queda registrado',
    jsonb_array_length(r -> 'conflicts') = 1
    AND (r -> 'conflicts' -> 0 ->> 'winner') = 'server',
    'debía anotarse el valor descartado');
END $lww$;

-- ---------------------------------------------------------------------
-- AGRO ENGINE: mortalidad, costeo por animal vivo, FCR y faena
-- ---------------------------------------------------------------------
DO $agro$
DECLARE
  S constant text := 'agro';
  v_t uuid; v_b uuid; v_wh uuid; v_kg uuid; v_und uuid;
  v_feed_p uuid; v_feed uuid; v_meat_p uuid; v_meat uuid;
  v_unit uuid; v_lot uuid; v_harvest uuid;
  k record;
BEGIN
  v_t := test.new_tenant('test-agro');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'F1', 'Finca')
  RETURNING id INTO v_b;
  INSERT INTO app.warehouses (tenant_id, branch_id, code, name, kind)
  VALUES (v_t, v_b, 'A1', 'Bodega', 'stock') RETURNING id INTO v_wh;

  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_t, 'KG', 'Kilogramo', 'weight', 1, true) RETURNING id INTO v_kg;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_t, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_und;

  INSERT INTO app.products (tenant_id, name, base_uom_id, kind)
  VALUES (v_t, 'Alimento engorde', v_kg, 'raw_material') RETURNING id INTO v_feed_p;
  INSERT INTO app.product_variants (tenant_id, product_id, sku, price)
  VALUES (v_t, v_feed_p, 'FEED-1', 0) RETURNING id INTO v_feed;

  INSERT INTO app.products (tenant_id, name, base_uom_id, is_weighted)
  VALUES (v_t, 'Pollo entero', v_kg, true) RETURNING id INTO v_meat_p;
  INSERT INTO app.product_variants (tenant_id, product_id, sku, price)
  VALUES (v_t, v_meat_p, 'POLLO-ENT', 180) RETURNING id INTO v_meat;

  INSERT INTO app.farm_units (tenant_id, branch_id, warehouse_id, code, name, kind, capacity)
  VALUES (v_t, v_b, v_wh, 'GALPON-3', 'Galpón 3', 'shed', 1200) RETURNING id INTO v_unit;

  -- Lote de 1000 pollitos a 25.00 cada uno
  INSERT INTO app.biological_lots
    (tenant_id, branch_id, farm_unit_id, code, name, species, production_kind,
     breed, initial_qty, uom_id, entry_date, initial_unit_cost, targets, attributes)
  VALUES (v_t, v_b, v_unit, 'POLLO-G3-2026-08', 'Lote Pollos Galpón 3',
          'broiler', 'meat', 'cobb_500', 1000, v_und, CURRENT_DATE - 42, 25.00,
          '{"target_fcr":1.65,"max_mortality_pct":5}'::jsonb,
          '{"galpon":"GALPON-3","linea_genetica":"cobb_500"}'::jsonb)
  RETURNING id INTO v_lot;

  -- Ingreso de la población + su costo
  INSERT INTO app.biological_events (id, tenant_id, lot_id, event_type, delta_qty)
  VALUES (app.uuid_v7(), v_t, v_lot, 'entry', 1000);
  INSERT INTO app.biological_costs (id, tenant_id, lot_id, cost_type, qty, unit_cost, amount)
  VALUES (app.uuid_v7(), v_t, v_lot, 'livestock', 1000, 25.00, 25000);

  PERFORM test.eq(S, 'La población se proyecta desde el ledger',
    (SELECT current_qty FROM app.biological_lots WHERE id = v_lot), 1000);

  -- 42 días: mueren 35 y se descartan 15  ->  5% de bajas
  INSERT INTO app.biological_events (id, tenant_id, lot_id, event_type, delta_qty, cause)
  VALUES (app.uuid_v7(), v_t, v_lot, 'mortality', -35, 'ascitis'),
         (app.uuid_v7(), v_t, v_lot, 'cull',      -15, 'descarte_sanitario');

  PERFORM test.eq(S, 'Quedan vivas 950 aves',
    (SELECT current_qty FROM app.biological_lots WHERE id = v_lot), 950);

  -- Consumo: 3800 kg de alimento a 22/kg, medicina y mano de obra
  INSERT INTO app.biological_costs (id, tenant_id, lot_id, cost_type, qty, unit_cost, amount)
  VALUES (app.uuid_v7(), v_t, v_lot, 'feed',     3800, 22.00, 83600),
         (app.uuid_v7(), v_t, v_lot, 'medicine',  NULL, NULL,  4200),
         (app.uuid_v7(), v_t, v_lot, 'labor',     NULL, NULL, 12000),
         (app.uuid_v7(), v_t, v_lot, 'utilities', NULL, NULL,  3200);

  SELECT * INTO k FROM app.v_biological_lot_costing WHERE lot_id = v_lot;

  PERFORM test.eq(S, 'Mortalidad acumulada = 5%', k.mortality_pct, 5.000, 0.001);
  PERFORM test.eq(S, 'Costo total del lote = 128.000', k.total_cost, 128000);
  -- 128000 / 950 vivas = 134.7368  ->  cada muerte encarece a las vivas
  PERFORM test.eq(S, 'Costo por ave viva sube con la mortalidad',
    k.cost_per_live_unit, 134.736842, 0.0001);
  PERFORM test.eq(S, 'La edad del lote se calcula sobre la marcha', k.cycle_days, 42);

  -- Faena: entran 950 aves (2375 kg vivos) -> 1750 kg de carne + 150 de menudencia
  INSERT INTO app.biological_events (id, tenant_id, lot_id, event_type, delta_qty)
  VALUES (app.uuid_v7(), v_t, v_lot, 'harvest', -950);

  INSERT INTO app.harvests (tenant_id, lot_id, code, harvest_kind, harvest_date,
                            qty_input, input_weight_kg, output_weight_kg, yield_pct,
                            warehouse_id, allocated_cost, status)
  VALUES (v_t, v_lot, 'FAENA-001', 'slaughter', CURRENT_DATE, 950, 2375, 1900, 80.0,
          v_wh, 128000, 'posted')
  RETURNING id INTO v_harvest;

  -- Reparto por peso: 1750/1900 y 150/1900 del costo total
  INSERT INTO app.harvest_outputs
    (tenant_id, harvest_id, variant_id, qty, uom_id, qty_in_base,
     allocation_weight, unit_cost, allocated_cost, is_byproduct)
  VALUES (v_t, v_harvest, v_meat, 1750, v_kg, 1750, 1750,
          round(128000 * (1750.0/1900.0) / 1750, 6), 128000 * (1750.0/1900.0), false),
         (v_t, v_harvest, v_meat,  150, v_kg,  150,  150,
          round(128000 * (150.0/1900.0) / 150, 6),  128000 * (150.0/1900.0),  true);

  SELECT * INTO k FROM app.v_biological_lot_costing WHERE lot_id = v_lot;

  -- FCR = 3800 kg de alimento / 1900 kg producidos = 2.0
  PERFORM test.eq(S, 'Conversión alimenticia (FCR) = 2.0', k.fcr, 2.0, 0.001);
  -- 128000 / 1900 kg = 67.368421 por kg
  PERFORM test.eq(S, 'Costo real por kg producido', k.cost_per_output_kg, 67.368421, 0.0001);
  PERFORM test.eq(S, 'La población queda en cero tras la faena', k.current_qty, 0);

  -- Los ledgers agro también son inmutables
  PERFORM test.raises(S, 'biological_events rechaza UPDATE',
    format('UPDATE app.biological_events SET delta_qty = 1 WHERE tenant_id = %L', v_t), '23001');
  PERFORM test.raises(S, 'biological_costs rechaza DELETE',
    format('DELETE FROM app.biological_costs WHERE tenant_id = %L', v_t), '23001');
END $agro$;

-- ---------------------------------------------------------------------
-- Citas: la base impide la doble reserva
-- ---------------------------------------------------------------------
DO $appt$
DECLARE
  S constant text := 'citas';
  v_t uuid; v_b uuid; v_emp uuid; v_c uuid;
BEGIN
  v_t := test.new_tenant('test-appt');
  INSERT INTO app.branches (tenant_id, code, name) VALUES (v_t, 'S1', 'Salón')
  RETURNING id INTO v_b;
  INSERT INTO app.employees (tenant_id, branch_id, full_name, is_bookable)
  VALUES (v_t, v_b, 'Barbero 1', true) RETURNING id INTO v_emp;
  INSERT INTO app.customers (id, tenant_id, full_name)
  VALUES (app.uuid_v7(), v_t, 'Cliente') RETURNING id INTO v_c;

  INSERT INTO app.appointments (id, tenant_id, branch_id, customer_id, employee_id,
                                code, starts_at, ends_at)
  VALUES (app.uuid_v7(), v_t, v_b, v_c, v_emp, 'CITA-1',
          '2026-09-01 10:00+00', '2026-09-01 10:30+00');

  PERFORM test.raises(S, 'Dos citas solapadas del mismo barbero se rechazan',
    format($q$INSERT INTO app.appointments
              (id, tenant_id, branch_id, customer_id, employee_id, code, starts_at, ends_at)
              VALUES (app.uuid_v7(), %L, %L, %L, %L, 'CITA-2',
                      '2026-09-01 10:15+00', '2026-09-01 10:45+00')$q$,
           v_t, v_b, v_c, v_emp),
    '23P01');

  -- Contigua, sin solape: sí se permite
  INSERT INTO app.appointments (id, tenant_id, branch_id, customer_id, employee_id,
                                code, starts_at, ends_at)
  VALUES (app.uuid_v7(), v_t, v_b, v_c, v_emp, 'CITA-3',
          '2026-09-01 10:30+00', '2026-09-01 11:00+00');

  PERFORM test.eq(S, 'Una cita contigua sí se agenda',
    (SELECT count(*) FROM app.appointments WHERE tenant_id = v_t), 2);
END $appt$;

-- ---------------------------------------------------------------------
-- Mensajería: no se encola con plantilla sin aprobar
-- ---------------------------------------------------------------------
DO $msg$
DECLARE
  S constant text := 'mensajería';
  v_t uuid; v_acc uuid; v_tpl uuid;
BEGIN
  v_t := test.new_tenant('test-msg');
  INSERT INTO app.messaging_accounts (tenant_id, provider, display_name, phone_e164, status)
  VALUES (v_t, 'meta_cloud', 'Mi Negocio', '+18095551234', 'connected')
  RETURNING id INTO v_acc;

  INSERT INTO app.message_templates
    (tenant_id, account_id, code, name, purpose, body_text, approval_status)
  VALUES (v_t, v_acc, 'cobro', 'Cobro', 'collection', 'Hola {{1}}', 'submitted')
  RETURNING id INTO v_tpl;

  PERFORM test.raises(S, 'Plantilla no aprobada: el envío se bloquea',
    format($q$INSERT INTO app.messages_outbox
              (tenant_id, channel, purpose, to_address, template_id)
              VALUES (%L, 'whatsapp', 'collection', '+18095550000', %L)$q$, v_t, v_tpl),
    '23001');

  UPDATE app.message_templates SET approval_status = 'approved' WHERE id = v_tpl;

  INSERT INTO app.messages_outbox (tenant_id, channel, purpose, to_address, template_id)
  VALUES (v_t, 'whatsapp', 'collection', '+18095550000', v_tpl);

  PERFORM test.eq(S, 'Aprobada la plantilla, el envío se encola',
    (SELECT count(*) FROM app.messages_outbox WHERE tenant_id = v_t), 1);
END $msg$;

-- ---------------------------------------------------------------------
-- Engine de nicho: los manifiestos quedaron cargados y son consultables
-- ---------------------------------------------------------------------
DO $profiles$
DECLARE S constant text := 'perfiles';
BEGIN
  PERFORM test.eq(S, 'Los 12 perfiles están sembrados',
    (SELECT count(*) FROM platform.business_profiles), 12);

  PERFORM test.eq(S, 'Cada perfil tiene manifiesto publicado',
    (SELECT count(*) FROM platform.business_profiles bp
      WHERE NOT EXISTS (SELECT 1 FROM platform.business_profile_versions v
                         WHERE v.profile_id = bp.id AND v.status = 'published')), 0);

  -- El manifiesto es consultable con los operadores JSONB: así es como el
  -- backend resuelve la configuración efectiva sin deserializar todo.
  PERFORM test.eq_text(S, 'El manifiesto de la granja declara el modo agro',
    (SELECT v.manifest -> 'profile' ->> 'primary_mode'
       FROM platform.business_profile_versions v
       JOIN platform.business_profiles p ON p.id = v.profile_id
      WHERE p.slug = 'granja_avicola'), 'biological_lots');

  PERFORM test.ok(S, 'Solo la granja avícola enciende el módulo agro',
    (SELECT count(*) FROM platform.business_profile_versions v
      WHERE v.manifest -> 'modules' -> 'agro' ->> 'enabled' = 'true') = 1,
    'el módulo agro no debe estar activo en perfiles que no lo usan');

  PERFORM test.eq(S, 'El vape shop declara 2 ejes de variante',
    (SELECT count(*) FROM platform.business_profile_versions v
       JOIN platform.business_profiles p ON p.id = v.profile_id,
       LATERAL jsonb_array_elements(v.manifest -> 'attributes' -> 'product') a
      WHERE p.slug = 'vape_shop' AND (a ->> 'is_variant_axis')::boolean), 2);

  PERFORM test.ok(S, 'Todo permiso de todo manifiesto existe en el catálogo',
    NOT EXISTS (
      SELECT 1
        FROM platform.business_profile_versions v,
             LATERAL jsonb_array_elements(v.manifest -> 'roles') r,
             LATERAL jsonb_array_elements_text(r -> 'permissions') perm
       WHERE perm <> '*' AND perm NOT LIKE '%.*'
         AND NOT EXISTS (SELECT 1 FROM platform.permissions p WHERE p.code = perm)),
    'un rol referencia un permiso inexistente');
END $profiles$;
