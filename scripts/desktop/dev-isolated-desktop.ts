#!/usr/bin/env bun
// biome-ignore-all lint/suspicious/noConsole: local dev helper reports exactly what it starts.

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const WORKSPACE_ROOT = join(import.meta.dirname, "../..");
const DEFAULT_LOCAL_SERVER_PORT = 25360;
const DEFAULT_DASHBOARD_PORT = 25370;

export interface IsolatedDesktopDevPlan {
  aopHome: string;
  dashboardPort: number;
  dbPath: string;
  env: NodeJS.ProcessEnv;
  localServerPort: number;
  logDir: string;
  tmpDir: string;
  wrapperPath: string;
  workspaceRoot: string;
}

interface PlanOptions {
  dashboardPort?: number;
  homeDir?: string;
  localServerPort?: number;
  workspaceRoot?: string;
}

export const buildIsolatedDesktopDevPlan = ({
  dashboardPort = readPort("AOP_DESKTOP_DASHBOARD_PORT", DEFAULT_DASHBOARD_PORT),
  homeDir = homedir(),
  localServerPort = readPort("AOP_DESKTOP_LOCAL_SERVER_PORT", DEFAULT_LOCAL_SERVER_PORT),
  workspaceRoot = WORKSPACE_ROOT,
}: PlanOptions = {}): IsolatedDesktopDevPlan => {
  const aopHome =
    process.env.AOP_DESKTOP_DEV_HOME ?? join(homeDir, ".aop-local-dev", "desktop-app");
  const logDir = join(aopHome, "logs");
  const tmpDir = join(aopHome, "tmp");
  const dbPath = join(aopHome, "aop.sqlite");
  const wrapperPath = join(aopHome, "bin", "aop-dev-sidecar");
  const localServerUrl = `http://127.0.0.1:${localServerPort}`;

  return {
    aopHome,
    dashboardPort,
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
      AOP_LOCAL_SERVER_URL: localServerUrl,
      AOP_DESKTOP_SIDECAR_PATH: wrapperPath,
      AOP_DESKTOP_LOCAL_SERVER_PORT: String(localServerPort),
      AOP_DESKTOP_DASHBOARD_PORT: String(dashboardPort),
      AOP_DESKTOP_DASHBOARD_DEV: "1",
      AOP_TEST_MODE: "false",
      TMPDIR: tmpDir,
    },
  };
};

export const writeDevSidecarWrapper = async (plan: IsolatedDesktopDevPlan): Promise<void> => {
  await mkdir(join(plan.aopHome, "bin"), { recursive: true });
  await mkdir(plan.logDir, { recursive: true });
  await mkdir(plan.tmpDir, { recursive: true });
  await writeFile(
    plan.wrapperPath,
    buildWrapperScript(plan.workspaceRoot, await readCliVersion(plan)),
  );
  await chmod(plan.wrapperPath, 0o755);
};

export const buildWrapperScript = (
  workspaceRoot: string,
  version: string,
): string => `#!/usr/bin/env bash
set -euo pipefail
cd ${shellQuote(workspaceRoot)}

if [[ "\${1:-}" == "--version" ]]; then
  echo ${shellQuote(`aop/${version} darwin-arm64 dev-sidecar`)}
  exit 0
fi

if [[ "\${1:-}" == "run" ]]; then
  export NODE_ENV=development
  exec bun run dev
fi

exec bun run apps/cli/src/main.ts "$@"
`;

const main = async (): Promise<void> => {
  const plan = buildIsolatedDesktopDevPlan();
  await writeDevSidecarWrapper(plan);

  console.log("Starting isolated AOP desktop dev app");
  console.log(`AOP_HOME: ${plan.aopHome}`);
  console.log(`API: http://127.0.0.1:${plan.localServerPort}`);
  console.log(`Dashboard sidecar port: ${plan.dashboardPort}`);
  console.log("This will open a Tauri dev window. Press Ctrl+C here to stop it.");

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

const readCliVersion = async (plan: IsolatedDesktopDevPlan): Promise<string> => {
  const content = await readFile(join(plan.workspaceRoot, "apps/cli/package.json"), "utf8");
  const packageJson = JSON.parse(content) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("apps/cli/package.json is missing a version");
  }
  return packageJson.version.trim();
};

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;

if (import.meta.main) {
  await main();
}
