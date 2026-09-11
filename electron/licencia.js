// Verificación OFFLINE del certificado de licencia. La clave privada que firma estos
// certificados vive solo en el backend de la nube (env LICENSE_SIGNING_PRIVATE_KEY) — acá
// solo está la clave pública correspondiente, que sirve para verificar pero no para firmar.
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAMNdk/kUqrJXUN2n9MvU0RsrzR+wlvBasr0fFXA56Wd4=
-----END PUBLIC KEY-----`;

// Días de gracia sin conexión antes de exigir revalidar online. No aplica al plan vitalicio
// (vencimiento null = nunca vence).
const DIAS_GRACIA = 14;

function rutaLicencia(userDataDir) {
  return path.join(userDataDir, "license.json");
}

function getOrCreateMachineId(userDataDir) {
  const p = path.join(userDataDir, "machine-id.json");
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")).id;
  const id = crypto.randomUUID();
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ id }));
  return id;
}

function verificarFirma(payload, firma) {
  try {
    const publicKey = crypto.createPublicKey(PUBLIC_KEY_PEM);
    const datos = Buffer.from(JSON.stringify(payload));
    return crypto.verify(null, datos, publicKey, Buffer.from(firma, "base64"));
  } catch {
    return false;
  }
}

// Guarda un certificado recién recibido del backend si su firma y huella son válidas.
function guardarSiValido(userDataDir, certificado, huellaEsperada) {
  const { payload, firma } = certificado || {};
  if (!payload || !firma) return { ok: false, error: "Respuesta del servidor incompleta" };
  if (!verificarFirma(payload, firma)) return { ok: false, error: "Certificado con firma inválida" };
  if (payload.huellaMaquina !== huellaEsperada) return { ok: false, error: "Certificado no corresponde a esta instalación" };
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(rutaLicencia(userDataDir), JSON.stringify(certificado));
  return { ok: true, payload };
}

// Lee y valida la licencia guardada localmente (firma + huella + vencimiento con gracia).
// No necesita internet — esto es lo que permite que la app arranque sin conexión.
function cargarLicenciaValida(userDataDir, huellaEsperada) {
  const p = rutaLicencia(userDataDir);
  if (!fs.existsSync(p)) return null;
  let certificado;
  try {
    certificado = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  const { payload, firma } = certificado;
  if (!verificarFirma(payload, firma)) return null;
  if (payload.huellaMaquina !== huellaEsperada) return null;
  if (payload.vencimiento) {
    const limite = new Date(payload.vencimiento).getTime() + DIAS_GRACIA * 24 * 60 * 60 * 1000;
    if (Date.now() > limite) return null;
  }
  return payload;
}

module.exports = { getOrCreateMachineId, guardarSiValido, cargarLicenciaValida, rutaLicencia };
