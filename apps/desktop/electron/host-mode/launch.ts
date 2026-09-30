import { spawn } from "node:child_process";
import { join } from "node:path";
import type { TailscaleHint } from "../../src/backend/types";
import type { HostClient } from "../connection/host-client";
import type { ManagedChild } from "./supervisor";
import type { PortProbe } from "./supervisor-state";

export interface HostLaunch {
  program: string;
  args: string[];
  env: Record<string, string>;
}

interface LaunchOptions {
  executable: string;
  port: number;
  logDir: string;
  baseEnv: Record<string, string | undefined>;
}

/**
 * How the app starts the host server on this Mac. The server always binds loopback: other
 * computers reach it through `tailscale serve`, which the person turns on (see docs/HOST.md),
 * and a request from a remote device then needs a device token like any other.
 */
export const buildHostLaunch = ({
  executable,
  port,
  logDir,
  baseEnv,
}: LaunchOptions): HostLaunch => ({
  program: executable,
  args: ["run"],
  env: {
    ...definedOnly(baseEnv),
    AOP_LOCAL_SERVER_PORT: String(port),
    AOP_BIND_HOST: "127.0.0.1",
    AOP_LOG_DIR: logDir,
    NODE_ENV: "production",
    PATH: guiSafePath(baseEnv.HOME, baseEnv.PATH),
  },
});

/**
 * An app opened from Finder inherits a bare PATH, without Homebrew or the user's own bin
 * directories, so the host could not find `git`, `gh` or `claude`. These are where they live.
 */
export const guiSafePath = (home: string | undefined, path: string | undefined): string => {
  const paths = [
    ...(home ? [`${home}/.local/bin`, `${home}/.bun/bin`] : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    ...(path ? path.split(":") : []),
  ];
  return [...new Set(paths.filter(Boolean))].join(":");
};

/** The server binary the Mac app ships in its resources, unless the environment names another. */
export const resolveHostExecutable = (
  env: Record<string, string | undefined>,
  resourceRoot: string,
  exists: (path: string) => boolean,
): string | null => {
  const executable = env.AOP_DESKTOP_HOST_PATH || join(resourceRoot, "aop");
  return exists(executable) ? executable : null;
};

export const resolveLogDir = (env: Record<string, string | undefined>): string =>
  env.AOP_LOG_DIR || join(env.HOME ?? "", ".aop", "logs");

export const spawnHostServer = (launch: HostLaunch): ManagedChild => {
  const child = spawn(launch.program, launch.args, { env: launch.env, stdio: "ignore" });
  return {
    kill: (signal) => void child.kill(signal),
    exited: new Promise((resolve) => {
      child.once("exit", (code) => resolve({ code }));
      // A program that cannot be launched never exits; it reports an error instead.
      child.once("error", (error) => resolve({ code: null, error: error.message }));
    }),
  };
};

/** Who is listening on the port. A refused connection means nobody; anything else means somebody. */
export const createPortProbe = (client: HostClient) => async (): Promise<PortProbe> => {
  const health = await client.health();
  if (health.status === "ok") return { kind: "aop", version: health.health.version };
  if (health.status === "not-aop") return { kind: "occupied" };
  return health.failure === "refused" ? { kind: "free" } : { kind: "occupied" };
};

/** Asks the host how it is until it answers, then says which version answered. Null if it never does. */
export const createHealthWaiter =
  (client: HostClient, sleep: (ms: number) => Promise<void>, attempts = 80, intervalMs = 250) =>
  async (): Promise<string | null> => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const health = await client.health();
      if (health.status === "ok") return health.health.version;
      await sleep(intervalMs);
    }
    return null;
  };

export const tailscaleHint = (port: number): TailscaleHint => ({
  serveCommand: `tailscale serve --bg --https=443 http://127.0.0.1:${port}`,
  resetCommand: "tailscale serve reset",
});

const definedOnly = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
