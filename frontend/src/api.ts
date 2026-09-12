// Cliente HTTP de la API de Turno. Adjunta el JWT y renueva con el refresh token ante un 401.
import type { TKey } from "./i18n";

// Base del backend. En dev queda vacía (rutas relativas + proxy de Vite).
// En producción se define VITE_API_URL al build (p. ej. la URL de Railway).
const API_BASE = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// Resuelve URLs de imágenes servidas por el backend (/uploads/...) contra la base correcta.
export function assetUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  if (/^https?:\/\//.test(u)) return u; // ya absoluta (p. ej. S3/R2)
  return `${API_BASE}${u}`;
}

// URL absoluta de un endpoint (para fetch directos como descargas de archivos).
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

// Genera y descarga un CSV a partir de encabezados + filas.
export function descargarCSV(nombre: string, headers: string[], filas: (string | number)[][]) {
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...filas].map((r) => r.map(esc).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  URL.revokeObjectURL(url);
}

const TOKEN_KEY = "turno_token";
const REFRESH_KEY = "turno_refresh";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}
export function setSession(token: string | null, refreshToken?: string | null) {
  setToken(token);
  if (refreshToken !== undefined) setRefreshToken(refreshToken);
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

// La UI (AuthProvider) se suscribe para enterarse cuando la sesión deja de ser válida
// y así limpiar el usuario en pantalla en vez de quedar "logueado" mostrando pantallas rotas.
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(fn: (() => void) | null) {
  onSessionExpired = fn;
}

// Renueva el token de acceso con el refresh token. Evita renovaciones simultáneas.
let refreshing: Promise<boolean> | null = null;
async function intentarRefrescar(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  if (!refreshing) {
    refreshing = fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (r) => {
        if (!r.ok) return false;
        const d = await r.json();
        setSession(d.token, d.refreshToken);
        return true;
      })
      .catch(() => false)
      .finally(() => { refreshing = null; });
  }
  const ok = await refreshing;
  if (!ok) {
    // El refresh token expiró o fue revocado: cierra la sesión de verdad en vez de
    // dejar al usuario "logueado" viendo pantallas que fallan en silencio.
    setSession(null, null);
    onSessionExpired?.();
  }
  return ok;
}

async function request<T>(method: string, path: string, body?: unknown, _retry = false): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Token expirado: intenta refrescar una vez y reintenta la petición.
  if (res.status === 401 && !_retry && path !== "/auth/refresh" && (await intentarRefrescar())) {
    return request<T>(method, path, body, true);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    throw new ApiError(res.status, data?.error ?? "Error de red", data?.code);
  }
  return data as T;
}

// Descarga autenticada de un archivo binario (p. ej. export GDPR), con el mismo
// manejo de 401/refresh y de errores que `request()` (a diferencia de un fetch suelto).
async function downloadFile(path: string, _retry = false): Promise<Blob> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${path}`, { headers });

  if (res.status === 401 && !_retry && (await intentarRefrescar())) {
    return downloadFile(path, true);
  }
  if (!res.ok) {
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    throw new ApiError(res.status, data?.error ?? "Error de red", data?.code);
  }
  return res.blob();
}

async function uploadFile<T>(path: string, campo: string, file: File): Promise<T> {
  const fd = new FormData();
  fd.append(campo, file);
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${path}`, { method: "POST", headers, body: fd });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Error de subida", data?.code);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
  upload: uploadFile,
  download: downloadFile,
};

// ----- Tipos compartidos -----
export type Rol = "superadmin" | "admin_negocio" | "peluquero" | "cliente";

// Rol funcional del usuario DENTRO de un negocio concreto (personal, no el rol global de la
// cuenta). El backend manda literalmente "dueno" si es el dueño (acceso total); para el
// personal es solo una ETIQUETA de plantilla (cajero/gerente/.../personalizado) — no determina
// el acceso, eso lo decide `misPermisos` función por función.
export type RolNegocio = string;

