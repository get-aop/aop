#!/usr/bin/env bun
/**
 * Isolated AOP stack for verification runs.
 *
 *   bun .claude/skills/verify/scripts/verify-stack.ts start  [--name <run>]
 *   bun .claude/skills/verify/scripts/verify-stack.ts doctor [--name <run>]
 *   bun .claude/skills/verify/scripts/verify-stack.ts env    [--name <run>]
 *   bun .claude/skills/verify/scripts/verify-stack.ts aop    [--name <run>] -- <aop args>
 *   bun .claude/skills/verify/scripts/verify-stack.ts restart-server [--name <run>] [--crash]
 *   bun .claude/skills/verify/scripts/verify-stack.ts stop   [--name <run>]
 *
 * Each run gets its own AOP_HOME, SQLite DB, free ports, and PIDs under
 * `.work/verify/<run>/`. It never touches `~/.aop`, `~/.aop-dev`, or the
 * default ports (25150/25160), so it is safe next to a released `aop` or a
 * running `bun dev`. `stop` deletes the scratch home and fixtures but keeps
 * `evidence/` and `logs/`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const VERIFY_DIR = join(ROOT, ".work", "verify");
const PORT_RANGE = { min: 25400, max: 25499 };
const READY_TIMEOUT_MS = 30_000;

interface RunState {
  name: string;
  dir: string;
  home: string;
  serverPort: number;
  dashboardPort: number;
  serverPid: number;
  dashboardPid: number;
  env: Record<string, string>;
}

const [command = "help", ...rest] = process.argv.slice(2);
const separator = rest.indexOf("--");
const flagArgs = separator === -1 ? rest : rest.slice(0, separator);
const passthrough = separator === -1 ? [] : rest.slice(separator + 1);
const nameFlag = flagArgs.indexOf("--name");
const runName = nameFlag === -1 ? "default" : (flagArgs[nameFlag + 1] ?? "default");

const commands: Record<string, () => Promise<number>> = {
  start: startStack,
  doctor: doctorStack,
  env: printEnv,
  aop: runAop,
  "restart-server": restartServer,
  stop: stopStack,
};

process.exit(await (commands[command] ?? printHelp)());

async function startStack(): Promise<number> {
  const dir = join(VERIFY_DIR, runName);
  if (existsSync(join(dir, "state.json"))) {
    process.stderr.write(`Run "${runName}" already exists. Run stop first, or pick --name.\n`);
    return 1;
  }
  const home = join(dir, "home");
  await mkdir(join(dir, "logs"), { recursive: true });
  await mkdir(join(dir, "evidence"), { recursive: true });
  await mkdir(home, { recursive: true });

  const [serverPort, dashboardPort] = await pickPorts();
  const env = buildEnv(home, serverPort, dashboardPort);
  const server = spawnDetached(
    join(ROOT, "apps/local-server/src/run.ts"),
    join(dir, "logs/server.log"),
    env,
  );
  const dashboard = spawnDetached(
    join(ROOT, "apps/dashboard/dev.ts"),
    join(dir, "logs/dashboard.log"),
    env,
    join(ROOT, "apps/dashboard"),
  );
  const state: RunState = {
    name: runName,
    dir,
    home,
    serverPort,
    dashboardPort,
    serverPid: server,
    dashboardPid: dashboard,
    env,
  };
  await writeFile(join(dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);

  const ready = await waitFor(
    async () => (await checkHealth(serverPort)) && (await checkDashboard(dashboardPort)),
  );
  if (!ready) {
    process.stderr.write(`Stack not ready in ${READY_TIMEOUT_MS}ms. See ${dir}/logs/. Run stop.\n`);
    return 1;
  }
  process.stdout.write(
    `ready run=${runName}\n  dashboard http://127.0.0.1:${dashboardPort}\n  api       http://127.0.0.1:${serverPort}\n  AOP_HOME  ${home}\n  evidence  ${join(dir, "evidence")}\n`,
  );
  return 0;
}

async function doctorStack(): Promise<number> {
  const state = await loadState();
  if (!state) return 1;
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as { version: string };
  const checks: [string, boolean, string][] = [
    ...(await processChecks(
      "server",
      state.serverPid,
      state.serverPort,
      "apps/local-server/src/run.ts",
    )),
    ...(await processChecks(
      "dashboard",
      state.dashboardPid,
      state.dashboardPort,
      "apps/dashboard/dev.ts",
    )),
    ["api health ok", await checkHealth(state.serverPort), `/api/health on ${state.serverPort}`],
    [
      "dashboard serves /",
      await checkDashboard(state.dashboardPort),
      `/ on ${state.dashboardPort}`,
    ],
    ["dashboard proxies /api", await checkProxy(state.dashboardPort), "/api/health via dashboard"],
    ["home isolated", isIsolated(state.home), state.home],
  ];
  for (const [label, ok, detail] of checks) {
    process.stdout.write(`${ok ? "PASS" : "FAIL"}  ${label}  (${detail})\n`);
  }
  process.stdout.write(`worktree version ${pkg.version}, root ${ROOT}\n`);
  return checks.every(([, ok]) => ok) ? 0 : 1;
}

async function printEnv(): Promise<number> {
  const state = await loadState();
  if (!state) return 1;
  for (const [key, value] of Object.entries(state.env)) {
    process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
  }
  return 0;
}

async function runAop(): Promise<number> {
  const state = await loadState();
  if (!state) return 1;
  const proc = Bun.spawn(["bun", "run", join(ROOT, "apps/cli/src/main.ts"), ...passthrough], {
    cwd: process.cwd(),
    env: { ...process.env, ...state.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await proc.exited;
}

/**
 * Restarts only the local server on the same port, home, and DB. `--crash` sends
 * SIGKILL so shutdown hooks never run, which is how a crashed server leaves detached
 * chat CLIs running; the default SIGTERM runs the graceful shutdown path.
 */
