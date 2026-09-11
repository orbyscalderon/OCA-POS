// Proceso principal de Electron: levanta un Postgres embebido (PGlite), arranca el backend
// real de OCA POS (backend/dist/server.js, sin ningún cambio de código) apuntando a esa base
// local, y abre una ventana que carga el frontend servido por ese mismo backend.
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { PGlite } = require("@electric-sql/pglite");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");
const tar = require("tar");
const licencia = require("./licencia.js");

const PG_PORT = 55432;
const BACKEND_PORT = 4010;
// URL del backend en la nube contra el que se activan las licencias. OJO: hay que confirmar
// que coincida con el backend real desplegado antes de vender licencias — si no, la
// activación siempre va a fallar.
const CLOUD_API_URL = process.env.OCAPOS_LICENSE_API_URL || "https://turno-api.up.railway.app";

const userDataDir = app.getPath("userData");
const pgDataDir = path.join(userDataDir, "pgdata");
const uploadsDir = path.join(userDataDir, "uploads");
const secretFile = path.join(userDataDir, "secret.json");
const huellaMaquina = licencia.getOrCreateMachineId(userDataDir);

const isDev = !app.isPackaged;
const backendServerPath = isDev
  ? path.join(__dirname, "..", "backend", "dist", "server.js")
  : path.join(process.resourcesPath, "backend-dist", "server.js");
const migrationsDir = isDev
  ? path.join(__dirname, "..", "backend", "prisma", "migrations")
  : path.join(process.resourcesPath, "backend-dist", "prisma", "migrations");
const frontendDistDir = isDev
  ? path.join(__dirname, "..", "frontend", "dist")
  : path.join(process.resourcesPath, "frontend-dist");

let db, socketServer, backendProcess, mainWindow;

// El JWT_SECRET se genera una sola vez por instalación y se guarda localmente,
// así las sesiones sobreviven a reinicios de la app.
function getOrCreateJwtSecret() {
  if (fs.existsSync(secretFile)) {
    return JSON.parse(fs.readFileSync(secretFile, "utf8")).jwtSecret;
  }
  const jwtSecret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(secretFile, JSON.stringify({ jwtSecret }));
  return jwtSecret;
}

