# Módulo `cash` — Caja y arqueo
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
**OC Credit** — NestJS + TypeORM + React  
_requiere port a Express_
**Archivos de referencia:**

```
backend/src/modules/cajas
```

## Qué se rescata

- apertura y cierre de caja
- transacciones de caja

## Qué falta construir

- arqueo por denominación
- detección de descuadre auditada

## Tablas que usa

`cash_sessions` · `cash_movements` · `cash_count_lines`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)