# Migraciones

`db/schema/` es la **fuente de verdad del modelo**: se lee como documentación
y se aplica de golpe en una base nueva con `db/run_all.sql`.

`db/migrations/` es cómo ese modelo llega a una base **que ya tiene datos**.

## Flujo

1. Se edita el archivo correspondiente en `db/schema/`.
2. Se genera la migración incremental:

   ```bash
   pnpm drizzle-kit generate --name descripcion_del_cambio
   ```

3. Se revisa el SQL generado **a mano**. `drizzle-kit` no sabe de triggers,
   políticas RLS, particiones ni funciones: esos cambios se escriben aquí.
4. Se aplica:

   ```bash
   pnpm drizzle-kit migrate
   ```

## Reglas

- **Una migración nunca se edita después de mergeada.** Se corrige con otra.
- Toda migración que cree una tabla con `tenant_id` debe habilitar RLS en la
  misma migración. El job `schema` del CI falla si no.
- Los cambios destructivos (`DROP COLUMN`, `DROP TABLE`) van en una migración
  aparte, posterior al despliegue del código que dejó de usarlos. Nunca en la
  misma que el cambio de aplicación.
- Las tablas append-only (`stock_events`, `credit_movements`, `audit_logs`,
  `biological_events`, `biological_costs`, `loyalty_movements`) no admiten
  migraciones de datos con `UPDATE`. Para corregir un asiento se emite un
  asiento compensatorio.

## Numeración

`0001_nombre.sql`, `0002_nombre.sql`… El orden lo determina el prefijo, no la
fecha del archivo.