// Aplica las migraciones que todavía no corrieron en ESTA instalación. No alcanza con
// preguntar "¿existe la tabla usuarios?" una sola vez al principio: una instalación ya
// inicializada que recibe una actualización de la app con migraciones nuevas (como el PIN de
// Contabilidad, agregado después del primer lanzamiento) se quedaba con el esquema viejo para
// siempre, y cada endpoint que tocara la columna nueva fallaba con "column does not exist".
// Se lleva registro de qué migración ya corrió en una tabla propia, igual que Prisma lo hace
// con _prisma_migrations, así en cada arranque solo se aplican las que faltan.
async function aplicarMigracionesPendientes() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS _oca_migraciones (
      nombre TEXT PRIMARY KEY,
      aplicada_en TIMESTAMP NOT NULL DEFAULT now()
    );
  `);
  const aplicadas = new Set(
    (await db.query("SELECT nombre FROM _oca_migraciones")).rows.map((r) => r.nombre),
  );

  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let aplicadasAhora = 0;
  for (const dir of dirs) {
    if (aplicadas.has(dir)) continue;
    const sqlPath = path.join(migrationsDir, dir, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    try {
      await db.exec(fs.readFileSync(sqlPath, "utf8"));
    } catch (err) {
      // Instalaciones que ya existían antes de que se agregara esta tabla de seguimiento
      // (o una migración a medio aplicar por un cierre abrupto) pueden pisar algo que ya
      // está — si el motor dice "ya existe", se toma como aplicada y se sigue, en vez de
      // tirar abajo el arranque entero de la app.
      if (!/already exists/i.test(String(err?.message))) throw err;
    }
    await db.query("INSERT INTO _oca_migraciones (nombre) VALUES ($1)", [dir]);
    aplicadasAhora++;
  }
  if (aplicadasAhora > 0) {
    console.log(`[oca-pos] Esquema al día: ${aplicadasAhora} migración(es) nueva(s) aplicada(s) (${dirs.length} en total).`);
  }
}

async function startEmbeddedPostgres() {
  fs.mkdirSync(pgDataDir, { recursive: true });
  db = new PGlite(pgDataDir);
  await db.waitReady;

  await aplicarMigracionesPendientes();

  socketServer = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1" });
  await socketServer.start();
  console.log("[oca-pos] Postgres embebido escuchando en 127.0.0.1:" + PG_PORT);
}

function startBackend() {
  // connection_limit=1: PGlite es un único motor embebido, no soporta varias conexiones
  // concurrentes de verdad — con el pool por defecto de Prisma, dos queries en paralelo
  // (Promise.all) pueden fallar con "Can't reach database server". Con una sola conexión,
  // Prisma serializa las queries en vez de abrir varias al mismo tiempo.
  const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable&connection_limit=1`;
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Se ejecuta con el propio Node embebido de Electron (ELECTRON_RUN_AS_NODE), así no
  // hace falta que la PC del cliente tenga Node.js instalado.
  backendProcess = spawn(process.execPath, [backendServerPath], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT: String(BACKEND_PORT),
      NODE_ENV: "production",
      DATABASE_URL: dbUrl,
      DIRECT_URL: dbUrl,
      JWT_SECRET: getOrCreateJwtSecret(),
      DESKTOP_MODE: "true",
      FRONTEND_ORIGIN: `http://127.0.0.1:${BACKEND_PORT}`,
      APP_URL: `http://127.0.0.1:${BACKEND_PORT}`,
      FRONTEND_DIST_DIR: frontendDistDir,
      UPLOAD_DIR: uploadsDir,
      PAYMENT_PROVIDER: "mock",
      EMAIL_TRANSPORT: "dev",
      WHATSAPP_PROVIDER: "deeplink",
    },
    stdio: "inherit",
  });
  backendProcess.on("exit", (code) => {
    console.log("[oca-pos] el backend terminó con código", code);
  });
}

async function esperarBackend() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // todavía no arranca, reintentar
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("El backend no respondió a tiempo");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, "preload.js") },
  });
  mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}`);
}

// ---------- Backup local ----------
// Copia de seguridad: dumpDataDir() de PGlite empaqueta el directorio de datos completo en un
// .tar.gz — no hace falta un pg_dump aparte. Vive en el proceso main (acá está la instancia de
// `db`), por eso se expone por IPC en vez de un endpoint del backend (que corre en otro proceso
// y solo habla con la base por el socket, no tiene el objeto PGlite).
ipcMain.handle("crear-backup", async () => {
  try {
    const fecha = new Date().toISOString().replace(/[:.]/g, "-");
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Guardar copia de seguridad",
      defaultPath: `oca-pos-backup-${fecha}.tar.gz`,
      filters: [{ name: "Copia de seguridad OCA POS", extensions: ["gz"] }],
    });
    if (canceled || !filePath) return { ok: false, cancelado: true };
    const archivo = await db.dumpDataDir("gzip");
    const buffer = Buffer.from(await archivo.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return { ok: true, path: filePath };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// Restaurar: se extrae primero a una carpeta temporal y se valida (¿tiene PG_VERSION?) antes de
// tocar nada — si el archivo está corrupto o no es una copia de OCA POS, falla ahí sin haber
// arriesgado los datos actuales. La carpeta vieja no se borra, se renombra como respaldo por si
// algo sale mal. Como hay que cerrar la base y el backend para reemplazar los archivos, se
// relanza la app entera al final en vez de tratar de "revivir" todo en caliente.
ipcMain.handle("restaurar-backup", async () => {
  try {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "Elegir copia de seguridad a restaurar",
      properties: ["openFile"],
      filters: [{ name: "Copia de seguridad OCA POS", extensions: ["gz", "tar"] }],
    });
    if (canceled || !filePaths[0]) return { ok: false, cancelado: true };
    const origen = filePaths[0];

    const confirmacion = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Cancelar", "Sí, reemplazar todo"],
      defaultId: 0,
      cancelId: 0,
      title: "Restaurar copia de seguridad",
      message:
        "Esto reemplaza TODOS los datos actuales (productos, ventas, clientes) por los de la copia elegida. Esta acción no se puede deshacer. ¿Continuar?",
    });
    if (confirmacion.response !== 1) return { ok: false, cancelado: true };

    const tempDir = path.join(app.getPath("temp"), `oca-pos-restore-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    await tar.x({ file: origen, cwd: tempDir });
    if (!fs.existsSync(path.join(tempDir, "PG_VERSION"))) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return { ok: false, error: "El archivo elegido no es una copia de seguridad válida de OCA POS" };
    }

    backendProcess?.kill();
    await socketServer?.stop().catch(() => {});
    await db?.close().catch(() => {});

    const respaldoPrevio = `${pgDataDir}.antes-de-restaurar-${Date.now()}`;
    fs.renameSync(pgDataDir, respaldoPrevio);
    fs.renameSync(tempDir, pgDataDir);

    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

