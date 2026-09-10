# Módulo `lending` — Préstamos
**Opcional**: lo enciende el manifiesto del rubro.
## Rubros que lo activan  (1/9)
- `prestamista`
## Origen
**OC Credit** — NestJS + TypeORM + React  
_requiere port a Express_
**Archivos de referencia:**

```
backend/src/modules/{rutas,prestamos,cobros}
```

## Qué se rescata

- ★ rutas de cobranza con GPS
- novedades de ruta
- webhooks de pagos digitales
- feriados
- amortización francesa

## Qué falta construir

- integrar al ledger de crédito unificado

## Tablas que usa

`credit_accounts (kind=loan)` · `credit_installments`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)