// Catálogo completo de permisos (espejo de backend/src/lib/acceso.ts) — cada uno protege una
// acción concreta. El backend vuelve a exigir el mismo permiso en cada ruta; esto es solo para
// armar los checkboxes y ocultar botones/pestañas que de todos modos fallarían.
export const PERMISOS = [
  "ventas.vender", "ventas.anular", "ventas.caja",
  "inventario.ver", "inventario.crear", "inventario.editar", "inventario.eliminar",
  "clientes.ver", "clientes.crear", "clientes.editar", "clientes.eliminar",
  "compras.ver", "compras.crear", "compras.eliminar",
  "gastos.ver", "gastos.crear", "gastos.eliminar",
  "reportes.ver",
  "impuestos.gestionar",
  "agro.gestionar",
  "equipo.ver", "equipo.crear", "equipo.editar", "equipo.eliminar",
] as const;
export type Permiso = (typeof PERMISOS)[number];

// Grupos para la UI de selección (checkboxes agrupados por área). `modulo` es el módulo del
// rubro que debe estar activo para mostrar ese grupo (undefined = siempre se muestra).
export const GRUPOS_PERMISOS: { grupo: TKey; modulo?: string; permisos: { value: Permiso; labelKey: TKey }[] }[] = [
  { grupo: "perm.group.ventas", modulo: "pos", permisos: [
    { value: "ventas.vender", labelKey: "perm.ventas.vender" },
    { value: "ventas.anular", labelKey: "perm.ventas.anular" },
    { value: "ventas.caja", labelKey: "perm.ventas.caja" },
  ] },
  { grupo: "perm.group.inventario", modulo: "pos", permisos: [
    { value: "inventario.ver", labelKey: "perm.inventario.ver" },
    { value: "inventario.crear", labelKey: "perm.inventario.crear" },
    { value: "inventario.editar", labelKey: "perm.inventario.editar" },
    { value: "inventario.eliminar", labelKey: "perm.inventario.eliminar" },
  ] },
  { grupo: "perm.group.clientes", modulo: "customers", permisos: [
    { value: "clientes.ver", labelKey: "perm.clientes.ver" },
    { value: "clientes.crear", labelKey: "perm.clientes.crear" },
    { value: "clientes.editar", labelKey: "perm.clientes.editar" },
    { value: "clientes.eliminar", labelKey: "perm.clientes.eliminar" },
  ] },
  { grupo: "perm.group.compras", modulo: "purchasing", permisos: [
    { value: "compras.ver", labelKey: "perm.compras.ver" },
    { value: "compras.crear", labelKey: "perm.compras.crear" },
    { value: "compras.eliminar", labelKey: "perm.compras.eliminar" },
  ] },
  { grupo: "perm.group.gastos", modulo: "expenses", permisos: [
    { value: "gastos.ver", labelKey: "perm.gastos.ver" },
    { value: "gastos.crear", labelKey: "perm.gastos.crear" },
    { value: "gastos.eliminar", labelKey: "perm.gastos.eliminar" },
  ] },
  { grupo: "perm.group.reportes", permisos: [
    { value: "reportes.ver", labelKey: "perm.reportes.ver" },
  ] },
  { grupo: "perm.group.impuestos", modulo: "taxes", permisos: [
    { value: "impuestos.gestionar", labelKey: "perm.impuestos.gestionar" },
  ] },
  { grupo: "perm.group.agro", modulo: "agro", permisos: [
    { value: "agro.gestionar", labelKey: "perm.agro.gestionar" },
  ] },
  { grupo: "perm.group.equipo", permisos: [
    { value: "equipo.ver", labelKey: "perm.equipo.ver" },
    { value: "equipo.crear", labelKey: "perm.equipo.crear" },
    { value: "equipo.editar", labelKey: "perm.equipo.editar" },
    { value: "equipo.eliminar", labelKey: "perm.equipo.eliminar" },
  ] },
];

