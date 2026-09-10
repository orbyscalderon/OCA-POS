-- =====================================================================
-- OC POS · 00 · Extensiones, esquemas y helpers transversales
-- PostgreSQL 15+
-- =====================================================================
-- Modelo de aislamiento: SHARED SCHEMA + ROW LEVEL SECURITY (RLS).
--   · schema "platform" -> datos de la plataforma (NO lleva RLS por tenant)
--   · schema "app"      -> datos del negocio (TODAS las tablas con tenant_id + RLS)
-- Tier Enterprise puede migrarse a base dedicada reusando el mismo DDL.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS app;

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_bytes, digest
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- búsqueda de productos por nombre
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- exclusión de solapes en citas/turnos

-- ---------------------------------------------------------------------
-- UUID v7: ordenable por tiempo (índices B-tree sin fragmentación) y
-- generable en el CLIENTE offline sin coordinación con el servidor.
-- En PostgreSQL 18+ se puede reemplazar el cuerpo por: SELECT uuidv7();
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts_ms  bytea;
  buf    bytea;
BEGIN
  ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3 FOR 6);
  buf   := ts_ms || gen_random_bytes(10);
  buf   := set_byte(buf, 6, (get_byte(buf, 6) & 15)  | 112);  -- version 7
  buf   := set_byte(buf, 8, (get_byte(buf, 8) & 63)  | 128);  -- variant RFC4122
  RETURN encode(buf, 'hex')::uuid;
END $$;

-- ---------------------------------------------------------------------
-- Contexto de sesión. El backend ejecuta por request:
--   SET LOCAL app.tenant_id = '<uuid>';
--   SET LOCAL app.user_id   = '<uuid>';
--   SET LOCAL app.branch_id = '<uuid>';
-- Todas las policies RLS y los triggers de auditoría leen de aquí.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.current_branch() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.branch_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------
-- Dominios monetarios. Regla del sistema:
--   · money      -> importes presentados/liquidados (2-4 decimales)
--   · unit_cost  -> costos unitarios y CPP (6 decimales, evita deriva)
--   · qty        -> cantidades (permite 0.001 para gramos/ml/servicios)
-- Prohibido usar float/double para dinero.
-- ---------------------------------------------------------------------
CREATE DOMAIN app.money      AS numeric(18,4);
CREATE DOMAIN app.unit_cost  AS numeric(18,6);
CREATE DOMAIN app.qty        AS numeric(18,3);
CREATE DOMAIN app.rate       AS numeric(9,6);   -- 0.190000 = 19%

-- ---------------------------------------------------------------------
-- Timestamps automáticos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------
-- Guardia anti-manipulación: se aplica a tablas append-only
-- (ledger de stock, auditoría, movimientos de crédito).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.tg_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Tabla append-only: % no admite % (registro %)',
    TG_TABLE_NAME, TG_OP, COALESCE(OLD.id::text, '?')
    USING ERRCODE = 'restrict_violation';
END $$;
