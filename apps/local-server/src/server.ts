import { DESKTOP_APP_ORIGIN } from "@aop/common";
import { getLogger } from "@aop/infra";
import { createHostAgentCliService } from "./agent-cli/host-agent-cli-service.ts";
import { createApp } from "./app.ts";
import { runStartupCheckpointCleanup } from "./chat-session/checkpoint-cleanup-service.ts";
import { shutdownChatSessions } from "./chat-session/service.ts";
import { hostCua, stopHostCua } from "./computer-use/host-gate.ts";
import { upgradePinnedDriver } from "./computer-use/setup/auto-upgrade.ts";
import { hostSystem } from "./computer-use/setup/system.ts";
import {
  getAllowedOrigins,
  getBindHost,
  getDashboardDevOrigin,
  getDashboardStaticPath,
  getPort,
  getPullRequestPollIntervalMs,
} from "./config.ts";
import { createCommandContext } from "./context.ts";
import { createDatabase, getDefaultDbPath } from "./db/connection.ts";
import { runMigrations } from "./db/migrations.ts";
import { inboxDbPath, openInboxDatabase } from "./inbox/database.ts";
import { createHostInboxService } from "./inbox/host-inbox-service.ts";
import { startInboxRetention } from "./inbox/retention.ts";
import { runLibraryRetention, startLibraryRetention } from "./library/retention.ts";
import { createProjectServices } from "./project/services.ts";
import { startPullRequestWatcher } from "./pull-request-watch/watcher.ts";
import { cleanupOrphanRepoDirs } from "./repo/orphan-dirs.ts";
import { startThreadMaintenance } from "./thread/lifecycle.ts";
import { createHostUpdateService } from "./update/host-update-service.ts";

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
  // The desktop app is a first-class client: it needs no entry in AOP_ALLOWED_ORIGINS.
  const allowedOrigins = [DESKTOP_APP_ORIGIN, ...getAllowedOrigins()];
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

  const pollIntervalMs = getPullRequestPollIntervalMs();
  const projectServices = createProjectServices(
    ctx,
    {},
    {},
    { timing: pollIntervalMs ? { activeMs: pollIntervalMs, quietMs: pollIntervalMs } : {} },
  );
  const updates = createHostUpdateService(ctx);
  const agentClis = createHostAgentCliService(ctx);
  const inboxDb = openInboxDatabase(dbPath === ":memory:" ? ":memory:" : inboxDbPath());
  const inbox = createHostInboxService(ctx, inboxDb);
  const app = createApp({
    ctx,
    projectServices,
    updates,
    agentClis,
    inbox,
    startTimeMs,
    port,
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
    await inboxDb.destroy();
    const message =
      err instanceof Error && err.message.includes("EADDRINUSE")
        ? `Port ${port} is already in use`
        : `Failed to start server: ${err}`;
    throw new Error(message);
  }

  logger.info("Local server listening on http://{bindHost}:{port}", { bindHost, port });
  // Threads left landing by a restart are settled, and threads idle for a week are resolved.
  const stopMaintenance = startThreadMaintenance(projectServices.git);
  // Open pull requests are watched for their checks and reviews, and answered with fix prompts.
  const stopWatcher = startPullRequestWatcher(projectServices.pullRequestWatcher, pollIntervalMs);
  // Once a day the host looks for a newer release, unless the person turned that off.
  updates.start();
  // Shortly after boot and then every `agent_cli_check_interval_minutes`, the agent CLIs are
  // checked for newer versions (and updated, when the person turned that on).
  agentClis.start();
  // A host update can pin a newer CUA Driver: an installed older one is brought up to it, once
  // no thread holds computer use (the host holds the lease for the swap).
  void upgradePinnedDriver(hostSystem(), () => hostCua().lease);
  // Routines fire when they come due; runs a stopped host left half-started are failed first.
  await projectServices.routineScheduler.start();
  // Once a day the Library removes what outlived its retention or its caps.
  const stopLibraryRetention = startLibraryRetention(() => runLibraryRetention(ctx));
  // Every hour the Inbox forgets the Slack messages that outlived its retention.
  const stopInboxRetention = startInboxRetention(inbox);
  // A project created just before a restart may not have started its survey yet.
  void projectServices.kickoff.resumePending();

  return {
    shutdown: async () => {
      logger.info("Shutting down...");
      stopMaintenance();
      await projectServices.routineScheduler.stop();
      stopLibraryRetention();
      stopInboxRetention();
      updates.stop();
      agentClis.stop();
      await stopWatcher();
      server.stop();
      await shutdownChatSessions(ctx);
      // Every run has stopped, so no thread uses the screen: drivers and the lock dir go.
      await stopHostCua();
      await db.destroy();
      await inboxDb.destroy();
      logger.info("Shutdown complete");
    },
  };
};
