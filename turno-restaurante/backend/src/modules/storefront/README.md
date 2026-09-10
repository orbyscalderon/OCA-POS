# Módulo `storefront` — Tienda online
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
src/app/(store)/{cart,checkout,order,devoluciones}
```

## Qué se rescata

- ★ carrito
- checkout
- detalle de pedido
- devoluciones
- páginas legales

## Qué falta construir

- catálogo por tenant sincronizado con inventario
- pedido por WhatsApp
- zonas de entrega

## Tablas que usa

`storefronts` · `online_orders` · `delivery_zones`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)