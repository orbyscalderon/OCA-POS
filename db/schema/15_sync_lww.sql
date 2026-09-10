-- =====================================================================
-- OC POS · 15 · Merge por campo (LWW) para entidades de estado mutable
-- =====================================================================
-- Los LEDGERS (stock_events, credit_movements, biological_events,
-- loyalty_movements) no necesitan nada de esto: sus deltas son
-- conmutativos y se fusionan solos.
--
-- Pero productos, clientes, precios y empleados SÍ son estado mutable.
-- Si la Caja A cambia el precio y la Caja B cambia el nombre del mismo
-- producto estando ambas offline, un "last write wins" a nivel de FILA
-- descarta uno de los dos cambios. Aquí el LWW es a nivel de CAMPO.
--
-- Cada fila replicable lleva `sync_meta`:
--   {"price": {"v": 1042, "d": 3}, "name": {"v": 1039, "d": 1}}
--     v = reloj lógico del dispositivo que escribió ese campo
--     d = device_no, usado como desempate determinista
-- =====================================================================

-- ---------------------------------------------------------------------
-- Columna sync_meta en todas las entidades de estado replicadas
-- ---------------------------------------------------------------------
DO $do$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'products', 'product_variants', 'product_packagings', 'categories',
      'customers', 'suppliers', 'employees', 'price_list_items',
      'biological_lots', 'farm_units', 'tables', 'resources'
    ]) AS t
  LOOP
    EXECUTE format(
      'ALTER TABLE app.%I ADD COLUMN IF NOT EXISTS sync_meta jsonb NOT NULL DEFAULT ''{}''::jsonb',
      r.t);
  END LOOP;
END $do$;

-- ---------------------------------------------------------------------
-- ★ Merge por campo.
-- Devuelve {"data": <fila fusionada>, "meta": <relojes>, "conflicts": [...]}
-- La capa de aplicación aplica `data` con un UPDATE y persiste `conflicts`
-- en app.sync_conflicts cuando el arreglo no viene vacío.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.lww_merge(
  p_current_data   jsonb,
  p_current_meta   jsonb,
  p_incoming_data  jsonb,
  p_incoming_meta  jsonb,
  -- Campos donde el servidor gana SIEMPRE, sin importar el reloj.
  -- Un precio o un límite de crédito no puede quedar a merced del reloj
  -- de una tablet que estuvo cuatro días sin sincronizar.
  p_server_wins    text[] DEFAULT ARRAY['price','min_price','compare_at_price',
                                        'credit_limit','default_cost']
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  k          text;
  v_in       jsonb;
  v_cur      jsonb;
  clock_in   bigint;
  clock_cur  bigint;
  dev_in     int;
  dev_cur    int;
  out_data   jsonb := COALESCE(p_current_data, '{}'::jsonb);
  out_meta   jsonb := COALESCE(p_current_meta, '{}'::jsonb);
  conflicts  jsonb := '[]'::jsonb;
  takes      boolean;
BEGIN
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_incoming_data, '{}'::jsonb))
  LOOP
    v_in  := p_incoming_data -> k;
    v_cur := out_data -> k;

    -- Sin cambio real: no se toca el reloj
    IF v_cur IS NOT DISTINCT FROM v_in THEN
      CONTINUE;
    END IF;

    clock_in  := COALESCE((p_incoming_meta -> k ->> 'v')::bigint, 0);
    dev_in    := COALESCE((p_incoming_meta -> k ->> 'd')::int, 0);
    clock_cur := COALESCE((out_meta -> k ->> 'v')::bigint, 0);
    dev_cur   := COALESCE((out_meta -> k ->> 'd')::int, 0);

    IF k = ANY (p_server_wins) AND out_data ? k THEN
      takes := false;                       -- campo protegido: gana el servidor
    ELSIF clock_in > clock_cur THEN
      takes := true;
    ELSIF clock_in < clock_cur THEN
      takes := false;
    ELSE
      takes := dev_in > dev_cur;            -- empate: desempate determinista
    END IF;

    IF takes THEN
      out_data := out_data || jsonb_build_object(k, v_in);
      out_meta := out_meta || jsonb_build_object(
                    k, jsonb_build_object('v', clock_in, 'd', dev_in));
    END IF;

    -- Solo es conflicto si ambos lados escribieron el campo.
    -- Un campo que el servidor nunca tuvo no está en disputa.
    IF out_meta ? k AND clock_cur > 0 THEN
      conflicts := conflicts || jsonb_build_array(jsonb_build_object(
        'field',    k,
        'kept',     CASE WHEN takes THEN v_in  ELSE v_cur END,
        'discarded',CASE WHEN takes THEN v_cur ELSE v_in  END,
        'winner',   CASE WHEN takes THEN 'client' ELSE 'server' END,
        'protected', k = ANY (p_server_wins)
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object('data', out_data, 'meta', out_meta, 'conflicts', conflicts);
END $fn$;

COMMENT ON FUNCTION app.lww_merge IS
  'Fusiona dos versiones de una entidad de estado campo por campo usando relojes '
  'lógicos por campo. Ver docs/02-SYNC-OFFLINE.md seccion 5.3.';

-- ---------------------------------------------------------------------
-- Conveniencia: sella los relojes de los campos que cambian en el
-- servidor, para que un cliente que llega después no los pise con un
-- reloj más viejo.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app.stamp_field_clock(
  p_meta jsonb, p_fields text[], p_clock bigint, p_device_no int DEFAULT 0
) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT COALESCE(p_meta, '{}'::jsonb) || COALESCE(
    (SELECT jsonb_object_agg(f, jsonb_build_object('v', p_clock, 'd', p_device_no))
       FROM unnest(p_fields) AS f),
    '{}'::jsonb)
$fn$;
