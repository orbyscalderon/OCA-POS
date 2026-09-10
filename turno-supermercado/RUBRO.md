# Proyecto: supermercado

Este proyecto es una copia independiente de la plataforma, **bloqueada al rubro `supermercado`**.
La home es la landing de supermercado; el registro entra directo a ese rubro; solo se muestran sus módulos.

## Poner en marcha
1. `cd backend && npm install && npx prisma migrate deploy && npm run dev`
2. `cd frontend && npm install && npm run dev`

## Variables clave (en el deploy)
- Backend (Railway): `RUBRO_FIJO=supermercado` + DATABASE_URL, JWT_SECRET, etc.
- Frontend (Cloudflare): `VITE_RUBRO_FIJO=supermercado` + `VITE_API_URL=<url del backend>`

## Subir a su propio repo
```
cd turno-supermercado
git init && git add -A && git commit -m "init proyecto supermercado"
# crea el repo en GitHub y:
git remote add origin <URL_DE_TU_REPO>
git push -u origin main
```
