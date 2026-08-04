#!/usr/bin/env bun
/**
 * Dev Environment Orchestrator
 *
 * Starts all services needed for development:
 * 1. AOP Local Server (apps/local-server) - local task orchestrator
 * 2. Dashboard (apps/dashboard) - web UI with HMR
 *
 * State lives in an isolated `~/.aop-dev` home so a released `aop` install can
 * keep using `~/.aop` untouched. Override with an explicit AOP_HOME.
 *
 * Usage:
 *   bun dev                   # Start all services
 *   bun dev --no-local        # Start dashboard only
 *   bun dev --no-dashboard    # Start without dashboard
 */

import { prepareDevEnv } from "./dev-env.ts";

// Sync and load .env, then pin the isolated dev AOP_HOME, before importing
// modules that read env vars at load time.
const DEV_AOP_HOME = await prepareDevEnv();

import { AOP_PORTS, AOP_URLS } from "@aop/common";
import { configureLogging, getLogger } from "@aop/infra";

const log = getLogger("orchestrator");

interface ParsedArgs {
  noLocal: boolean;
  noDashboard: boolean;
}

interface PortProcess {
  port: number;
  pid: number | null;
  command: string;
}

const isPortInUse = async (port: number): Promise<boolean> => {
  try {
    const server = Bun.serve({
      port,
      fetch: () => new Response(),
    });
    server.stop(true);
    return false;
  } catch {
    return true;
  }
};

const findPidWithLsof = async (port: number): Promise<{ pid: number; command: string } | null> => {
  try {
    const result = await Bun.$`lsof -ti :${port}`.quiet().text();
    const pid = Number(result.trim().split("\n")[0]);
    if (!pid) return null;
    const cmd = await Bun.$`ps -p ${pid} -o comm=`
      .quiet()
      .text()
      .catch(() => "unknown");
    return { pid, command: cmd.trim() || "unknown" };
  } catch {
    return null;
  }
};

const findPidWithSs = async (port: number): Promise<{ pid: number; command: string } | null> => {
  try {
    const result = await Bun.$`ss -tlnp`.quiet().text();
    for (const line of result.split("\n")) {
      if (line.includes(`:${port}`) && line.includes("pid=")) {
        const pidMatch = line.match(/pid=(\d+)/);
        const cmdMatch = line.match(/\("([^"]+)"/);
        if (pidMatch) {
          return { pid: Number(pidMatch[1]), command: cmdMatch?.[1] || "unknown" };
        }
      }
    }
  } catch {
    // ss not available or failed
  }
  return null;
};

const findPidOnPort = async (port: number): Promise<{ pid: number; command: string } | null> => {
  return (await findPidWithLsof(port)) ?? (await findPidWithSs(port));
};

const findProcessesOnPorts = async (ports: number[]): Promise<PortProcess[]> => {
  const results: PortProcess[] = [];
  for (const port of ports) {
    const inUse = await isPortInUse(port);
    if (inUse) {
      const info = await findPidOnPort(port);
      results.push({
        port,
        pid: info?.pid ?? null,
        command: info?.command ?? "unknown",
      });
    }
  }
  return results;
};

const killProcesses = async (processes: PortProcess[]): Promise<boolean> => {
  let allKilled = true;
  for (const { pid, port, command } of processes) {
    if (pid === null) {
      log.warn("Cannot kill process on port {port} - PID unknown. Please kill manually.", { port });
      allKilled = false;
      continue;
    }
    log.info("Killing process {pid} ({command}) on port {port}", { pid, command, port });
    try {
      await Bun.$`kill -9 ${pid}`.quiet();
    } catch {
      log.warn("Failed to kill process {pid}", { pid });
      allKilled = false;
    }
  }
  // Brief pause to let ports release
  await Bun.sleep(500);
  return allKilled;
};

const promptKillServices = async (processes: PortProcess[]): Promise<boolean> => {
  log.warn("Found existing services running:");
  for (const { port, pid, command } of processes) {
    log.warn("  Port {port}: {command} (PID {pid})", { port, command, pid: pid ?? "unknown" });
  }

  process.stdout.write("Kill these services before starting? [Y/n]: ");

  const reader = Bun.stdin.stream().getReader();
  const { value } = await reader.read();
  reader.releaseLock();

  const answer = value ? new TextDecoder().decode(value).trim().toLowerCase() : "";
  return answer === "" || answer === "y" || answer === "yes";
};

const checkAndKillExistingServices = async (ports: number[]): Promise<void> => {
  if (ports.length === 0) return;

  const existingProcesses = await findProcessesOnPorts(ports);
  if (existingProcesses.length === 0) return;

  const shouldKill = await promptKillServices(existingProcesses);
  if (shouldKill) {
    const allKilled = await killProcesses(existingProcesses);
    if (!allKilled) {
      log.info("Some processes could not be killed. Please stop them manually and try again.");
      process.exit(1);
    }
  } else {
    log.info("Aborting. Please stop the services manually and try again.");
    process.exit(0);
  }
};

const parseArgs = (): ParsedArgs => {
  const args = process.argv.slice(2);
  return {
    noLocal: args.includes("--no-local"),
    noDashboard: args.includes("--no-dashboard"),
  };
};

interface ProcessHandle {
  name: string;
  proc: Subprocess;
}

type Subprocess = ReturnType<typeof Bun.spawn>;

const startLocalServer = (): ProcessHandle => {
  log.info("Starting AOP local server...");
  const proc = Bun.spawn(["bun", "run", "--watch", "./src/run.ts"], {
    cwd: "./apps/local-server",
    env: {
      ...process.env,
      AOP_TEST_MODE: process.env.AOP_TEST_MODE ?? "true",
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "local-server", proc };
};

const startDashboard = (): ProcessHandle => {
  log.info("Starting AOP dashboard...");
  const proc = Bun.spawn(["bun", "run", "./dev.ts"], {
    cwd: "./apps/dashboard",
    env: {
      ...process.env,
      API_URL: AOP_URLS.LOCAL_SERVER,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  return { name: "dashboard", proc };
};

const shutdown = async (processes: ProcessHandle[]): Promise<void> => {
  log.info("Shutting down...");

  for (const { name, proc } of processes) {
    log.info("Stopping {name}...", { name });
    proc.kill();
    await proc.exited;
  }

  log.info("Shutdown complete");
};

const main = async () => {
  await configureLogging({ format: "pretty", serviceName: "dev" });

  const { noLocal, noDashboard } = parseArgs();

  // Check for existing services on ports we need
  const portsToCheck: number[] = [];
  if (!noLocal) portsToCheck.push(AOP_PORTS.LOCAL_SERVER);
  if (!noDashboard) portsToCheck.push(AOP_PORTS.DASHBOARD);
  await checkAndKillExistingServices(portsToCheck);

  const processes: ProcessHandle[] = [];

  if (!noLocal) {
    processes.push(startLocalServer());
  }

  if (!noDashboard) {
    processes.push(startDashboard());
    log.info("Dashboard available at {url}", { url: AOP_URLS.DASHBOARD });
  }

  log.info("Dev environment started. Press Ctrl+C to stop.");
  log.info("AOP_HOME: {aopHome}", { aopHome: DEV_AOP_HOME });

  process.on("SIGINT", async () => {
    await shutdown(processes);
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown(processes);
    process.exit(0);
  });

  await Promise.all(processes.map(({ proc }) => proc.exited));
};

main().catch(async (err) => {
  await configureLogging({ level: "error", serviceName: "dev" });
  log.fatal("Fatal error: {error}", { error: String(err) });
  process.exit(1);
});
