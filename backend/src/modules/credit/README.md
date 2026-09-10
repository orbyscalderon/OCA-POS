# Módulo `credit` — Fiado y cuentas por cobrar
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
backend/src/modules/{prestamos,cobros}, helpers/amortizacion.helper.ts
```

## Qué se rescata

- plan de amortización
- cargos por mora
- registro de cobros
- transacciones

## Qué falta construir

- libreta de fiado sin cronograma
- cobranza por WhatsApp con link de pago

## Tablas que usa

`credit_accounts` · `credit_installments` · `credit_movements` · `payment_links`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)