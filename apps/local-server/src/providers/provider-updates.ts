import { realpath } from "node:fs/promises";
import { buildSpawnEnv } from "@aop/infra";

export type ProviderUpdateId = "claude-code" | "codex-cli" | "grok-build" | "opencode" | "pi";

export type ProviderUpdateStatus =
  | "idle"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface ProviderUpdateState {
  status: ProviderUpdateStatus;
  startedAt: string | null;
  finishedAt: string | null;
  message: string | null;
}

interface ProviderUpdateDefinition {
  id: ProviderUpdateId;
  command: string;
  npmPackage: string;
  brewFormula: string | null;
  nativeArgs: string[] | null;
}

interface ProviderUpdateRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProviderUpdateServiceDeps {
  which: (command: string) => string | null;
  realpath: (path: string) => Promise<string>;
  run: (command: string[]) => Promise<ProviderUpdateRunResult>;
}

export interface ProviderUpdateService {
  getStates: () => Record<ProviderUpdateId, ProviderUpdateState>;
  startAll: () => Promise<{ accepted: boolean }>;
  waitForIdle: () => Promise<void>;
}

const PROVIDERS: ProviderUpdateDefinition[] = [
  {
    id: "claude-code",
    command: "claude",
    npmPackage: "@anthropic-ai/claude-code",
    brewFormula: "claude-code",
    nativeArgs: ["update"],
  },
  {
    id: "codex-cli",
    command: "codex",
    npmPackage: "@openai/codex",
    brewFormula: "codex",
    nativeArgs: null,
  },
  {
    id: "grok-build",
    command: "grok",
    npmPackage: "@xai-official/grok",
    brewFormula: null,
    nativeArgs: ["update"],
  },
  {
    id: "opencode",
    command: "opencode",
    npmPackage: "opencode-ai",
    brewFormula: "anomalyco/tap/opencode",
    nativeArgs: ["upgrade"],
  },
  {
    id: "pi",
    command: "pi",
    npmPackage: "@earendil-works/pi-coding-agent",
    brewFormula: null,
    nativeArgs: ["update", "--self"],
  },
];

const UPDATE_TIMEOUT_MS = 5 * 60 * 1_000;
const MAX_MESSAGE_LENGTH = 2_000;

export const resolveProviderUpdateCommand = (
  providerId: ProviderUpdateId,
  binaryPath: string,
  resolvedPath: string,
): string[] | null => {
  const provider = PROVIDERS.find((candidate) => candidate.id === providerId);
  if (!provider) return null;

  const normalized = resolvedPath.replaceAll("\\", "/").toLowerCase();
  if (normalized.includes("/.bun/")) {
    return ["bun", "install", "-g", `${provider.npmPackage}@latest`];
  }
  if (normalized.includes("/.local/share/pnpm/") || normalized.includes("/pnpm/")) {
    return ["pnpm", "add", "-g", `${provider.npmPackage}@latest`];
  }
  if (normalized.includes("/node_modules/")) {
    return ["npm", "install", "-g", `${provider.npmPackage}@latest`];
  }
  if (normalized.includes("/cellar/")) {
    return provider.brewFormula ? ["brew", "upgrade", provider.brewFormula] : null;
  }
  return provider.nativeArgs ? [binaryPath, ...provider.nativeArgs] : null;
};

export const createProviderUpdateService = (
  deps: ProviderUpdateServiceDeps = defaultDeps(),
): ProviderUpdateService => {
  let states = createIdleStates();
  let activeJob: Promise<void> | null = null;
  let starting = false;

  const startAll = async (): Promise<{ accepted: boolean }> => {
    if (activeJob || starting) return { accepted: false };
    starting = true;

    try {
      const { queued, nextStates } = await prepareUpdates(deps);
      states = nextStates;

      activeJob = runQueuedUpdates(queued, deps, (id, state) => {
        states = { ...states, [id]: state };
      }).finally(() => {
        activeJob = null;
      });
      return { accepted: true };
    } finally {
      starting = false;
    }
  };

  return {
    getStates: () => structuredClone(states),
    startAll,
    waitForIdle: async () => {
      await activeJob;
    },
  };
};

