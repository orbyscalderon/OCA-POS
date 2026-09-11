import os from "node:os";

// IP de este equipo en la red local (WiFi/LAN) — para que la app de escritorio pueda armar un
// link que otros dispositivos en la MISMA red sí puedan abrir (127.0.0.1 solo funciona en esta
// PC). Toma la primera IPv4 no interna que encuentre.
export function obtenerIpLocal(): string | null {
  const interfaces = os.networkInterfaces();
  for (const nombre of Object.keys(interfaces)) {
    for (const info of interfaces[nombre] ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}
