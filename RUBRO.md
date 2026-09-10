# Proyecto: vape_shop

Este proyecto es una copia independiente de la plataforma, **bloqueada al rubro `vape_shop`**.
La home es la landing de vape_shop; el registro entra directo a ese rubro; solo se muestran sus módulos.

## Poner en marcha
1. `cd backend && npm install && npx prisma migrate deploy && npm run dev`
2. `cd frontend && npm install && npm run dev`

## Variables clave (en el deploy)
- Backend (Railway): `RUBRO_FIJO=vape_shop` + DATABASE_URL, JWT_SECRET, etc.
- Frontend (Cloudflare): `VITE_RUBRO_FIJO=vape_shop` + `VITE_API_URL=<url del backend>`

## Subir a su propio repo
```
cd turno-vape_shop
git init && git add -A && git commit -m "init proyecto vape_shop"
# crea el repo en GitHub y:
git remote add origin <URL_DE_TU_REPO>
git push -u origin main
```
