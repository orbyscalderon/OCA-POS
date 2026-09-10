# Módulo `inventory` — Inventario
**Opcional**: lo enciende el manifiesto del rubro.
## Rubros que lo activan  (8/9)
- `barberia`
- `farmacia`
- `ferreteria`
- `granja_avicola`
- `restaurante`
- `supermercado`
- `taller`
- `vape_shop`
## Origen
**Supermercado Silvia** — Next.js 14 + Prisma + NextAuth  
_requiere port a Vite_
**Archivos de referencia:**

```
prisma/schema.prisma (Product, Category), src/app/admin/products
```

## Qué se rescata

- catálogo de productos y categorías
- admin de productos

## Qué falta construir

- ledger conmutativo de stock
- costo promedio ponderado
- lotes y vencimiento
- multi-almacén
- unidades multidimensionales

## Tablas que usa

`products` · `product_variants` · `stock_events` · `stock_balances` · `variant_costs`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)