const prepareUpdates = async (
  deps: ProviderUpdateServiceDeps,
): Promise<{
  queued: Array<{ provider: ProviderUpdateDefinition; command: string[] }>;
  nextStates: Record<ProviderUpdateId, ProviderUpdateState>;
}> => {
  const queued: Array<{ provider: ProviderUpdateDefinition; command: string[] }> = [];
  const nextStates = createIdleStates();
  for (const provider of PROVIDERS) {
    const binaryPath = deps.which(provider.command);
    if (!binaryPath) {
      nextStates[provider.id] = terminalState("skipped", "CLI not installed");
      continue;
    }
    const resolvedPath = await deps.realpath(binaryPath).catch(() => binaryPath);
    const command = resolveProviderUpdateCommand(provider.id, binaryPath, resolvedPath);
    if (!command) {
      nextStates[provider.id] = terminalState("skipped", "Update method not detected");
      continue;
    }
    nextStates[provider.id] = {
      status: "queued",
      startedAt: null,
      finishedAt: null,
      message: null,
    };
    queued.push({ provider, command });
  }
  return { queued, nextStates };
};

const runQueuedUpdates = async (
  queued: Array<{ provider: ProviderUpdateDefinition; command: string[] }>,
  deps: ProviderUpdateServiceDeps,
  setState: (id: ProviderUpdateId, state: ProviderUpdateState) => void,
): Promise<void> => {
  for (const item of queued) {
    await runSingleUpdate(item, deps, setState);
  }
};

const runSingleUpdate = async (
  item: { provider: ProviderUpdateDefinition; command: string[] },
  deps: ProviderUpdateServiceDeps,
  setState: (id: ProviderUpdateId, state: ProviderUpdateState) => void,
): Promise<void> => {
  const startedAt = new Date().toISOString();
  setState(item.provider.id, {
    status: "running",
    startedAt,
    finishedAt: null,
    message: null,
  });
  try {
    const result = await deps.run(item.command);
    const message = trimMessage(
      result.exitCode === 0
        ? result.stdout || "Update completed"
        : result.stderr || result.stdout || `Update exited with code ${result.exitCode}`,
    );
    setState(item.provider.id, {
      status: result.exitCode === 0 ? "succeeded" : "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      message,
    });
  } catch (error) {
    setState(item.provider.id, {
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      message: trimMessage(error instanceof Error ? error.message : "Update failed"),
    });
  }
};

const createIdleStates = (): Record<ProviderUpdateId, ProviderUpdateState> =>
  Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider.id,
      { status: "idle", startedAt: null, finishedAt: null, message: null },
    ]),
  ) as Record<ProviderUpdateId, ProviderUpdateState>;

const terminalState = (
  status: Extract<ProviderUpdateStatus, "skipped">,
  message: string,
): ProviderUpdateState => ({
  status,
  startedAt: null,
  finishedAt: new Date().toISOString(),
  message,
});

const trimMessage = (message: string): string => message.trim().slice(-MAX_MESSAGE_LENGTH);

function defaultDeps(): ProviderUpdateServiceDeps {
  const env = buildSpawnEnv();
  return {
    which: (command) => Bun.which(command, { PATH: env.PATH }),
    realpath,
    run: runUpdateCommand,
  };
}

async function runUpdateCommand(command: string[]): Promise<ProviderUpdateRunResult> {
  const proc = Bun.spawn({
    cmd: command,
    env: buildSpawnEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeout = setTimeout(() => proc.kill(), UPDATE_TIMEOUT_MS);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  } finally {
    clearTimeout(timeout);
  }
}

export const providerUpdateService = createProviderUpdateService();