async function restartServer(): Promise<number> {
  const state = await loadState();
  if (!state) return 1;
  const signal = flagArgs.includes("--crash") ? "SIGKILL" : "SIGTERM";
  killGroup(state.serverPid, signal);
  if (!(await waitFor(async () => !isAlive(state.serverPid), 10_000))) {
    process.stderr.write(`Server ${state.serverPid} did not exit after ${signal}.\n`);
    return 1;
  }
  state.serverPid = spawnDetached(
    join(ROOT, "apps/local-server/src/run.ts"),
    join(state.dir, "logs/server.log"),
    state.env,
  );
  await writeFile(join(state.dir, "state.json"), `${JSON.stringify(state, null, 2)}\n`);
  if (!(await waitFor(() => checkHealth(state.serverPort)))) {
    process.stderr.write(`Server not healthy in ${READY_TIMEOUT_MS}ms. See ${state.dir}/logs/.\n`);
    return 1;
  }
  process.stdout.write(`restarted server run=${runName} (${signal}), pid ${state.serverPid}\n`);
  return 0;
}

async function stopStack(): Promise<number> {
  const state = await loadState();
  if (!state) return 0;
  // Only the PIDs this run recorded; never match by process name.
  for (const pid of [state.serverPid, state.dashboardPid]) killGroup(pid);
  await waitFor(async () => !isAlive(state.serverPid) && !isAlive(state.dashboardPid), 10_000);
  for (const pid of [state.serverPid, state.dashboardPid]) killGroup(pid, "SIGKILL");
  await rm(state.home, { recursive: true, force: true });
  await rm(join(state.dir, "fixtures"), { recursive: true, force: true });
  await rm(join(state.dir, "state.json"), { force: true });
  process.stdout.write(`stopped run=${runName}; evidence kept in ${join(state.dir, "evidence")}\n`);
  return 0;
}

