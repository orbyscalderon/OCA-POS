// Proceso principal de Electron: levanta un Postgres embebido (PGlite), arranca el backend
// real de OCA POS (backend/dist/server.js, sin ningún cambio de código) apuntando a esa base
// local, y abre una ventana que carga el frontend servido por ese mismo backend.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { PGlite } = require("@electric-sql/pglite");
const { PGLiteSocketServer } = require("@electric-sql/pglite-socket");

const PG_PORT = 55432;
const BACKEND_PORT = 4010;

const userDataDir = app.getPath("userData");
const pgDataDir = path.join(userDataDir, "pgdata");
const uploadsDir = path.join(userDataDir, "uploads");
const secretFile = path.join(userDataDir, "secret.json");

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

async function startEmbeddedPostgres() {
  fs.mkdirSync(pgDataDir, { recursive: true });
  db = new PGlite(pgDataDir);
  await db.waitReady;

  const check = await db.query("SELECT to_regclass('public.usuarios') as t");
  const yaInicializado = check.rows[0]?.t !== null;

  if (!yaInicializado) {
    console.log("[oca-pos] Primera vez: aplicando el esquema de la base de datos...");
    const dirs = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      const sqlPath = path.join(migrationsDir, dir, "migration.sql");
      if (!fs.existsSync(sqlPath)) continue;
      await db.exec(fs.readFileSync(sqlPath, "utf8"));
    }
    console.log(`[oca-pos] Esquema aplicado (${dirs.length} migraciones).`);
  }

  socketServer = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1" });
  await socketServer.start();
  console.log("[oca-pos] Postgres embebido escuchando en 127.0.0.1:" + PG_PORT);
}

function startBackend() {
  const dbUrl = `postgresql://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`;
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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startEmbeddedPostgres();
    startBackend();
    await esperarBackend();
    createWindow();
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
