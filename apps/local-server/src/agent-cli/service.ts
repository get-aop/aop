import {
  type AgentCliStatus,
  type AgentClisResponse,
  type AgentCliUpdate,
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES,
  parseAgentCliCheckInterval,
} from "@aop/common";
import { getLogger } from "@aop/infra";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import { createCheckScheduler } from "./check-scheduler.ts";
import { AGENT_CLIS, type AgentCliDefinition } from "./definitions.ts";
import { detectUpdatePlan, formatCommand, type UpdatePlan } from "./install-method.ts";
import { fetchLatestCliVersion } from "./latest.ts";
import { type CliIdentity, readPermissionBypass } from "./permission-bypass.ts";
import { type CliProbe, messageOf, probeCli, runWithTimeout } from "./probe.ts";
import type { AgentCliRunRepository } from "./run-repository.ts";
import { checkWritable, runPlannedUpdate } from "./update-runner.ts";
import { isCliUpdateAvailable } from "./version.ts";

const logger = getLogger("agent-cli");

/** A probe (one `--version` spawn) is reused for this long by status reads. */
const PROBE_TTL_MS = 60_000;
const MANUAL_CHECK_COOLDOWN_MS = 15_000;
const DEFER_POLL_MS = 15_000;
const UPDATE_TIMEOUT_MS = 10 * 60_000;

export type UpdateRequestResult =
  | { ok: true }
  | { ok: false; status: 404 | 409 | 422; error: string; manualCommand: string | null };

export interface AgentCliService {
  status: () => Promise<AgentClisResponse>;
  /** Looks for new versions now (at most every few seconds, however often it is asked). */
  check: () => Promise<AgentClisResponse>;
  /** Starts an update in the background; the result shows in `status`. */
  update: (provider: string, trigger?: "manual" | "auto") => Promise<UpdateRequestResult>;
  /** Starts the periodic check (and the one shortly after boot). */
  start: () => void;
  stop: () => void;
}

export interface AgentCliServiceDeps {
  settings: SettingsRepository;
  runs: AgentCliRunRepository;
  definitions?: readonly AgentCliDefinition[];
  probe?: (definition: AgentCliDefinition) => Promise<CliProbe>;
  fetchLatest?: (definition: AgentCliDefinition, channel: string) => Promise<string>;
  runCommand?: (
    argv: string[],
    onOutput: (chunk: string) => void,
  ) => Promise<{ exitCode: number; output: string }>;
  isWritable?: (path: string) => Promise<boolean>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deferPollMs?: number;
  /** Test seam for the root check of the permission bypass; production reads the host's own. */
  identity?: CliIdentity;
}

interface CliState {
  latest: string | null;
  channel: string;
  checkedAt: string | null;
  checkError: string | null;
  probe: CliProbe | null;
  probedAt: number;
  update: AgentCliUpdate;
  /** Set from the moment an update is asked for until it ends, so a second request is refused. */
  busy: boolean;
}

/**
 * Keeps each agent CLI's installed and published versions and runs its updates. One update per
 * CLI at a time; what the person sees comes from `status`, which a dashboard polls.
 */