// Plantillas de arranque rápido (espejo de PLANTILLAS en el backend): el dueño puede aplicar
// una para no tildar 24 casillas una por una, y después ajustar lo que quiera a mano.
export const PLANTILLAS_PERMISOS: Record<string, Permiso[]> = {
  gerente: PERMISOS.slice() as Permiso[],
  cajero: ["ventas.vender", "ventas.caja"],
  inventario: ["inventario.ver", "inventario.crear", "inventario.editar", "inventario.eliminar", "compras.ver", "compras.crear", "agro.gestionar"],
  contador: ["gastos.ver", "gastos.crear", "gastos.eliminar", "reportes.ver", "impuestos.gestionar", "compras.ver"],
};
export const ROLES_ASIGNABLES: { value: string; shortKey: TKey; labelKey: TKey }[] = [
  { value: "gerente", shortKey: "roles.gerente", labelKey: "roles.gerenteFull" },
  { value: "cajero", shortKey: "roles.cajero", labelKey: "roles.cajeroFull" },
  { value: "inventario", shortKey: "roles.inventario", labelKey: "roles.inventarioFull" },
  { value: "contador", shortKey: "roles.contador", labelKey: "roles.contadorFull" },
];
// `t` se pasa desde el componente (useT) porque este archivo no es un componente React.
export function rolNegocioLabel(rol: string, t: (key: TKey) => string): string {
  const found = ROLES_ASIGNABLES.find((r) => r.value === rol);
  return found ? t(found.shortKey) : rol === "personalizado" ? t("roles.custom") : rol;
}

// ¿Puede este usuario, en este negocio, hacer X? El dueño siempre puede todo; el personal
// necesita tener AL MENOS UNO de los permisos pedidos en su lista `misPermisos`.
export function puedeNegocio(negocio: { miRol?: RolNegocio; misPermisos?: Permiso[] } | undefined, permiso: Permiso | Permiso[]): boolean {
  if (!negocio || !negocio.miRol || negocio.miRol === "dueno") return true;
  const lista = Array.isArray(permiso) ? permiso : [permiso];
  return (negocio.misPermisos ?? []).some((p) => lista.includes(p));
}

export interface Usuario {
  id: number;
  nombre: string;
  email: string;
  rol: Rol;
  telefono?: string;
  emailVerificadoEn?: string | null;
}

export interface Negocio {
  id: string;
  nombreComercial: string;
  categoria?: string;
  perfil?: string | null;
  slug: string;
  direccion: string;
  telefonoContacto: string;
  logoUrl?: string | null;
  coverUrl?: string | null;
  // Presente cuando la lista viene de /negocios/mios: qué rol/permisos tiene ESTE usuario ahí.
  miRol?: RolNegocio;
  misPermisos?: Permiso[];
  lat?: number | null;
  lng?: number | null;
  ratingPromedio?: number;
  ratingConteo?: number;
  distanciaKm?: number | null;
  // Fidelización: cuántos puntos da cada venta y cuántos hacen falta para el premio.
  puntosPorVenta?: number;
  puntosParaPremio?: number;
}

// Rubro del motor de nicho (activa sus módulos).
export interface Perfil {
  slug: string;
  nombre: string;
  categoria: string;
  emoji: string;
  modoPrimario: string;
  descripcion: string;
  modulos: string[];
}

// URL de Google Maps para un negocio (usa coords si existen, si no la dirección).
export function mapsUrl(n: { lat?: number | null; lng?: number | null; direccion?: string }): string {
  if (n.lat != null && n.lng != null) return `https://www.google.com/maps/search/?api=1&query=${n.lat},${n.lng}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.direccion ?? "")}`;
}

