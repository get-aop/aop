import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecHost } from "@aop/infra";
import { resolveExecHost } from "@aop/infra";
import {
  type ProviderUpdateId,
  type ProviderUpdateState,
  providerUpdateService,
} from "./provider-updates.ts";

export type ProviderCapabilitySupport = "yes" | "no" | "partial";

type ProviderCapabilityId = ProviderUpdateId;

/** CLI ids probed when testing a remote execution host. */
export type ProbedProviderCliId = ProviderCapabilityId;

export interface ProviderCapabilityEntry {
  id: ProviderCapabilityId;
  label: string;
  roleFit: string;
  version: string | null;
  updateState: ProviderUpdateState;
  capabilities: {
    structuredJsonl: ProviderCapabilitySupport;
    resumeSupport: ProviderCapabilitySupport;
    usageReporting: ProviderCapabilitySupport;
    nativePlanMode: ProviderCapabilitySupport;
    permissionSandboxFlags: ProviderCapabilitySupport;
    liveFollowUp: ProviderCapabilitySupport;
  };
  readinessProbe: {
    cliInstalled: boolean;
    authenticated: boolean;
    versionDetected: boolean;
    canSpawn: boolean;
    canResume: boolean;
    canWriteLogs: boolean;
    canReportUsage: boolean;
    supportsConfiguredSafetyFlags: boolean;
  };
}

export interface ProviderDoctor {
  commandExists: (command: string) => Promise<boolean>;
  readVersion: (command: string) => Promise<string | null>;
  hasAuth: (providerId: ProviderCapabilityId) => boolean | Promise<boolean>;
  canWriteLog: (providerId: ProviderCapabilityId) => Promise<boolean>;
}

export interface ProviderCliProbe {
  id: ProbedProviderCliId;
  installed: boolean;
  version: string | null;
  authenticated: boolean;
}

const CLI_COMMANDS: Record<ProviderCapabilityId, string> = {
  "claude-code": "claude",
};

const VERSION_TIMEOUT_MS = 1_500;

export const getProviderCapabilities = async (
  doctor: ProviderDoctor = createDefaultProviderDoctor(),
  updateStates = providerUpdateService.getStates(),
): Promise<ProviderCapabilityEntry[]> =>
  Promise.all(
    STATIC_PROVIDER_CAPABILITIES.map((entry) =>
      withReadinessProbe(entry, doctor, updateStates[entry.id]),
    ),
  );

const STATIC_PROVIDER_CAPABILITIES: Array<
  Omit<ProviderCapabilityEntry, "readinessProbe" | "version" | "updateState">
> = [
  {
    id: "claude-code",
    label: "Claude Code",
    roleFit: "Strong interactive reviewer/runtime when local auth and permissions are configured.",
    capabilities: {
      structuredJsonl: "partial",
      resumeSupport: "yes",
      usageReporting: "partial",
      nativePlanMode: "yes",
      permissionSandboxFlags: "yes",
      liveFollowUp: "yes",
    },
  },
];

const withReadinessProbe = async (
  entry: Omit<ProviderCapabilityEntry, "readinessProbe" | "version" | "updateState">,
  doctor: ProviderDoctor,
  updateState: ProviderUpdateState,
): Promise<ProviderCapabilityEntry> => {
  const command = CLI_COMMANDS[entry.id];
  const cliInstalled = await doctor.commandExists(command);
  const version = cliInstalled ? await doctor.readVersion(command) : null;
  const versionDetected = Boolean(version);
  const canWriteLogs = cliInstalled ? await doctor.canWriteLog(entry.id) : false;
  const authenticated = cliInstalled && Boolean(await doctor.hasAuth(entry.id));

  return {
    ...entry,
    version,
    updateState,
    readinessProbe: {
      cliInstalled,
      authenticated,
      versionDetected,
      canSpawn: cliInstalled && versionDetected,
      canResume: cliInstalled && isSupported(entry.capabilities.resumeSupport),
      canWriteLogs,
      canReportUsage: canWriteLogs && isSupported(entry.capabilities.usageReporting),
      supportsConfiguredSafetyFlags:
        cliInstalled && isSupported(entry.capabilities.permissionSandboxFlags),
    },
  };
};

const isSupported = (support: ProviderCapabilitySupport): boolean => support !== "no";

export const createDefaultProviderDoctor = (): ProviderDoctor =>
  createProviderDoctorForHost(resolveExecHost());

/** Build a doctor that probes CLIs through an arbitrary ExecHost (local or SSH). */
export const createProviderDoctorForHost = (host: ExecHost): ProviderDoctor => {
  // SSH hosts have their own filesystem: auth lives under the remote $HOME, and the
  // local temp-dir write probe is meaningless there.
  const remote = host.kind === "ssh";
  return {
    commandExists: (command) => host.commandExists(command),

    readVersion: async (command) => readCommandVersion(host, command),

    hasAuth: async (providerId) =>
      remote
        ? remoteAuthExists(host, AUTH_PATH_SUFFIXES[providerId])
        : getLocalAuthPaths(providerId).some((path) => existsSync(path)),

    canWriteLog: async (providerId) => {
      if (remote) {
        return true;
      }
      const dir = await mkdtemp(join(tmpdir(), `aop-provider-${providerId}-`));
      try {
        await writeFile(join(dir, "probe.jsonl"), `${JSON.stringify({ ok: true })}\n`);
        return true;
      } catch {
        return false;
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
};

/** Compact CLI probe used by execution-host Test connection. */
export const probeProviderClis = async (doctor: ProviderDoctor): Promise<ProviderCliProbe[]> => {
  const ids = Object.keys(CLI_COMMANDS) as ProbedProviderCliId[];
  return Promise.all(
    ids.map(async (id) => {
      const command = CLI_COMMANDS[id];
      const installed = await doctor.commandExists(command);
      const version = installed ? await doctor.readVersion(command) : null;
      const authenticated = installed && Boolean(await doctor.hasAuth(id));
      return { id, installed, version, authenticated };
    }),
  );
};

const readCommandVersion = async (host: ExecHost, command: string): Promise<string | null> => {
  try {
    const proc = host.spawn({
      cmd: [command, "--version"],
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const killTimer = setTimeout(() => proc.kill(), VERSION_TIMEOUT_MS);
    const stdoutStream = proc.stdout instanceof ReadableStream ? proc.stdout : null;
    const stderrStream = proc.stderr instanceof ReadableStream ? proc.stderr : null;
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited.catch(() => 1),
      new Response(stdoutStream).text().catch(() => ""),
      new Response(stderrStream).text().catch(() => ""),
    ]);
    clearTimeout(killTimer);
    if (exitCode !== 0) return null;
    return [stdout, stderr].join("\n").trim() || null;
  } catch {
    return null;
  }
};

/** One remote round trip: `test -e "$HOME/<suffix>" || …`, expanding $HOME on the remote. */
const remoteAuthExists = async (host: ExecHost, suffixes: string[]): Promise<boolean> => {
  if (suffixes.length === 0) return false;
  // Suffixes are static internal literals (no quoting hazards).
  const script = suffixes.map((suffix) => `test -e "$HOME/${suffix}"`).join(" || ");
  try {
    const proc = host.shell(script, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
};

/** Home-relative auth locations; local probes join homedir(), remote probes use "$HOME". */
const AUTH_PATH_SUFFIXES: Record<ProviderCapabilityId, string[]> = {
  "claude-code": [".claude.json", ".claude", ".config/claude"],
};

const getLocalAuthPaths = (providerId: ProviderCapabilityId): string[] =>
  AUTH_PATH_SUFFIXES[providerId].map((suffix) => join(homedir(), suffix));
