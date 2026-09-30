import { getLogger } from "@aop/infra";
import { createApp } from "./app.ts";
import { runStartupCheckpointCleanup } from "./chat-session/checkpoint-cleanup-service.ts";
import { shutdownChatSessions } from "./chat-session/service.ts";
import {
  getAllowedOrigins,
  getBindHost,
  getDashboardDevOrigin,
  getDashboardStaticPath,
  getPort,
} from "./config.ts";
import { createCommandContext } from "./context.ts";
import { createDatabase, getDefaultDbPath } from "./db/connection.ts";
import { runMigrations } from "./db/migrations.ts";
import { createProjectServices } from "./project/services.ts";
import { cleanupOrphanRepoDirs } from "./repo/orphan-dirs.ts";
import { startThreadMaintenance } from "./thread/lifecycle.ts";

const logger = getLogger("local-server");

export interface ServerOptions {
  port?: number;
  dbPath?: string;
  dashboardStaticPath?: string;
}

export interface ServerHandle {
  shutdown: () => Promise<void>;
}

export const startServer = async (options?: ServerOptions): Promise<ServerHandle> => {
  const port = options?.port ?? getPort();
  const bindHost = getBindHost();
  const allowedOrigins = getAllowedOrigins();
  const startTimeMs = Date.now();

  const dbPath = options?.dbPath ?? process.env.AOP_DB_PATH ?? getDefaultDbPath();
  const db = createDatabase(dbPath);
  await runMigrations(db);
  const ctx = createCommandContext(db);

  // Retry hidden-ref cleanup before serving so a crash never leaves orphan refs.
  await runStartupCheckpointCleanup(ctx.chatCheckpointCleanupRepository);

  await cleanupOrphanRepoDirs(ctx).catch((error) => {
    logger.warn("Failed to clean orphan repo directories: {error}", { error: String(error) });
  });

  const projectServices = createProjectServices(ctx);
  const app = createApp({
    ctx,
    projectServices,
    startTimeMs,
    dashboardStaticPath: options?.dashboardStaticPath ?? getDashboardStaticPath(),
    dashboardDevOrigin: getDashboardDevOrigin(),
    allowedOrigins,
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      fetch: app.fetch,
      port,
      hostname: bindHost,
      // Bun max is 255s. Chat replies stream over SSE and no longer hold HTTP open,
      // but SSE heartbeats are 15s and other long endpoints still need headroom.
      idleTimeout: 255,
    });
  } catch (err) {
    await db.destroy();
    const message =
      err instanceof Error && err.message.includes("EADDRINUSE")
        ? `Port ${port} is already in use`
        : `Failed to start server: ${err}`;
    throw new Error(message);
  }

  logger.info("Local server listening on http://{bindHost}:{port}", { bindHost, port });
  // Threads left landing by a restart are settled, and threads idle for a week are resolved.
  const stopMaintenance = startThreadMaintenance(projectServices.git);

  return {
    shutdown: async () => {
      logger.info("Shutting down...");
      stopMaintenance();
      server.stop();
      await shutdownChatSessions(ctx);
      await db.destroy();
      logger.info("Shutdown complete");
    },
  };
};