export const createAgentCliService = (deps: AgentCliServiceDeps): AgentCliService => {
  const definitions = deps.definitions ?? AGENT_CLIS;
  const now = deps.now ?? Date.now;
  const probe = deps.probe ?? ((definition: AgentCliDefinition) => probeCli(definition));
  const fetchLatest = deps.fetchLatest ?? defaultFetchLatest;
  const runCommand = deps.runCommand ?? defaultRunCommand;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));
  const states = new Map(definitions.map((definition) => [definition.provider, initialState()]));
  const stateOf = (definition: AgentCliDefinition): CliState =>
    states.get(definition.provider) ?? initialState();
  let lastManualCheckAt = Number.NEGATIVE_INFINITY;
  let stopped = false;

  const freshProbe = async (definition: AgentCliDefinition): Promise<CliProbe> => {
    const state = stateOf(definition);
    state.probe = await probe(definition);
    state.probedAt = now();
    return state.probe;
  };

  const cachedProbe = async (definition: AgentCliDefinition): Promise<CliProbe> => {
    const state = stateOf(definition);
    if (state.probe && now() - state.probedAt < PROBE_TTL_MS) return state.probe;
    return freshProbe(definition);
  };

  const checkOne = async (definition: AgentCliDefinition): Promise<boolean> => {
    const state = stateOf(definition);
    await freshProbe(definition);
    state.channel = await definition.readChannel();
    try {
      state.latest = await fetchLatest(definition, state.channel);
      state.checkError = null;
      state.checkedAt = new Date(now()).toISOString();
      return true;
    } catch (error) {
      state.checkError = messageOf(error);
      logger.warn("Agent CLI version check failed for {provider}: {error}", {
        provider: definition.provider,
        error: state.checkError,
      });
      return false;
    }
  };

  const checkAll = async (): Promise<boolean> => {
    const results = await Promise.all(definitions.map(checkOne));
    if (await readAutoUpdate(deps.settings)) await autoUpdate();
    return results.every(Boolean);
  };

  const autoUpdate = async (): Promise<void> => {
    for (const definition of definitions.filter((candidate) =>
      wantsAutoUpdate(stateOf(candidate)),
    )) {
      const result = await requestUpdate(definition, "auto");
      if (result.ok) continue;
      logger.warn("Automatic update of {provider} did not start: {error}", {
        provider: definition.provider,
        error: result.error,
      });
    }
  };

  const requestUpdate = async (
    definition: AgentCliDefinition,
    trigger: "manual" | "auto",
  ): Promise<UpdateRequestResult> => {
    const state = stateOf(definition);
    if (state.busy) {
      return refuse(409, `An update of ${definition.label} is already running`, null);
    }
    state.busy = true;
    try {
      const planned = await planUpdate(definition, state);
      if ("error" in planned) {
        state.busy = false;
        state.update = { ...state.update, ...rejected(trigger, state, planned) };
        return refuse(422, planned.error, planned.manualCommand);
      }
      state.update = started(trigger, state, planned.plan);
      void runInBackground(definition, state, planned.plan);
      return { ok: true };
    } catch (error) {
      state.busy = false;
      return refuse(422, messageOf(error), null);
    }
  };

  const planUpdate = async (
    definition: AgentCliDefinition,
    state: CliState,
  ): Promise<
    { plan: UpdatePlan & { command: string[] } } | { error: string; manualCommand: string | null }
  > => {
    const current = await freshProbe(definition);
    // The person may have switched channels since the last check.
    state.channel = await definition.readChannel();
    if (!current.path || !current.realPath) {
      return { error: `${definition.label} is not installed on the host`, manualCommand: null };
    }
    const plan = detectUpdatePlan(
      definition,
      { path: current.path, realPath: current.realPath },
      state.channel,
    );
    if (!plan.command) {
      const error = `AOP cannot tell how ${definition.label} was installed at ${current.realPath}`;
      return { error, manualCommand: plan.manualCommand };
    }
    const unwritable = await checkWritable(plan, current.realPath, deps.isWritable);
    if (unwritable) return { error: unwritable, manualCommand: plan.manualCommand };
    return { plan: { ...plan, command: plan.command } };
  };

  const runInBackground = async (
    definition: AgentCliDefinition,
    state: CliState,
    plan: UpdatePlan & { command: string[] },
  ): Promise<void> => {
    try {
      await runPlannedUpdate(
        { definition, plan, fromVersion: state.update.fromVersion, latest: state.latest },
        {
          activeRunCount: async () => (await deps.runs.activeRuns(definition.provider)).length,
          runCommand,
          reprobe: () => freshProbe(definition),
          onChange: (patch) => {
            state.update = { ...state.update, ...patch };
          },
          sleep,
          deferPollMs: deps.deferPollMs ?? DEFER_POLL_MS,
          isStopped: () => stopped,
        },
      );
      logger.info("Agent CLI update of {provider} ended {state}", {
        provider: definition.provider,
        state: state.update.state,
      });
    } finally {
      state.busy = false;
    }
  };

  const statusOf = async (definition: AgentCliDefinition): Promise<AgentCliStatus> => {
    const state = stateOf(definition);
    const current = await cachedProbe(definition);
    const runs = await deps.runs.activeRuns(definition.provider);
    const plan =
      current.path && current.realPath
        ? detectUpdatePlan(
            definition,
            { path: current.path, realPath: current.realPath },
            state.channel,
          )
        : null;
    return {
      provider: definition.provider,
      label: definition.label,
      command: definition.command,
      installed: current.path !== null,
      path: current.path,
      realPath: current.realPath,
      version: current.version,
      installMethod: plan?.method ?? null,
      updateCommand: plan?.command ? formatCommand(plan.command) : null,
      latest: state.latest,
      channel: state.channel,
      updateAvailable: isCliUpdateAvailable(state.latest, current.version),
      checkedAt: state.checkedAt,
      checkError: state.checkError ?? current.error,
      activeRuns: {
        count: runs.length,
        versions: await deps.runs.activeRunVersions(runs, definition.initVersionField),
      },
      lastRunVersion: await deps.runs.lastRunVersion(definition.provider),
      update: state.update,
    };
  };

  const status = async (): Promise<AgentClisResponse> => ({
    clis: await Promise.all(definitions.map(statusOf)),
    checkIntervalMinutes: await readCheckInterval(deps.settings),
    autoUpdate: await readAutoUpdate(deps.settings),
    skipPermissions: await readPermissionBypass(deps.settings, deps.identity),
  });

  const scheduler = createCheckScheduler({
    intervalMinutes: () => readCheckInterval(deps.settings),
    check: checkAll,
    now,
  });

  return {
    status,
    check: async () => {
      if (now() - lastManualCheckAt >= MANUAL_CHECK_COOLDOWN_MS) {
        lastManualCheckAt = now();
        await checkAll();
      }
      return status();
    },
    update: async (provider, trigger = "manual") => {
      const definition = definitions.find((candidate) => candidate.provider === provider);
      if (!definition) return refuse(404, `No agent CLI named ${provider}`, null);
      return requestUpdate(definition, trigger);
    },
    start: () => {
      stopped = false;
      scheduler.start();
    },
    stop: () => {
      stopped = true;
      scheduler.stop();
    },
  };
};

