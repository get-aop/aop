import {
  type ExecHostConfig,
  ExecHostConfigSchema,
  type ExecHostUpsert,
  parseExecHostList,
} from "@aop/common";
import { type ExecHost, generateTypeId, SshExecHost } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { createProviderDoctorForHost, probeProviderClis } from "../providers/capabilities.ts";
import { SettingKey } from "../settings/types.ts";
import type { CreateSshExecHostForTaskInput, ExecHostTestResult } from "./types.ts";

export interface ResolvedStepExecHost {
  config: ExecHostConfig;
  host: SshExecHost;
}

export interface ExecHostsService {
  listExecHosts: () => Promise<ExecHostConfig[]>;
  saveExecHosts: (hosts: ExecHostConfig[]) => Promise<ExecHostConfig[]>;
  getExecHost: (id: string) => Promise<ExecHostConfig | null>;
  createSshExecHostForTask: (
    config: ExecHostConfig,
    input: CreateSshExecHostForTaskInput,
  ) => SshExecHost;
  /**
   * Single owner of "which host does this step run on": null when the step is local,
   * a config+host pair when bound, and a descriptive error when the binding is stale.
   */
  resolveStepExecHost: (
    execHostId: string | undefined,
    input: CreateSshExecHostForTaskInput,
  ) => Promise<ResolvedStepExecHost | null>;
  testExecHost: (id: string) => Promise<ExecHostTestResult>;
}

export const createExecHostsService = (
  ctx: LocalServerContext,
  options: { createProbeHost?: (config: ExecHostConfig) => ExecHost } = {},
): ExecHostsService => {
  const listExecHosts = async (): Promise<ExecHostConfig[]> => {
    const raw = await ctx.settingsRepository.get(SettingKey.REMOTE_EXEC_HOSTS);
    try {
      return parseExecHostList(raw ?? "");
    } catch {
      return [];
    }
  };

  const saveExecHosts = async (hosts: ExecHostConfig[]): Promise<ExecHostConfig[]> => {
    const validated = hosts.map((host) => ExecHostConfigSchema.parse(host));
    await ctx.settingsRepository.set(SettingKey.REMOTE_EXEC_HOSTS, JSON.stringify(validated));
    return validated;
  };

  const getExecHost = async (id: string): Promise<ExecHostConfig | null> => {
    const hosts = await listExecHosts();
    return hosts.find((host) => host.id === id) ?? null;
  };

  const createSshExecHostForTask = (
    config: ExecHostConfig,
    input: CreateSshExecHostForTaskInput,
  ): SshExecHost => {
    const remoteWorkdir = remoteWorkdirForTask(config, input.taskId);
    return new SshExecHost(config, {
      pathMap: [{ local: input.worktreePath, remote: remoteWorkdir }],
    });
  };

  const resolveStepExecHost = async (
    execHostId: string | undefined,
    input: CreateSshExecHostForTaskInput,
  ): Promise<ResolvedStepExecHost | null> => {
    if (!execHostId) return null;
    const config = await getExecHost(execHostId);
    if (!config) {
      throw new Error(
        `Execution host "${execHostId}" is not configured. ` +
          "Add it under Settings → Execution hosts, or clear Runs on for this runtime profile.",
      );
    }
    return { config, host: createSshExecHostForTask(config, input) };
  };

  const testExecHost = async (id: string): Promise<ExecHostTestResult> => {
    const config = await getExecHost(id);
    if (!config) {
      return unreachableResult(`Execution host not found: ${id}`);
    }

    const host = options.createProbeHost?.(config) ?? new SshExecHost(config, { pathMap: [] });
    const started = performance.now();
    const reachability = await probeReachability(host);
    const latencyMs = Math.round(performance.now() - started);
    if (!reachability.ok) {
      return { ...unreachableResult(reachability.error), latencyMs };
    }

    const [rsync, git] = await Promise.all([
      host.commandExists("rsync"),
      host.commandExists("git"),
    ]);
    const clis = await probeProviderClis(createProviderDoctorForHost(host));
    return { reachable: true, latencyMs, rsync, git, clis };
  };

  return {
    listExecHosts,
    saveExecHosts,
    getExecHost,
    createSshExecHostForTask,
    resolveStepExecHost,
    testExecHost,
  };
};

export const remoteWorkdirForTask = (config: ExecHostConfig, taskId: string): string => {
  const root = config.remoteRoot.replace(/\/+$/, "");
  return `${root}/${taskId}`;
};

const unreachableResult = (error: string): ExecHostTestResult => ({
  reachable: false,
  latencyMs: null,
  rsync: false,
  git: false,
  clis: [],
  error,
});

const probeReachability = async (
  host: ExecHost,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    const echo = host.shell("echo aop-ok", { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const exitCode = await echo.exited;
    const stdout =
      echo.stdout instanceof ReadableStream ? (await new Response(echo.stdout).text()).trim() : "";
    if (exitCode !== 0 || !stdout.includes("aop-ok")) {
      return { ok: false, error: "SSH connection failed or unexpected remote response" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Assign ids for hosts that arrive without one (dashboard create flow). */
export const ensureHostIds = (hosts: ExecHostUpsert[]): ExecHostConfig[] =>
  hosts.map((host) =>
    ExecHostConfigSchema.parse({
      ...host,
      id: host.id?.trim() ? host.id : generateTypeId("ehost"),
    }),
  );
