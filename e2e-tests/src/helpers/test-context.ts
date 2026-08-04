import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Subprocess } from "bun";
import {
  DASHBOARD_DEV_BIN,
  DASHBOARD_DEV_CWD,
  DASHBOARD_PORT_RANGE,
  E2E_TEST_HOME_DIR,
  LOCAL_SERVER_PORT_RANGE,
} from "./constants";
import { type LocalServerContext, startLocalServer, stopLocalServer } from "./local-server";

export interface DashboardContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface TestContext {
  localServerPort: number;
  localServerUrl: string;
  localServer: LocalServerContext;
  dashboardPort: number;
  dashboardUrl: string;
  dashboard: DashboardContext;
  dbPath: string;
  baseDir: string;
  reposDir: string;
  env: Record<string, string>;
}

export interface CreateTestContextOptions {
  localServerEnv?: Record<string, string>;
}

export const resolveE2EAgentProvider = (): string =>
  process.env.AOP_E2E_AGENT_PROVIDER?.trim() || "e2e-fixture";

export const findFreePort = async (rangeStart: number, rangeEnd: number): Promise<number> => {
  for (const port of buildPortProbeSequence(rangeStart, rangeEnd)) {
    try {
      const available = await isPortFree(port);
      if (available) return port;
    } catch (error) {
      const code = getErrorCode(error);
      if (code === "EPERM" || code === "EACCES") {
        throw new Error(
          `Port probing is blocked by the current environment for range ${rangeStart}-${rangeEnd} (received ${code} while probing localhost ports)`,
          { cause: error },
        );
      }

      throw error;
    }
  }

  throw new Error(
    `No free port in range ${rangeStart}-${rangeEnd} — are too many test runs active?`,
  );
};

const isPortFree = async (port: number): Promise<boolean> => {
  try {
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: {
        data() {},
      },
    });
    listener.stop(true);
    return true;
  } catch (error) {
    if (getErrorCode(error) === "EADDRINUSE") {
      return false;
    }

    throw error;
  }
};

const buildPortProbeSequence = (rangeStart: number, rangeEnd: number): number[] => {
  const range = rangeEnd - rangeStart + 1;
  const startOffset = Math.floor(Math.random() * range);
  const ports: number[] = [];

  for (let offset = 0; offset < range; offset++) {
    ports.push(rangeStart + ((startOffset + offset) % range));
  }

  return ports;
};

const getErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  const { code } = error as { code?: unknown };
  if (typeof code !== "string") {
    return undefined;
  }

  return code;
};

const startDashboardDev = async (
  port: number,
  localServerUrl: string,
): Promise<DashboardContext> => {
  const url = `http://localhost:${port}`;

  const proc = Bun.spawn({
    cmd: [process.execPath, DASHBOARD_DEV_BIN],
    cwd: DASHBOARD_DEV_CWD,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      AOP_DASHBOARD_PORT: String(port),
      AOP_DASHBOARD_URL: url,
      AOP_LOCAL_SERVER_URL: localServerUrl,
    },
  });
  discardProcessOutput(proc);

  const healthy = await waitForHealth(url, "/", 15_000);
  if (!healthy) {
    proc.kill();
    throw new Error(`Dashboard dev server failed to start at ${url}`);
  }

  return { process: proc, port, url };
};

const stopDashboardDev = async (ctx: DashboardContext): Promise<void> => {
  ctx.process.kill("SIGTERM");
  await ctx.process.exited;
};

const discardProcessOutput = (proc: Subprocess): void => {
  // Long-lived E2E services can block if their output pipes fill before teardown.
  discardStream(proc.stdout);
  discardStream(proc.stderr);
};

const discardStream = (stream: Subprocess["stdout"]): void => {
  if (!(stream instanceof ReadableStream)) return;
  void new Response(stream).arrayBuffer().catch(() => {});
};

const waitForHealth = async (baseUrl: string, path: string, timeout: number): Promise<boolean> => {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    try {
      const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await Bun.sleep(200);
  }
  return false;
};

export const createTestContext = async (
  testFilename: string,
  options: CreateTestContextOptions = {},
): Promise<TestContext> => {
  const baseDir = join(E2E_TEST_HOME_DIR, testFilename);
  const reposDir = join(baseDir, "repos");
  const worktreesDir = join(baseDir, "worktrees");
  const aopHome = join(baseDir, "aop-home");
  const dbPath = join(baseDir, "aop.db");

  await rm(baseDir, { recursive: true, force: true });
  await mkdir(reposDir, { recursive: true });
  await mkdir(worktreesDir, { recursive: true });

  const localServerPort = await findFreePort(
    LOCAL_SERVER_PORT_RANGE.min,
    LOCAL_SERVER_PORT_RANGE.max,
  );
  const localServerUrl = `http://localhost:${localServerPort}`;
  const dashboardPort = await findFreePort(DASHBOARD_PORT_RANGE.min, DASHBOARD_PORT_RANGE.max);
  const dashboardUrl = `http://localhost:${dashboardPort}`;

  const localServer = await startLocalServer({
    port: localServerPort,
    dbPath,
    env: {
      AOP_TEST_MODE: "true",
      AOP_HOME: aopHome,
      AOP_LOCAL_SERVER_URL: localServerUrl,
      AOP_DASHBOARD_URL: dashboardUrl,
      ...options.localServerEnv,
    },
  });

  await enableLegacyRepoTaskDiscovery(localServerUrl);

  const dashboard = await startDashboardDev(dashboardPort, localServerUrl);

  const env: Record<string, string> = {
    ...process.env,
    AOP_HOME: aopHome,
    AOP_LOCAL_SERVER_PORT: String(localServerPort),
    AOP_LOCAL_SERVER_URL: localServerUrl,
    AOP_DB_PATH: dbPath,
  };

  return {
    localServerPort,
    localServerUrl,
    localServer,
    dashboardPort,
    dashboardUrl,
    dashboard,
    dbPath,
    baseDir,
    reposDir,
    env,
  };
};

const enableLegacyRepoTaskDiscovery = async (localServerUrl: string): Promise<void> => {
  const response = await fetch(`${localServerUrl}/api/settings/discover_legacy_repo_tasks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "true" }),
  });

  if (!response.ok) {
    throw new Error(`Failed to enable legacy repo task discovery (${response.status})`);
  }
};

export const destroyTestContext = async (ctx?: Partial<TestContext>): Promise<void> => {
  if (ctx?.dashboard) {
    await stopDashboardDev(ctx.dashboard);
  }

  if (ctx?.localServer) {
    await stopLocalServer(ctx.localServer);
  }
};
