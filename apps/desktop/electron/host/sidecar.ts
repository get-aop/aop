import type { SidecarState } from "../../src/backend/types";
import { guiSafePath } from "./platform";
import { bashSingleQuote, wslBashScriptArgv } from "./wsl";

export interface SidecarPorts {
  localServer: number;
  dashboard: number;
}

export type LaunchMode = { kind: "native" } | { kind: "wsl"; distro: string };

export interface SidecarLaunchConfig {
  mode: LaunchMode;
  program: string;
  args: string[];
  env: Record<string, string>;
  healthUrl: string;
  dashboardUrl: string;
}

interface NativeSidecarPaths {
  executable: string;
  logDir: string;
}

export const parseSidecarPorts = (
  localServer = process.env.AOP_DESKTOP_LOCAL_SERVER_PORT,
  dashboard = process.env.AOP_DESKTOP_DASHBOARD_PORT,
): SidecarPorts => ({
  localServer: parsePort(localServer) ?? 25150,
  dashboard: parsePort(dashboard) ?? 25160,
});

export const buildNativeSidecarLaunchConfig = (
  paths: NativeSidecarPaths,
  ports: SidecarPorts,
  dashboardDev = isDashboardDevMode(),
): SidecarLaunchConfig => {
  const urls = buildSidecarUrls(ports, dashboardDev);
  return {
    mode: { kind: "native" },
    program: paths.executable,
    args: ["run"],
    env: {
      AOP_LOCAL_SERVER_PORT: String(ports.localServer),
      AOP_DASHBOARD_PORT: String(ports.dashboard),
      AOP_LOG_DIR: paths.logDir,
      AOP_LOCAL_SERVER_URL: urls.localServer,
      AOP_DASHBOARD_URL: urls.dashboardOrigin,
      NODE_ENV: dashboardDev ? "development" : "production",
      PATH: guiSafePath(),
    },
    healthUrl: `${urls.localServer}/api/health`,
    dashboardUrl: `${urls.dashboardOrigin}/?aopDesktop=1`,
  };
};

export const buildWslSidecarLaunchConfig = (
  distro: string,
  version: string,
  ports: SidecarPorts,
  dashboardDev = isDashboardDevMode(),
): SidecarLaunchConfig => {
  const urls = buildSidecarUrls(ports, dashboardDev);
  return {
    mode: { kind: "wsl", distro },
    program: `.aop/desktop-runtime/${version}/aop`,
    args: ["run"],
    env: {
      AOP_LOCAL_SERVER_PORT: String(ports.localServer),
      AOP_DASHBOARD_PORT: String(ports.dashboard),
      AOP_LOCAL_SERVER_URL: urls.localServer,
      AOP_DASHBOARD_URL: urls.dashboardOrigin,
      NODE_ENV: dashboardDev ? "development" : "production",
      AOP_EXEC_HOST: `wsl:${distro}`,
      AOP_DESKTOP_MANAGED_RUNTIME: "1",
    },
    healthUrl: `${urls.localServer}/api/health`,
    dashboardUrl: `${urls.dashboardOrigin}/?aopDesktop=1`,
  };
};

export const buildWslLaunchScript = (env: Record<string, string>, executable: string): string => {
  const assignments = Object.entries(env)
    .filter(([key]) => key !== "PATH" && key !== "AOP_LOG_DIR")
    .map(([key, value]) => `${key}=${bashSingleQuote(value)}`)
    .join(" ");
  return `mkdir -p "$HOME/.aop" && echo $$ > "$HOME/.aop/desktop-sidecar.pid" && ${assignments} AOP_LOG_DIR="$HOME/.aop/logs" exec "$HOME"/${bashSingleQuote(executable)} run`;
};

export const sidecarSpawnCommand = (
  config: SidecarLaunchConfig,
): { program: string; args: string[] } =>
  config.mode.kind === "wsl"
    ? {
        program: "wsl.exe",
        args: wslBashScriptArgv(
          config.mode.distro,
          buildWslLaunchScript(config.env, config.program),
        ),
      }
    : { program: config.program, args: config.args };

export const classifySidecarFailure = (
  windowsHealthy: boolean,
  wslHealthy: boolean,
): "healthy" | "localhost-forwarding-blocked" | "sidecar-never-started" => {
  if (windowsHealthy) return "healthy";
  return wslHealthy ? "localhost-forwarding-blocked" : "sidecar-never-started";
};

export const isValidRuntimeFingerprint = (value: string): boolean => /^[a-f\d]{64}$/iu.test(value);

