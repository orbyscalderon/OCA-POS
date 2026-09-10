-- =====================================================================
-- OC POS · 99 · Roles, Grants y Row Level Security
-- =====================================================================
-- Estrategia de aislamiento multi-tenant:
--   1) La app se conecta con el rol `ocpos_app`, que NO es superusuario ni
--      dueno de las tablas -> las policies SI le aplican.
--   2) Cada request abre transaccion y ejecuta:
--        SET LOCAL app.tenant_id = '...'; SET LOCAL app.user_id = '...';
--      Si falta, current_tenant() es NULL y las policies devuelven 0 filas.
--      Es decir: un bug en un repositorio no filtra datos de otro negocio.
--   3) FORCE ROW LEVEL SECURITY para que ni el dueno de la tabla la evada.
-- =====================================================================

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ocpos_app') THEN
    CREATE ROLE ocpos_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ocpos_migrator') THEN
    CREATE ROLE ocpos_migrator LOGIN;
  END IF;
  -- Rol de solo lectura para BI / exportaciones del contador
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ocpos_readonly') THEN
    CREATE ROLE ocpos_readonly LOGIN;
  END IF;
END $do$;

GRANT USAGE ON SCHEMA app, platform TO ocpos_app, ocpos_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA app TO ocpos_app;
GRANT SELECT, INSERT, UPDATE          ON ALL TABLES IN SCHEMA platform TO ocpos_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app, platform TO ocpos_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app, platform TO ocpos_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO ocpos_app;

-- ---------------------------------------------------------------------
-- Tablas INMUTABLES: la aplicacion no puede ni siquiera intentar
-- modificarlas. Es la segunda barrera (la primera es el trigger).
-- ---------------------------------------------------------------------
REVOKE UPDATE, DELETE ON
  app.audit_logs, app.stock_events, app.credit_movements,
  app.cash_movements, app.biological_events, app.biological_costs,
  app.loyalty_movements
FROM ocpos_app;

-- ---------------------------------------------------------------------
-- RLS en TODAS las tablas de app que tengan tenant_id
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'app'
       AND c.relkind = 'r'
       AND EXISTS (
             SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0
           )
  LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE  ROW LEVEL SECURITY', r.table_name);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON app.%I
        USING      (tenant_id = app.current_tenant())
        WITH CHECK (tenant_id = app.current_tenant())
    $p$, r.table_name);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Alcance por SUCURSAL: un cajero de la sucursal A no debe leer las ventas
-- de la B. Se aplica como policy adicional (AND implicito con la anterior)
-- sobre las tablas operativas que tienen branch_id.
-- Un usuario sin restricciones (admin/contador) recibe branch_id vacio en
-- el contexto y ve todo.
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    -- Solo tablas que realmente tienen branch_id. `online_orders` se acota
    -- por storefront (que ya apunta a una sucursal), no directamente.
    SELECT unnest(ARRAY['sales','sale_returns','cash_sessions','appointments',
                        'table_orders','service_orders',
                        'purchase_orders','expenses']) AS table_name
  LOOP
    EXECUTE format($p$
      CREATE POLICY branch_scope ON app.%I AS RESTRICTIVE
        USING (
          app.current_branch() IS NULL
          OR branch_id = app.current_branch()
          OR branch_id IS NULL
        )
    $p$, r.table_name);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- Platform: solo el backend de plataforma toca estas tablas. Se protege
-- tenants para que un request de tenant A no lea la fila de tenant B.
-- ---------------------------------------------------------------------
ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenants FORCE  ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON platform.tenants
  USING (id = app.current_tenant() OR app.current_tenant() IS NULL);

ALTER TABLE platform.tenant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.tenant_memberships FORCE  ROW LEVEL SECURITY;
CREATE POLICY membership_scope ON platform.tenant_memberships
  USING (tenant_id = app.current_tenant() OR app.current_tenant() IS NULL);

-- ---------------------------------------------------------------------
-- Defaults para tablas futuras creadas por migraciones
-- ---------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE ocpos_migrator IN SCHEMA app
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ocpos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ocpos_migrator IN SCHEMA app
  GRANT USAGE, SELECT ON SEQUENCES TO ocpos_app;

-- ---------------------------------------------------------------------
-- Helper de test: verifica que ninguna tabla de app quedo sin RLS.
-- Se ejecuta en CI y falla el build si aparece una tabla desprotegida.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_rls_coverage AS
SELECT c.relname                                     AS table_name,
       c.relrowsecurity                              AS rls_enabled,
       c.relforcerowsecurity                         AS rls_forced,
       EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid) AS has_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_attribute a
               WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnum > 0);
