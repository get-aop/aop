#!/usr/bin/env bun

import { mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { registerCommands, setupLogging } from "@aop/cli/commands";
import { configureLogging, getLogger } from "@aop/infra";
import { startServer } from "@aop/local-server/server";
import cac from "cac";
import { isSystemdUserServiceActive, stopSystemdUserService } from "./systemd.ts";

declare const BUILD_VERSION: string;

const logger = getLogger("entrypoint");

const AOP_DIR = join(homedir(), ".aop");
const PID_FILE = join(AOP_DIR, "server.pid");
const LOG_DIR = join(AOP_DIR, "logs");
const DEFAULT_LOCAL_SERVER_PORT = "25150";
const DEFAULT_DASHBOARD_PORT = "25160";

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

const spawnSystemctl = (command: string[]): { exitCode: number | null } =>
  Bun.spawnSync(command, { stdout: "ignore", stderr: "ignore" });

const cli = cac("aop");

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

    await startServer({
      port,
      dashboardStaticPath: dashboardPath,
    });
  });

cli.command("stop", "Stop the local server").action(async () => {
  // `aop run` under the systemd unit never writes a PID file, so the PID-file stop
  // below would silently do nothing. Stop the unit when it manages this server; the
  // unit teardown also reaps server child processes.
  if (process.platform === "linux") {
    try {
      if (isSystemdUserServiceActive(spawnSystemctl)) {
        if (stopSystemdUserService(spawnSystemctl)) {
          logger.info("Stopped the AOP local server systemd unit");
          process.exit(0);
        }
        logger.error("Failed to stop the AOP local server systemd unit");
        process.exit(1);
      }
    } catch {
      // No systemd user session; fall back to the PID-file stop below.
    }
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
