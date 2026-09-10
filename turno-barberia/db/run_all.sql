-- =====================================================================
-- OC POS · Aplicación completa del esquema + semillas
-- Uso:
--   psql "postgresql://user:pass@host:5432/ocpos" -v ON_ERROR_STOP=1 -f db/run_all.sql
-- Requiere ejecutarse desde el directorio db/ o con rutas relativas a él.
-- Requisitos: PostgreSQL 15+ con pgcrypto, pg_trgm, btree_gist y citext.
-- =====================================================================
\set ON_ERROR_STOP on
\timing off

\echo ''
\echo '########## ESQUEMA ##########'
\echo '>> 00 extensiones y helpers'
\ir schema/00_extensions_and_helpers.sql
\echo '>> 01 plataforma (tenants, perfiles, planes)'
\ir schema/01_platform.sql
\echo '>> 02 identidad, RBAC y dispositivos'
\ir schema/02_identity_rbac.sql
\echo '>> 03 unidades de medida multidimensionales'
\ir schema/03_uom.sql
\echo '>> 04 catalogo dinamico e inventario (ledger)'
\ir schema/04_catalog_inventory.sql
\echo '>> 05 agro engine (lotes biologicos)'
\ir schema/05_agro_biological.sql
\echo '>> 06 compras, CXP y gastos'
\ir schema/06_purchasing_expenses.sql
\echo '>> 07 ventas y POS'
\ir schema/07_sales_pos.sql
\echo '>> 08 clientes, fiado y CXC'
\ir schema/08_customers_credit.sql
\echo '>> 09 caja, arqueo y finanzas'
\ir schema/09_cash_finance.sql
\echo '>> 10 impuestos y comprobantes fiscales'
\ir schema/10_tax_fiscal.sql
\echo '>> 11 fidelizacion'
\ir schema/11_loyalty.sql
\echo '>> 12 modos operativos (citas, mesas, servicio, empleados)'
\ir schema/12_operations_modes.sql
\echo '>> 13 tienda online'
\ir schema/13_ecommerce.sql
\echo '>> 14 auditoria encadenada y motor de sync'
\ir schema/14_audit_sync.sql
\echo '>> 15 merge por campo (LWW) para entidades mutables'
\ir schema/15_sync_lww.sql
\echo '>> 16 facturacion del SaaS'
\ir schema/16_saas_billing.sql
\echo '>> 17 mensajeria y plantillas'
\ir schema/17_messaging_templates.sql
\echo '>> 18 funciones operativas'
\ir schema/18_operational_functions.sql
\echo '>> 19 tablas rescatadas de los proyectos anteriores'
\ir schema/19_from_legacy.sql
\echo '>> 99 roles, grants y RLS'
\ir schema/99_rls_policies.sql

\echo ''
\echo '########## SEMILLAS ##########'
\echo '>> 01 paises'
\ir seeds/01_countries.sql
\echo '>> 02 plantillas de impuestos'
\ir seeds/02_tax_templates.sql
\echo '>> 03 catalogo de permisos (generado)'
\ir seeds/03_permissions.generated.sql
\echo '>> 04 planes de suscripcion'
\ir seeds/04_plans.sql
\echo '>> 05 biblioteca de plantillas de mensajeria'
\ir seeds/05_message_templates.sql
\echo '>> 06 perfiles de negocio (generado)'
\ir seeds/06_business_profiles.generated.sql

-- =====================================================================
-- VERIFICACIONES POST-INSTALACIÓN
-- Las tres deben devolver CERO filas / la cuenta esperada.
-- =====================================================================
\echo ''
\echo '########## VERIFICACION ##########'

\echo '-- 1. Tablas con tenant_id SIN RLS forzado (debe estar vacio):'
SELECT table_name, rls_enabled, rls_forced, has_policy
  FROM app.v_rls_coverage
 WHERE NOT (rls_enabled AND rls_forced AND has_policy);

\echo '-- 2. Permisos referenciados por manifiestos que no existen (debe estar vacio):'
WITH manifest_perms AS (
  SELECT DISTINCT jsonb_array_elements_text(role_obj -> 'permissions') AS perm
    FROM platform.business_profile_versions v,
         LATERAL jsonb_array_elements(v.manifest -> 'roles') AS role_obj
   WHERE v.status = 'published'
)
SELECT perm
  FROM manifest_perms
 WHERE perm <> '*'
   AND perm NOT LIKE '%.*'
   AND NOT EXISTS (SELECT 1 FROM platform.permissions p WHERE p.code = manifest_perms.perm);

\echo '-- 3. Conteo de semillas:'
SELECT
  (SELECT count(*) FROM platform.countries)                 AS paises,
  (SELECT count(*) FROM platform.tax_templates)             AS impuestos,
  (SELECT count(*) FROM platform.permissions)               AS permisos,
  (SELECT count(*) FROM platform.plans)                     AS planes,
  (SELECT count(*) FROM platform.message_template_library)  AS plantillas,
  (SELECT count(*) FROM platform.business_profiles)         AS perfiles,
  (SELECT count(*) FROM platform.business_profile_versions
    WHERE status = 'published')                             AS manifiestos;

\echo ''
\echo '== OC POS instalado =='
