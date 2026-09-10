# Módulo `appointments` — Citas y agenda
**Opcional**: lo enciende el manifiesto del rubro.
## Rubros que lo activan  (2/9)
- `barberia`
- `taller`
## Origen
**Turno** — Express + TS + Prisma + React/Vite  
_en producción, no lanzado_
**Archivos de referencia:**

```
backend/src/modules/{slots.service,disponibilidad,reservas,resenas}.ts, frontend/src/components/{ClienteView,PeluqueroView,AdminView}.tsx
```

## Qué se rescata

- ★ motor de slots
- anti-colisión con SELECT FOR UPDATE
- disponibilidad por profesional
- bloqueos
- reservas
- reseñas
- recordatorios

## Qué falta construir

- reemplazar el lock por la restricción EXCLUDE de PostgreSQL, que ya está en el esquema

## Tablas que usa

`appointments` · `resources` · `service_orders`

---
Registro completo: [`config/modules.json`](../../../../config/modules.json)