// An automatic update that failed for this version is not retried at every check.
const wantsAutoUpdate = (state: CliState): boolean => {
  if (state.busy || !isCliUpdateAvailable(state.latest, state.probe?.version ?? null)) return false;
  const { update } = state;
  return !(
    update.state === "failed" &&
    update.trigger === "auto" &&
    update.toVersion === state.latest
  );
};

export const readCheckInterval = async (settings: SettingsRepository): Promise<number> =>
  parseAgentCliCheckInterval(await settings.get(SettingKey.AGENT_CLI_CHECK_INTERVAL)) ??
  DEFAULT_AGENT_CLI_CHECK_INTERVAL_MINUTES;

const readAutoUpdate = async (settings: SettingsRepository): Promise<boolean> =>
  (await settings.get(SettingKey.AGENT_CLI_AUTO_UPDATE)) === "true";

const initialState = (): CliState => ({
  latest: null,
  channel: "latest",
  checkedAt: null,
  checkError: null,
  probe: null,
  probedAt: Number.NEGATIVE_INFINITY,
  busy: false,
  update: {
    state: "idle",
    trigger: null,
    startedAt: null,
    finishedAt: null,
    fromVersion: null,
    toVersion: null,
    deferredFor: 0,
    error: null,
    manualCommand: null,
    output: null,
  },
});

const started = (
  trigger: "manual" | "auto",
  state: CliState,
  plan: UpdatePlan,
): AgentCliUpdate => ({
  state: plan.safeWhileRunning ? "updating" : "waiting",
  trigger,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  fromVersion: state.probe?.version ?? null,
  toVersion: state.latest,
  deferredFor: 0,
  error: null,
  manualCommand: null,
  output: null,
});

const rejected = (
  trigger: "manual" | "auto",
  state: CliState,
  planned: { error: string; manualCommand: string | null },
): Partial<AgentCliUpdate> => ({
  state: "failed",
  trigger,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  fromVersion: state.probe?.version ?? null,
  toVersion: state.latest,
  deferredFor: 0,
  error: planned.error,
  manualCommand: planned.manualCommand,
  output: null,
});

const refuse = (
  status: 404 | 409 | 422,
  error: string,
  manualCommand: string | null,
): UpdateRequestResult => ({ ok: false, status, error, manualCommand });

const defaultFetchLatest = (definition: AgentCliDefinition, channel: string): Promise<string> =>
  fetchLatestCliVersion(definition, channel, {
    registry: process.env.AOP_AGENT_CLI_REGISTRY?.trim() || undefined,
  });

const defaultRunCommand = (argv: string[], onOutput: (chunk: string) => void) =>
  runWithTimeout(argv, UPDATE_TIMEOUT_MS, { onOutput });