// Llama al backend de la nube para activar/revalidar la licencia. Solo hace falta internet
// para esta llamada puntual — el resultado firmado queda guardado localmente y desde ahí
// la app arranca offline (ver licencia.cargarLicenciaValida).
async function activarContraNube(clave) {
  const res = await fetch(`${CLOUD_API_URL}/api/licencias/activar`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clave, huellaMaquina }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.error || "No se pudo activar la licencia" };
  return licencia.guardarSiValido(userDataDir, data, huellaMaquina);
}

ipcMain.handle("activar-licencia", async (_e, clave) => {
  try {
    return await activarContraNube(String(clave || "").trim());
  } catch (err) {
    return { ok: false, error: "Sin conexión con el servidor de licencias. Probá de nuevo." };
  }
});

// Revalidación en segundo plano, sin bloquear el arranque: si el negocio renovó, o le
// agregaron una función paga nueva, o cambió el vencimiento, esto lo actualiza la próxima
// vez que haya internet. Si falla (sin conexión), no pasa nada — se sigue usando lo cacheado.
function revalidarEnSegundoPlano(clave) {
  activarContraNube(clave).catch(() => {});
}

// Ventana de activación: se muestra sola, bloqueando el resto del arranque, hasta que el
// usuario ingresa una clave válida.
function mostrarActivacion() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 420,
      height: 320,
      resizable: false,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, "preload-activation.js"),
      },
    });
    win.loadFile(path.join(__dirname, "activation.html"));
    win.on("closed", () => reject(new Error("Activación cancelada")));

    const revisar = setInterval(() => {
      const valida = licencia.cargarLicenciaValida(userDataDir, huellaMaquina);
      if (valida) {
        clearInterval(revisar);
        win.removeAllListeners("closed");
        win.close();
        resolve(valida);
      }
    }, 400);
  });
}

app.whenReady().then(async () => {
  try {
    let licenciaValida = licencia.cargarLicenciaValida(userDataDir, huellaMaquina);
    if (!licenciaValida) {
      licenciaValida = await mostrarActivacion();
    }
    await startEmbeddedPostgres();
    startBackend();
    await esperarBackend();
    createWindow();
    revalidarEnSegundoPlano(licenciaValida.clave);
  } catch (err) {
    console.error("[oca-pos] Error al iniciar la app:", err);
    app.quit();
  }
});

app.on("window-all-closed", async () => {
  backendProcess?.kill();
  await socketServer?.stop().catch(() => {});
  await db?.close().catch(() => {});
  app.quit();
});
