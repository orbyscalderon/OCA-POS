# Módulo `pos` — Punto de venta
**Módulo núcleo**: todo rubro lo lleva encendido.
## Rubros que lo activan  (9/9)
- `barberia`
- `farmacia`
- `ferreteria`
- `granja_avicola`
- `prestamista`
- `restaurante`
- `supermercado`
- `taller`
- `vape_shop`
## Origen
**Supermercado Silvia** — Next.js 14 + Prisma + NextAuth  
_requiere port a Vite_
**Archivos de referencia:**

```
src/app/api/caja/{barcode,productos,venta}, src/app/admin
```

## Qué se rescata

- caja con lector de barras
- búsqueda de productos
- registro de venta

## Qué falta construir

- layouts por rubro (grid/peso/servicio/búsqueda/mesas)
- impresión ESC/POS
- modo offline con RxDB
- múltiples métodos de pago

## Tablas que usa

`sales` · `sale_lines` · `sale_payments` · `sale_returns` · `promotions`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)