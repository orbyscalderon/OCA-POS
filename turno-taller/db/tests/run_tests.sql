-- =====================================================================
-- OC POS · Suite de tests
-- Monta el esquema en una base limpia y corre todas las comprobaciones.
--   npm run db:test
-- =====================================================================
\ir ../run_all.sql

\echo ''
\echo '########## TESTS ##########'
\ir 00_harness.sql
\ir test_ledger_commutativity.sql
\ir test_rls_isolation.sql
\ir test_business_logic.sql

\echo ''
\echo '-- Resultados por suite:'
SELECT suite,
       count(*)                              AS total,
       count(*) FILTER (WHERE passed)        AS pasaron,
       count(*) FILTER (WHERE NOT passed)    AS fallaron
  FROM test.results GROUP BY suite ORDER BY suite;

\echo ''
\echo '-- Total:'
SELECT count(*) AS aserciones,
       count(*) FILTER (WHERE passed) AS pasaron,
       count(*) FILTER (WHERE NOT passed) AS fallaron
  FROM test.results;

SELECT test.cleanup() AS tenants_de_prueba_eliminados;