// Etiquetas legibles de las categorías de negocio (plataforma multi-rubro).
export const CATEGORIAS: { value: string; label: string }[] = [
  { value: "barberia", label: "Barbería" },
  { value: "peluqueria", label: "Peluquería" },
  { value: "estetica", label: "Estética" },
  { value: "unas", label: "Uñas" },
  { value: "spa", label: "Spa" },
  { value: "masajes", label: "Masajes" },
  { value: "tatuajes", label: "Tatuajes" },
  { value: "depilacion", label: "Depilación" },
  { value: "maquillaje", label: "Maquillaje" },
  { value: "otro", label: "Otro" },
];

export function categoriaLabel(value?: string): string {
  return CATEGORIAS.find((c) => c.value === value)?.label ?? "Servicios";
}

// Emoji + degradado de portada por categoría (para tarjetas estilo marketplace).
const CAT_META: Record<string, { emoji: string; grad: string }> = {
  barberia:  { emoji: "💈", grad: "linear-gradient(135deg,#1e63e6,#08090c)" },
  peluqueria:{ emoji: "💇", grad: "linear-gradient(135deg,#2f7bff,#12131a)" },
  estetica:  { emoji: "💆", grad: "linear-gradient(135deg,#ff3b47,#12131a)" },
  unas:      { emoji: "💅", grad: "linear-gradient(135deg,#e11d2b,#191b22)" },
  spa:       { emoji: "🧖", grad: "linear-gradient(135deg,#1550c0,#08090c)" },
  masajes:   { emoji: "💆", grad: "linear-gradient(135deg,#2f7bff,#ff3b47)" },
  tatuajes:  { emoji: "🖋️", grad: "linear-gradient(135deg,#08090c,#e11d2b)" },
  depilacion:{ emoji: "✨", grad: "linear-gradient(135deg,#1e63e6,#ff3b47)" },
  maquillaje:{ emoji: "💄", grad: "linear-gradient(135deg,#ff3b47,#08090c)" },
  otro:      { emoji: "🏬", grad: "linear-gradient(135deg,#21242d,#08090c)" },
};
export function categoriaEmoji(value?: string): string {
  return CAT_META[value ?? "otro"]?.emoji ?? "🏬";
}
export function categoriaGrad(value?: string): string {
  return CAT_META[value ?? "otro"]?.grad ?? CAT_META.otro.grad;
}

export interface Peluquero {
  id: number;
  nombre: string;
  telefono?: string;
  fotoUrl?: string | null;
}

export interface Servicio {
  id: number;
  nombreServicio: string;
  precio: string | number;
  moneda?: string;
  duracionMinutos: number;
  imagenUrl?: string | null;
}

// Monedas soportadas (código ISO 4217) con etiqueta legible.
export const MONEDAS: { value: string; label: string }[] = [
  { value: "USD", label: "USD ($)" },
  { value: "EUR", label: "EUR (€)" },
  { value: "MXN", label: "MXN (peso mexicano)" },
  { value: "COP", label: "COP (peso colombiano)" },
  { value: "ARS", label: "ARS (peso argentino)" },
  { value: "CLP", label: "CLP (peso chileno)" },
  { value: "PEN", label: "PEN (sol)" },
  { value: "GBP", label: "GBP (£)" },
  { value: "BRL", label: "BRL (real)" },
  { value: "DOP", label: "DOP (peso dominicano)" },
];

// Formatea un precio con su moneda (símbolo y separadores correctos vía Intl).
export function formatPrecio(precio: string | number, moneda?: string): string {
  const n = Number(precio);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: moneda || "USD" }).format(n);
  } catch {
    return `${moneda || "USD"} ${n.toFixed(2)}`;
  }
}

export interface Slot {
  inicio: string;
  fin: string;
}

export interface Reserva {
  id: number;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  estadoCita: string;
  pagoReservaStatus: string;
  codigoValidacion: string;
  peluqueroId: number;
  servicioId: number;
  peluquero: string;
  servicio: string;
  precio: string | number;
  moneda?: string;
  whatsappUrl: string | null;
}
