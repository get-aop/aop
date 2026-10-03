import { hostname } from "node:os";
import {
  BUILT_IN_RUNTIME_ID,
  buildChannel,
  type CuaLeaseState,
  type UpdateInstallMode,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import { runWithTimeout } from "../agent-cli/probe.ts";
import type { ComputerUseService } from "../computer-use/service.ts";
import { runComputerUseSetup, type SetupIO } from "../computer-use/setup/run-setup.ts";
import { hostSystem } from "../computer-use/setup/system.ts";
import type { LocalServerContext } from "../context.ts";
import type { GithubService } from "../github/index.ts";
import { readDefaultRuntimeId } from "../runtime-configuration/default-runtime.ts";
import { hostRuntimeReadiness, type RuntimeReadiness } from "../runtime-configuration/readiness.ts";
import { createRuntimeConfigurationRepository } from "../runtime-configuration/repository.ts";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import { hostBuild } from "../update/host-build.ts";
import { shortHostName } from "../update/host-update-service.ts";
import { layoutOf, selfUpdateBlock } from "../update/install-layout.ts";
import { detectRestartPlan, launchdLabelOf } from "../update/restart.ts";
import { systemPlanInput } from "../update/system.ts";
import type {
  ClaudeLook,
  HostFacts,
  HostSetupProbes,
  ServeLook,
  ServiceLook,
  UpdatesLook,
} from "./probes.ts";
import { parseServeStatus } from "./reachable-check.ts";
import { createHostSetupService, type HostSetupService } from "./service.ts";

const logger = getLogger("host-setup");

const TAILSCALE_TIMEOUT_MS = 5_000;

export interface HostSetupSources {
  ctx: LocalServerContext;
  github: GithubService;
  computerUse: ComputerUseService;
  lease: () => CuaLeaseState;
  port: number;
  startTimeMs: number;
  readiness?: RuntimeReadiness;
  env?: NodeJS.ProcessEnv;
}

/** The checklist of the host this process is. */
export const createHostSetup = (sources: HostSetupSources): HostSetupService =>
  createHostSetupService({ probes: createHostProbes(sources), facts: hostFacts(sources) });

export const hostFacts = (
  sources: Pick<HostSetupSources, "port" | "startTimeMs" | "env">,
): HostFacts => ({
  hostName: shortHostName(hostname()),
  os: process.platform,
  channel: buildChannel(),
  version: hostBuild(sources.env).version,
  port: sources.port,
  uptimeSeconds: () => (Date.now() - sources.startTimeMs) / 1000,
});

export const createHostProbes = (sources: HostSetupSources): HostSetupProbes => {
  const { ctx, env = process.env } = sources;
  const readiness = sources.readiness ?? hostRuntimeReadiness();
  return {
    service: () => detectService(env),
    serve: () => readServe(sources.port),
    claude: (fresh) => readClaude(ctx, readiness, fresh),
    github: (fresh) => sources.github.authStatus({ fresh }),
    computerUse: async (fresh) => ({
      status: await sources.computerUse.cuaStatus({ fresh }),
      lease: sources.lease(),
      wanted: (await ctx.projectRepository.list()).some((project) => project.computerUse === "cua"),
    }),
    updates: () => readUpdates(ctx.settingsRepository, env),
    setupComputerUse: () =>
      runComputerUseSetup(
        { noSudo: true, command: buildChannel().binaryName },
        {
          sys: hostSystem(),
          io: logIO,
          probe: () => sources.computerUse.cuaStatus({ fresh: true }),
        },
      ),
  };
};

/**
 * When the host installs a new build by itself. Reads the one setting this build has for it:
 * AOP Nightly installs when idle while `update_auto_apply` is on, and Stable always asks. Kept to
 * this one function so the `update_install` setting (ask | idle | window) replaces it here.
 */
export const readUpdateInstall = async (
  settings: SettingsRepository,
): Promise<{ mode: UpdateInstallMode; window: string | null }> => {
  if (buildChannel().id !== "nightly") return { mode: "ask", window: null };
  const autoApply = await settings.get(SettingKey.UPDATE_AUTO_APPLY);
  return { mode: autoApply === "true" ? "idle" : "ask", window: null };
};

// Read on each look: a service can be installed while the host runs.
const detectService = async (env: NodeJS.ProcessEnv): Promise<ServiceLook> => {
  const block = selfUpdateBlock(process.execPath, env.AOP_BUILD_VERSION);
  if (block === "source" || block === "app") return { kind: block };
  const plan = await detectRestartPlan({
    ...systemPlanInput(env),
    layout: layoutOf(process.execPath),
  });
  switch (plan.kind) {
    case "systemd":
      return { kind: "systemd", unit: plan.unit };
    case "launchd":
      return { kind: "launchd", label: launchdLabelOf() };
    default:
      return { kind: plan.kind, binaryPath: process.execPath };
  }
};

// No tailscale, or a tailscaled that is down, both mean nothing publishes the host.
const readServe = async (port: number): Promise<ServeLook> => {
  let result: { exitCode: number; output: string };
  try {
    result = await runWithTimeout(["tailscale", "serve", "status", "--json"], TAILSCALE_TIMEOUT_MS);
  } catch (error) {
    const missing = /ENOENT|not found|No such file/i.test(String(error));
    return { tailscale: !missing, addresses: [], httpsDefaultTaken: false };
  }
  if (result.exitCode !== 0) return { tailscale: true, addresses: [], httpsDefaultTaken: false };
  return { tailscale: true, ...parseServeStatus(parseJson(result.output), port) };
};

const readClaude = async (
  ctx: LocalServerContext,
  readiness: RuntimeReadiness,
  fresh: boolean,
): Promise<ClaudeLook | null> => {
  const runtimes = createRuntimeConfigurationRepository(ctx.db);
  const provider = await runtimes.get(BUILT_IN_RUNTIME_ID);
  if (!provider) return null;
  const [status, defaultId] = await Promise.all([
    readiness.check(provider, { fresh }),
    readDefaultRuntimeId(ctx, runtimes),
  ]);
  return { status, isDefault: defaultId === BUILT_IN_RUNTIME_ID };
};

const readUpdates = async (
  settings: SettingsRepository,
  env: NodeJS.ProcessEnv,
): Promise<UpdatesLook> => {
  const block = selfUpdateBlock(process.execPath, env.AOP_BUILD_VERSION);
  const install = await readUpdateInstall(settings);
  return {
    checking: (await settings.get(SettingKey.UPDATE_CHECK)) === "true",
    ...install,
    block: block === "source" || block === "app" ? block : null,
  };
};

// The fix runs without anyone at a terminal: no questions, no sudo, its lines go to the log.
const logIO: SetupIO = {
  print: (line) => logger.info("computer-use setup: {line}", { line }),
  interactive: false,
  confirm: async (_question, fallback) => fallback,
};

const parseJson = (output: string): unknown => {
  try {
    // stdout then stderr: the JSON is the outermost braces.
    return JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
};