function printHelp(): Promise<number> {
  process.stdout.write(
    "Usage: verify-stack.ts <start|doctor|env|aop|restart-server|stop> [--name <run>] [--crash] [-- aop args]\n",
  );
  return Promise.resolve(command === "help" ? 0 : 1);
}

function buildEnv(home: string, serverPort: number, dashboardPort: number): Record<string, string> {
  return {
    AOP_HOME: home,
    AOP_DB_PATH: join(home, "aop.sqlite"),
    AOP_LOG_DIR: join(home, "logs"),
    AOP_LOCAL_SERVER_PORT: String(serverPort),
    AOP_LOCAL_SERVER_URL: `http://127.0.0.1:${serverPort}`,
    AOP_DASHBOARD_PORT: String(dashboardPort),
    AOP_DASHBOARD_URL: `http://127.0.0.1:${dashboardPort}`,
  };
}

function spawnDetached(
  entry: string,
  logPath: string,
  env: Record<string, string>,
  cwd = ROOT,
): number {
  const proc = Bun.spawn(["bun", "run", entry], {
    cwd,
    env: { ...process.env, ...env },
    stdout: Bun.file(logPath),
    stderr: Bun.file(logPath),
    detached: true,
  });
  proc.unref();
  return proc.pid;
}

async function loadState(): Promise<RunState | null> {
  const path = join(VERIFY_DIR, runName, "state.json");
  if (!existsSync(path)) {
    process.stderr.write(`No run "${runName}" (${path}). Run start first.\n`);
    return null;
  }
  return JSON.parse(await readFile(path, "utf8")) as RunState;
}

async function processChecks(
  label: string,
  pid: number,
  port: number,
  entrySuffix: string,
): Promise<[string, boolean, string][]> {
  const cmd = (await Bun.$`ps -p ${pid} -o command=`.quiet().nothrow().text()).trim();
  const owner = (
    await Bun.$`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`.quiet().nothrow().text()
  ).trim();
  return [
    [
      `${label} process is this worktree`,
      cmd.includes(join(ROOT, entrySuffix)),
      cmd || `pid ${pid} gone`,
    ],
    [
      `${label} port ${port} owned by run`,
      owner.split("\n").includes(String(pid)),
      `lsof: ${owner || "none"}`,
    ],
  ];
}

function isIsolated(home: string): boolean {
  return ![join(homedir(), ".aop"), join(homedir(), ".aop-dev")].includes(home);
}

async function checkHealth(port: number): Promise<boolean> {
  const res = await fetchQuiet(`http://127.0.0.1:${port}/api/health`);
  if (!res?.ok) return false;
  const body = (await res.json()) as { ok?: boolean; db?: { connected?: boolean } };
  return body.ok === true && body.db?.connected === true;
}

async function checkDashboard(port: number): Promise<boolean> {
  const res = await fetchQuiet(`http://127.0.0.1:${port}/`);
  return res?.ok === true && (res.headers.get("content-type") ?? "").includes("text/html");
}

async function checkProxy(port: number): Promise<boolean> {
  return (await fetchQuiet(`http://127.0.0.1:${port}/api/health`))?.ok === true;
}

async function fetchQuiet(url: string): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(2000) });
  } catch {
    return null;
  }
}

async function pickPorts(): Promise<[number, number]> {
  const free: number[] = [];
  const start = PORT_RANGE.min + Math.floor(Math.random() * (PORT_RANGE.max - PORT_RANGE.min - 1));
  for (let port = start; free.length < 2 && port <= PORT_RANGE.max; port++) {
    if (isPortFree(port)) free.push(port);
  }
  const [first, second] = free;
  if (first === undefined || second === undefined) throw new Error("No free ports in 25400-25499");
  return [first, second];
}

function isPortFree(port: number): boolean {
  try {
    Bun.listen({ hostname: "127.0.0.1", port, socket: { data() {} } }).stop(true);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = READY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await Bun.sleep(250);
  }
  return false;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killGroup(pid: number, signal: NodeJS.Signals = "SIGTERM"): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Already gone.
  }
}
