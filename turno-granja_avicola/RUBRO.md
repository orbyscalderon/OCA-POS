# Proyecto: granja_avicola

Este proyecto es una copia independiente de la plataforma, **bloqueada al rubro `granja_avicola`**.
La home es la landing de granja_avicola; el registro entra directo a ese rubro; solo se muestran sus módulos.

## Poner en marcha
1. `cd backend && npm install && npx prisma migrate deploy && npm run dev`
2. `cd frontend && npm install && npm run dev`

## Variables clave (en el deploy)
- Backend (Railway): `RUBRO_FIJO=granja_avicola` + DATABASE_URL, JWT_SECRET, etc.
- Frontend (Cloudflare): `VITE_RUBRO_FIJO=granja_avicola` + `VITE_API_URL=<url del backend>`

## Subir a su propio repo
```
cd turno-granja_avicola
git init && git add -A && git commit -m "init proyecto granja_avicola"
# crea el repo en GitHub y:
git remote add origin <URL_DE_TU_REPO>
git push -u origin main
```
