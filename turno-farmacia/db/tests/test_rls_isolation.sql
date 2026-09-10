-- =====================================================================
-- OC POS · TEST · Aislamiento multi-tenant (RLS)
-- ---------------------------------------------------------------------
-- La barrera que no se negocia. Se prueba con el rol REAL de la
-- aplicación (`ocpos_app`), no con el superusuario: un superusuario
-- siempre evade RLS, así que probar con él no demuestra nada.
-- =====================================================================

DO $rls$
DECLARE
  S constant text := 'rls';
  v_a        uuid;
  v_b        uuid;
  v_uom_a    uuid;
  v_uom_b    uuid;
  v_prod_b   uuid;
  v_sin_ctx  int;
  v_con_ctx  int;
  v_ve_otro  int;
  v_updated  int;
  v_state    text;
BEGIN
  -- ── Montaje: dos negocios distintos ────────────────────────────────
  v_a := test.new_tenant('test-rls-a');
  v_b := test.new_tenant('test-rls-b');

  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_a, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_uom_a;
  INSERT INTO app.uoms (tenant_id, code, name, dimension, factor_to_base, is_base)
  VALUES (v_b, 'UND', 'Unidad', 'unit', 1, true) RETURNING id INTO v_uom_b;

  INSERT INTO app.products (tenant_id, name, base_uom_id)
  VALUES (v_a, 'Producto del negocio A', v_uom_a);
  INSERT INTO app.products (tenant_id, name, base_uom_id)
  VALUES (v_b, 'Producto del negocio B', v_uom_b) RETURNING id INTO v_prod_b;

  -- ── A partir de aquí, somos la aplicación, no el superusuario ──────
  EXECUTE 'SET LOCAL ROLE ocpos_app';

  -- 1 · Sin contexto de tenant: la consulta no devuelve NADA.
  --     Este es el comportamiento que convierte un bug de repositorio en
  --     una lista vacía en vez de una fuga de datos entre negocios.
  PERFORM set_config('app.tenant_id', '', true);
  SELECT count(*) INTO v_sin_ctx FROM app.products;

  -- 2 · Con contexto de A: solo los productos de A.
  PERFORM set_config('app.tenant_id', v_a::text, true);
  SELECT count(*) INTO v_con_ctx FROM app.products;
  SELECT count(*) INTO v_ve_otro FROM app.products WHERE tenant_id = v_b;

  -- 3 · Insertar en el tenant ajeno debe ser rechazado por WITH CHECK.
  BEGIN
    INSERT INTO app.products (tenant_id, name, base_uom_id)
    VALUES (v_b, 'Intento de intrusión', v_uom_b);
    v_state := NULL;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;

  -- 4 · Actualizar una fila ajena no afecta ninguna fila (es invisible).
  UPDATE app.products SET name = 'secuestrado' WHERE id = v_prod_b;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  EXECUTE 'RESET ROLE';

  -- ── Aserciones (ya como superusuario, para poder escribir en test.*) ─
  PERFORM test.eq(S, 'Sin contexto de tenant se devuelven 0 filas', v_sin_ctx, 0);
  PERFORM test.eq(S, 'Con contexto de A se ve exactamente 1 producto', v_con_ctx, 1);
  PERFORM test.eq(S, 'Desde A no se ve ningún producto de B', v_ve_otro, 0);
  PERFORM test.eq_text(S, 'INSERT en tenant ajeno es rechazado (42501)', v_state, '42501');
  PERFORM test.eq(S, 'UPDATE de fila ajena no afecta ninguna fila', v_updated, 0);

  -- 5 · El producto de B sigue intacto.
  PERFORM test.eq_text(S, 'La fila de B no fue modificada',
    (SELECT name FROM app.products WHERE id = v_prod_b), 'Producto del negocio B');
END $rls$;

-- =====================================================================
-- Cobertura: ninguna tabla con tenant_id puede quedar sin RLS forzado
-- =====================================================================
DO $cover$
DECLARE
  S constant text := 'rls';
  v_missing int;
  v_list    text;
BEGIN
  SELECT count(*), string_agg(table_name, ', ')
    INTO v_missing, v_list
    FROM app.v_rls_coverage
   WHERE NOT (rls_enabled AND rls_forced AND has_policy);

  PERFORM test.ok(S, 'Todas las tablas con tenant_id tienen RLS forzado',
    v_missing = 0, format('sin proteger: %s', v_list));

  PERFORM test.ok(S, 'La cobertura abarca más de 60 tablas',
    (SELECT count(*) FROM app.v_rls_coverage) > 60,
    format('solo %s tablas evaluadas', (SELECT count(*) FROM app.v_rls_coverage)));

  -- El rol de la aplicación no puede tener BYPASSRLS ni ser superusuario:
  -- sería una puerta trasera que anularía todo lo anterior.
  PERFORM test.ok(S, 'ocpos_app no evade RLS',
    (SELECT NOT rolbypassrls AND NOT rolsuper FROM pg_roles WHERE rolname = 'ocpos_app'),
    'el rol de la aplicación tiene privilegios que anulan el aislamiento');
END $cover$;

-- =====================================================================
-- Los ledgers deben ser inmutables también a nivel de privilegios,
-- no solo por trigger. Doble barrera.
-- =====================================================================
DO $immutable$
DECLARE
  S constant text := 'rls';
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_events','credit_movements','cash_movements',
                           'biological_events','biological_costs',
                           'loyalty_movements','audit_logs']
  LOOP
    PERFORM test.ok(S, format('app.%s tiene trigger append-only', t),
      EXISTS (SELECT 1 FROM pg_trigger g
                JOIN pg_class c ON c.oid = g.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'app' AND c.relname = t
                 AND g.tgname = 'no_update' AND NOT g.tgisinternal),
      'falta el trigger tg_append_only');

    PERFORM test.ok(S, format('ocpos_app no puede UPDATE sobre app.%s', t),
      NOT has_table_privilege('ocpos_app', 'app.' || t, 'UPDATE'),
      'el REVOKE de 99_rls_policies no se aplicó');

    PERFORM test.ok(S, format('ocpos_app no puede DELETE sobre app.%s', t),
      NOT has_table_privilege('ocpos_app', 'app.' || t, 'DELETE'),
      'el REVOKE de 99_rls_policies no se aplicó');
  END LOOP;
END $immutable$;