export const provisionManagedRuntimeArgv = (
  distro: string,
  version: string,
  windowsBinary: string,
  windowsAssets: string,
  fingerprint: string,
): string[] => {
  const script =
    `set -eu; runtime="$HOME/.aop/desktop-runtime"/${bashSingleQuote(version)}; marker="$runtime/.fingerprint"; expected=${bashSingleQuote(fingerprint)}; ` +
    'if [ -x "$runtime/aop" ] && [ -f "$runtime/dashboard/index.html" ] && [ "$(cat "$marker" 2>/dev/null || true)" = "$expected" ]; then exit 0; fi; ' +
    `binary=$(wslpath -u ${bashSingleQuote(windowsBinary)}); assets=$(wslpath -u ${bashSingleQuote(windowsAssets)}); parent=$(dirname "$runtime"); ` +
    'staging="$runtime.tmp.$$"; backup="$runtime.previous"; lock="$runtime.lock"; mkdir -p "$parent"; ' +
    "if ! mkdir \"$lock\" 2>/dev/null; then echo 'AOP Desktop runtime installation is already in progress.' >&2; exit 1; fi; " +
    'trap \'rm -rf "$staging" "$lock"\' EXIT; rm -rf "$staging"; mkdir -p "$staging"; ' +
    'cp "$binary" "$staging/aop"; chmod 755 "$staging/aop"; tar -xzf "$assets" -C "$staging"; ' +
    'test -f "$staging/dashboard/index.html"; printf \'%s\\n\' "$expected" > "$staging/.fingerprint"; rm -rf "$backup"; ' +
    'if [ -e "$runtime" ]; then mv "$runtime" "$backup"; fi; ' +
    'if mv "$staging" "$runtime"; then rm -rf "$backup"; else if [ -e "$backup" ]; then mv "$backup" "$runtime"; fi; exit 1; fi; ' +
    'rm -rf "$lock"; trap - EXIT';
  return wslBashScriptArgv(distro, script);
};

export const releaseKnownWslRuntimeArgv = (distro: string): string[] =>
  wslBashScriptArgv(
    distro,
    'systemctl --user stop aop-local-server.service >/dev/null 2>&1 || true; pidfile="$HOME/.aop/desktop-sidecar.pid"; if [ -f "$pidfile" ]; then pid=$(cat "$pidfile"); case "$pid" in (*[!0-9]*|\'\') ;; (*) exe=$(readlink "/proc/$pid/exe" 2>/dev/null || true); case "$exe" in ("$HOME/.aop/desktop-runtime/"*/aop) kill "$pid" >/dev/null 2>&1 || true ;; esac ;; esac; rm -f "$pidfile"; fi',
  );

export const existingServerMatchesSidecarVersion = (
  serverVersion: string,
  sidecarVersion: string,
): boolean =>
  releaseCore(serverVersion) !== "" && releaseCore(serverVersion) === releaseCore(sidecarVersion);

export const sidecarFailureMessage = (
  failure: ReturnType<typeof classifySidecarFailure>,
): string => {
  if (failure === "healthy") return "AOP is ready.";
  if (failure === "localhost-forwarding-blocked") {
    return "AOP is running inside WSL but Windows can't reach it on localhost. Check WSL networking (mirrored mode / .wslconfig) and any firewall blocking 127.0.0.1:25150.";
  }
  return "The AOP server did not start inside WSL. Open your distro and check ~/.aop/logs.";
};

export const waitForSidecarHealth = async (
  healthUrl: string,
  maxAttempts: number,
  isHealthy: (url: string, attempt: number) => Promise<boolean>,
  delay: (milliseconds: number) => Promise<void> = wait,
): Promise<SidecarState> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isHealthy(healthUrl, attempt)) {
      return {
        status: "ready",
        dashboardUrl: healthUrl.replace(/api\/health$/u, ""),
        message: "AOP is ready.",
      };
    }
    await delay(250);
  }
  return { status: "failed", message: "The AOP local server did not become healthy." };
};

const buildSidecarUrls = (ports: SidecarPorts, dashboardDev: boolean) => {
  const localServer = `http://127.0.0.1:${ports.localServer}`;
  return {
    localServer,
    dashboardOrigin: `http://127.0.0.1:${dashboardDev ? ports.dashboard : ports.localServer}`,
  };
};

const parsePort = (value: string | undefined): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : null;
};

const releaseCore = (version: string): string =>
  version.trim().replace(/^v/u, "").split("+", 1)[0]?.trim() ?? "";

const isDashboardDevMode = (): boolean =>
  process.env.AOP_DESKTOP_DASHBOARD_DEV === "1" ||
  process.env.AOP_DESKTOP_DASHBOARD_DEV?.toLowerCase() === "true";

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
