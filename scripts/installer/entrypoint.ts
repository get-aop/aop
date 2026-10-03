#!/usr/bin/env bun

import { mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { registerCommands, setupLogging } from "@aop/cli/commands";
import { buildChannel } from "@aop/common";
import { configureLogging, getLogger } from "@aop/infra";
import { startServer } from "@aop/local-server/server";
import { runUpdate } from "@aop/local-server/update";
import cac from "cac";
import { stopRunningService } from "./service.ts";

declare const BUILD_VERSION: string;

const logger = getLogger("entrypoint");

// The channel this binary was built for decides its data folder and ports, so AOP Nightly
// (`aop-nightly`) runs beside a stable `aop` without sharing either.
const CHANNEL = buildChannel();
const AOP_DIR = join(homedir(), CHANNEL.homeDirName);
const PID_FILE = join(AOP_DIR, "server.pid");
const LOG_DIR = join(AOP_DIR, "logs");
const DEFAULT_LOCAL_SERVER_PORT = String(CHANNEL.hostPort);
const DEFAULT_DASHBOARD_PORT = String(CHANNEL.dashboardPort);

const ensureAopDir = async (): Promise<void> => {
  await mkdir(AOP_DIR, { recursive: true });
};

const writePidFile = async (pid: number): Promise<void> => {
  await ensureAopDir();
  await Bun.write(PID_FILE, String(pid));
};

const readPidFile = async (): Promise<number | null> => {
  const file = Bun.file(PID_FILE);
  if (!(await file.exists())) return null;
  const content = await file.text();
  const pid = Number.parseInt(content.trim(), 10);
  return Number.isNaN(pid) ? null : pid;
};

const removePidFile = async (): Promise<void> => {
  try {
    await unlink(PID_FILE);
  } catch {
    // PID file already gone
  }
};

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const resolveDashboardPath = async (): Promise<string | undefined> => {
  const embedded = join(dirname(process.execPath), "dashboard");
  const exists = await Bun.file(join(embedded, "index.html")).exists();
  return exists ? embedded : undefined;
};

const waitForBackgroundStart = async (proc: Bun.Subprocess): Promise<boolean> => {
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
  ]);

  return exitCode === null;
};

const configureRuntimeEnvironment = (port?: string): number => {
  const localServerPort = port ?? process.env.AOP_LOCAL_SERVER_PORT ?? DEFAULT_LOCAL_SERVER_PORT;
  const dashboardPort = process.env.AOP_DASHBOARD_PORT ?? DEFAULT_DASHBOARD_PORT;

  process.env.AOP_LOG_DIR ??= LOG_DIR;
  process.env.AOP_LOCAL_SERVER_PORT = localServerPort;
  process.env.AOP_DASHBOARD_PORT = dashboardPort;
  process.env.AOP_LOCAL_SERVER_URL ??= `http://localhost:${localServerPort}`;
  process.env.AOP_DASHBOARD_URL ??= `http://localhost:${dashboardPort}`;
  process.env.NODE_ENV ??= "production";

  return Number.parseInt(localServerPort, 10);
};

const spawnQuietly = (command: string[]): { exitCode: number | null } =>
  Bun.spawnSync(command, { stdout: "ignore", stderr: "ignore" });

/** No launchctl or no systemd user session: there is no service, so fall back to the PID file. */
const stopRunningServiceSafely = (): ReturnType<typeof stopRunningService> => {
  try {
    return stopRunningService({ platform: process.platform, spawnSync: spawnQuietly });
  } catch {
    return { kind: "none" };
  }
};

const cli = cac(CHANNEL.binaryName);

cli
  .command("run", "Start the local server")
  .option("--background", "Run in background")
  .option("--port <port>", "Port to listen on")
  .action(async (options: { background?: boolean; port?: string }) => {
    const port = configureRuntimeEnvironment(options.port);

    if (options.background) {
      await ensureAopDir();
      const proc = Bun.spawn([process.execPath, "run"], {
        stdio: ["ignore", "ignore", "ignore"],
        env: process.env,
      });
      proc.unref();
      if (!(await waitForBackgroundStart(proc))) {
        logger.error("Server failed to start in background");
        process.exit(1);
      }
      await writePidFile(proc.pid);
      logger.info("Server started in background (PID: {pid})", { pid: proc.pid });
      process.exit(0);
    }

    await setupLogging();

    const dashboardPath = await resolveDashboardPath();

    if (typeof BUILD_VERSION !== "undefined") {
      process.env.AOP_BUILD_VERSION = BUILD_VERSION;
    }

    // No SIGTERM handler, on purpose: launchd, systemd and `aop update` stop the host with
    // SIGTERM, and the default action ends it at once, like a crash. The agent runs are detached
    // processes, so they keep working and the next host picks them up (chat-session recovery).
    // The graceful shutdown in local-server/src/run.ts stops every run, which a restart for an
    // update must not do.
    await startServer({
      port,
      dashboardStaticPath: dashboardPath,
    });
  });

cli
  .command("update", "Update this host to the newest published release")
  .option("--check", "Only report whether a newer release is published")
  .action(async (options: { check?: boolean }) => {
    const exitCode = await runUpdate({
      buildVersion: typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : undefined,
      execPath: process.execPath,
      checkOnly: Boolean(options.check),
      print: (line) => process.stdout.write(`${line}\n`),
    });
    process.exit(exitCode);
  });

cli.command("stop", "Stop the local server").action(async () => {
  // A host run by launchd or systemd never writes the PID file below, and launchd would start a
  // killed one again: stop this channel's service through its manager first.
  const service = stopRunningServiceSafely();
  if (service.kind === "stopped") {
    logger.info("Stopped the {service} service", { service: service.service });
    process.exit(0);
  }
  if (service.kind === "failed") {
    logger.error("Failed to stop the {service} service", { service: service.service });
    process.exit(1);
  }

  const pid = await readPidFile();

  if (pid === null) {
    logger.info("No server PID file found. Is the server running?");
    process.exit(0);
  }

  if (!isProcessRunning(pid)) {
    logger.info("Server process (PID: {pid}) is not running. Cleaning up PID file.", { pid });
    await removePidFile();
    process.exit(0);
  }

  process.kill(pid, "SIGTERM");
  await removePidFile();
  logger.info("Server stopped (PID: {pid})", { pid });
});

registerCommands(cli);

cli.help();
cli.version(typeof BUILD_VERSION !== "undefined" ? BUILD_VERSION : "dev");

await configureLogging({ level: "info", format: "pretty" });
cli.parse();
