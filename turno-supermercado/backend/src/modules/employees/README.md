# Módulo `employees` — Equipo
**Opcional**: lo enciende el manifiesto del rubro.
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
**Turno** — Express + TS + Prisma + React/Vite  
_en producción, no lanzado_
**Archivos de referencia:**

```
backend/src/modules/negocios.routes.ts (PeluqueroEquipo, InvitacionNegocio)
```

## Qué se rescata

- invitaciones al equipo
- límite de miembros por plan
- vista por rol

## Qué falta construir

- marcaje de asistencia
- comisiones por venta

## Tablas que usa

`employees` · `time_entries` · `employee_commissions`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)