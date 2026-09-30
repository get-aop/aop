#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: local dev helper reports exactly what it starts.

import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_LOCAL_SERVER_PORT = 25360;

export interface IsolatedDesktopDevPlan {
  aopHome: string;
  dbPath: string;
  env: NodeJS.ProcessEnv;
  localServerPort: number;
  logDir: string;
  tmpDir: string;
  wrapperPath: string;
  workspaceRoot: string;
}

interface PlanOptions {
  homeDir?: string;
  localServerPort?: number;
  workspaceRoot?: string;
}

/**
 * A desktop app that runs its own host beside a released AOP: its own home, database and port,
 * so it never touches `~/.aop` or the host a released app keeps on 25150.
 */
export const buildIsolatedDesktopDevPlan = ({
  homeDir = homedir(),
  localServerPort = readPort("AOP_DESKTOP_LOCAL_SERVER_PORT", DEFAULT_LOCAL_SERVER_PORT),
  workspaceRoot = WORKSPACE_ROOT,
}: PlanOptions = {}): IsolatedDesktopDevPlan => {
  const aopHome =
    process.env.AOP_DESKTOP_DEV_HOME ?? join(homeDir, ".aop-local-dev", "desktop-app");
  const logDir = join(aopHome, "logs");
  const tmpDir = join(aopHome, "tmp");
  const dbPath = join(aopHome, "projects.sqlite");
  const wrapperPath = join(aopHome, "bin", "aop-dev-host");

  return {
    aopHome,
    dbPath,
    localServerPort,
    logDir,
    tmpDir,
    wrapperPath,
    workspaceRoot,
    env: {
      ...process.env,
      AOP_HOME: aopHome,
      AOP_DB_PATH: dbPath,
      AOP_LOG_DIR: logDir,
      AOP_DESKTOP_HOST_PATH: wrapperPath,
      AOP_DESKTOP_LOCAL_SERVER_PORT: String(localServerPort),
      TMPDIR: tmpDir,
    },
  };
};

export const writeDevHostWrapper = async (plan: IsolatedDesktopDevPlan): Promise<void> => {
  await mkdir(join(plan.aopHome, "bin"), { recursive: true });
  await mkdir(plan.logDir, { recursive: true });
  await mkdir(plan.tmpDir, { recursive: true });
  await writeFile(plan.wrapperPath, buildWrapperScript(plan.workspaceRoot));
  await chmod(plan.wrapperPath, 0o755);
};

/** Stands in for the packaged `aop` binary: the app runs it with `run`, which starts this checkout's server. */
export const buildWrapperScript = (workspaceRoot: string): string => `#!/usr/bin/env bash
set -euo pipefail
cd ${shellQuote(workspaceRoot)}

if [[ "\${1:-}" == "run" ]]; then
  exec bun run apps/local-server/src/run.ts
fi

exec bun run apps/cli/src/main.ts "$@"
`;

const main = async (): Promise<void> => {
  const plan = buildIsolatedDesktopDevPlan();
  await writeDevHostWrapper(plan);

  console.log("Starting isolated AOP desktop dev app");
  console.log(`AOP_HOME: ${plan.aopHome}`);
  console.log(`Host API (host mode): http://127.0.0.1:${plan.localServerPort}`);
  console.log("This will open an Electron dev window. Press Ctrl+C here to stop it.");

  const bunPath = Bun.which("bun") ?? "bun";
  const child = Bun.spawn([bunPath, "run", "dev:desktop"], {
    cwd: plan.workspaceRoot,
    env: plan.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  process.exit(await child.exited);
};

const readPort = (name: string, fallback: number): number => {
  const value = process.env[name];
  if (!value) return fallback;

  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

if (import.meta.main) {
  await main();
}
