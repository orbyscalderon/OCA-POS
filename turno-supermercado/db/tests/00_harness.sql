-- =====================================================================
-- OC POS · Harness de tests en SQL puro
-- ---------------------------------------------------------------------
-- Sin dependencias: corre igual en psql, en CI y en PGlite (WASM).
-- Cada aserción se registra en test.results y aborta al primer fallo,
-- para que el error aparezca junto al caso que lo produjo.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS test;

DROP TABLE IF EXISTS test.results;
CREATE TABLE test.results (
  id     serial PRIMARY KEY,
  suite  text NOT NULL,
  name   text NOT NULL,
  passed boolean NOT NULL,
  detail text,
  at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Aserción booleana
CREATE OR REPLACE FUNCTION test.ok(
  p_suite text, p_name text, p_cond boolean, p_detail text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO test.results (suite, name, passed, detail)
  VALUES (p_suite, p_name, COALESCE(p_cond, false), p_detail);

  IF NOT COALESCE(p_cond, false) THEN
    RAISE EXCEPTION E'\n  TEST FALLIDO  [%]  %\n  %', p_suite, p_name, COALESCE(p_detail, '(sin detalle)')
      USING ERRCODE = 'assert_failure';
  END IF;
END $fn$;

-- Igualdad numérica con tolerancia (dinero y promedios)
CREATE OR REPLACE FUNCTION test.eq(
  p_suite text, p_name text, p_actual numeric, p_expected numeric, p_tol numeric DEFAULT 0.0001
) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM test.ok(p_suite, p_name,
    p_actual IS NOT NULL AND abs(p_actual - p_expected) <= p_tol,
    format('esperado %s, obtenido %s', p_expected, COALESCE(p_actual::text, 'NULL')));
END $fn$;

-- Igualdad de texto
CREATE OR REPLACE FUNCTION test.eq_text(
  p_suite text, p_name text, p_actual text, p_expected text
) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM test.ok(p_suite, p_name, p_actual IS NOT DISTINCT FROM p_expected,
    format('esperado %L, obtenido %L', p_expected, p_actual));
END $fn$;

-- Verifica que una sentencia falle con el SQLSTATE esperado.
-- Se usa para probar las barreras: append-only, sobregiro, RLS.
CREATE OR REPLACE FUNCTION test.raises(
  p_suite text, p_name text, p_sql text, p_sqlstate text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;

  IF v_state IS NULL THEN
    PERFORM test.ok(p_suite, p_name, false, 'la sentencia no falló, y debía fallar');
  ELSIF p_sqlstate IS NOT NULL AND v_state <> p_sqlstate THEN
    PERFORM test.ok(p_suite, p_name, false,
      format('falló con SQLSTATE %s, se esperaba %s', v_state, p_sqlstate));
  ELSE
    PERFORM test.ok(p_suite, p_name, true, format('falló como se esperaba (%s)', v_state));
  END IF;
END $fn$;

-- Tenant de prueba desechable. Devuelve el id.
CREATE OR REPLACE FUNCTION test.new_tenant(p_slug text, p_country char(2) DEFAULT 'DO')
RETURNS uuid
LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid;
BEGIN
  DELETE FROM platform.tenants WHERE slug = p_slug;
  INSERT INTO platform.tenants (slug, legal_name, trade_name, country_code, currency_code)
  SELECT p_slug, 'Test ' || p_slug, p_slug, p_country, c.currency_code
    FROM platform.countries c WHERE c.code = p_country
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- Borra todo lo creado por los tests.
-- Usa platform.purge_tenant porque un DELETE normal choca con los
-- triggers append-only de los ledgers — que es precisamente lo que se
-- quiere en producción.
CREATE OR REPLACE FUNCTION test.cleanup() RETURNS int
LANGUAGE plpgsql AS $fn$
DECLARE r record; v_n int := 0;
BEGIN
  FOR r IN SELECT id FROM platform.tenants WHERE slug LIKE 'test-%' LOOP
    v_n := v_n + platform.purge_tenant(r.id, 'BORRAR DEFINITIVAMENTE', 'limpieza de tests');
  END LOOP;
  RETURN v_n;
END $fn$;
