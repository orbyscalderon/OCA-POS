import { PrismaClient, Prisma } from "@prisma/client";

const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

function esErrorDeConexionTransitorio(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code === "P1001";
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  return false;
}

// La app de escritorio corre contra un Postgres embebido (PGlite): un único motor, sin
// concurrencia real. Bajo ráfagas de queries en paralelo (varios componentes pidiendo datos a
// la vez al abrir una pantalla), dejar que Prisma dispare varias conexiones a la vez —aunque
// esté limitado a connection_limit=1 en la URL— igual puede pisarse con el "accept" del
// servidor embebido y fallar con "Can't reach database server". Un reintento simple no
// alcanzaba bajo ráfagas reales (~7 fallos de cada tanda de carga de pantalla).
//
// La solución robusta: una cola en el propio proceso Node que garantiza que nunca hay más de
// una query en vuelo hacia Prisma/PGlite al mismo tiempo, sin depender de la config de pool de
// Prisma. Para un solo cajero en una PC esto no cuesta nada en rendimiento real — sí garantiza
// que nunca se repite la carrera. Contra un Postgres real (nube) este wrapper es transparente:
// ahí las queries son rápidas y nunca fallan por esto, así que la cola casi no se nota.
let cola: Promise<unknown> = Promise.resolve();

async function encolada<T>(fn: () => Promise<T>): Promise<T> {
  const anterior = cola;
  let liberar!: () => void;
  cola = new Promise<void>((resolve) => { liberar = resolve; });
  await anterior;
  try {
    return await fn();
  } finally {
    liberar();
  }
}

const MAX_REINTENTOS = 4;

export const prisma = basePrisma.$extends({
  query: {
    async $allOperations({ args, query }) {
      return encolada(async () => {
        let ultimoError: unknown;
        for (let intento = 0; intento <= MAX_REINTENTOS; intento++) {
          try {
            return await query(args);
          } catch (err) {
            ultimoError = err;
            if (intento < MAX_REINTENTOS && esErrorDeConexionTransitorio(err)) {
              await new Promise((r) => setTimeout(r, 80 * (intento + 1)));
              continue;
            }
            throw err;
          }
        }
        throw ultimoError;
      });
    },
  },
});
