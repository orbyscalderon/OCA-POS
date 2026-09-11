import crypto from "node:crypto";
import { env } from "../config/env.js";

// Certificado firmado que la app de escritorio guarda localmente y verifica offline con la
// clave pública embebida en electron/main.js. Ver docs/... (no existe todavía) o el propio
// main.js para el lado que verifica.
export interface CertificadoLicencia {
  clave: string;
  plan: string;
  vencimiento: string | null; // null = vitalicio, sin vencimiento
  funcionesExtra: string[];
  huellaMaquina: string;
  emitidoEn: string;
}

export function firmarCertificado(payload: CertificadoLicencia): { payload: CertificadoLicencia; firma: string } {
  if (!env.licenseSigningPrivateKey) {
    throw new Error("LICENSE_SIGNING_PRIVATE_KEY no está configurada en este servidor");
  }
  const privateKey = crypto.createPrivateKey(env.licenseSigningPrivateKey);
  const datos = Buffer.from(JSON.stringify(payload));
  const firma = crypto.sign(null, datos, privateKey).toString("base64");
  return { payload, firma };
}

// Genera una clave de licencia legible, tipo OCAPOS-XXXX-XXXX-XXXX.
export function generarClaveLicencia(): string {
  const grupo = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `OCAPOS-${grupo()}-${grupo()}-${grupo()}`;
}
