const DEFAULT_AGENTMEMORY_URL = "http://127.0.0.1:3111";
const DEFAULT_TOKEN_BUDGET = 2000;

export interface WorkerMemoryRecallInput {
  workerId: string | null;
  repoId: string;
  repoPath: string;
  worktreePath: string;
  taskId: string;
  executionId: string;
  stepId: string;
  changePath: string;
  prompt: string;
}

export interface WorkerMemoryCompletionInput {
  workerId: string | null;
  repoId: string;
  repoPath: string;
  worktreePath: string;
  taskId: string;
  executionId: string;
  stepId: string;
  changePath: string;
  stepType: string;
  status: "success" | "failure";
  sessionId?: string;
}

export interface WorkerMemory {
  recall(input: WorkerMemoryRecallInput): Promise<string | null>;
  recordCompletion(input: WorkerMemoryCompletionInput): Promise<void>;
}

export interface AgentMemorySearchTarget {
  agentId: string;
  agentName: string;
  repoId: string;
  repoName: string | null;
  repoPath: string;
}

export interface AgentMemorySearchInput {
  targets: AgentMemorySearchTarget[];
  taskId?: string | null;
  changePath?: string | null;
  query?: string | null;
  limit?: number;
}

export interface AgentMemorySearchResult {
  agentId: string;
  agentName: string;
  repoId: string;
  repoName: string | null;
  snippet: string;
}

interface AgentMemoryConfig {
  enabled: boolean;
  baseUrl: string;
  secret: string | null;
  tokenBudget: number;
}

interface AgentMemoryResponse {
  context?: unknown;
  results?: unknown;
  memories?: unknown;
  observations?: unknown;
}

export const createAgentMemoryWorkerMemory = (config = readAgentMemoryConfig()): WorkerMemory => ({
  recall: async (input) => {
    if (!config.enabled) return null;

    const sessionId = buildWorkerMemorySessionId(input.workerId, input.executionId, input.stepId);
    const sessionContext = await postAgentMemory<AgentMemoryResponse>(
      config,
      "/agentmemory/session/start",
      {
        sessionId,
        project: input.repoId,
        cwd: input.worktreePath,
        title: input.changePath,
      },
    );

    const searchContext = await postAgentMemory<AgentMemoryResponse>(
      config,
      "/agentmemory/search",
      {
        query: buildRecallQuery(input),
        project: input.repoId,
        cwd: input.repoPath,
        format: "compact",
        token_budget: config.tokenBudget,
        limit: 5,
      },
    );

    const sections = [extractMemoryText(sessionContext), extractMemoryText(searchContext)].filter(
      (section): section is string => section.length > 0,
    );

    return sections.length > 0 ? formatWorkerMemoryContext(sections) : null;
  },

  recordCompletion: async (input) => {
    if (!config.enabled) return;

    const sessionId = buildWorkerMemorySessionId(input.workerId, input.executionId, input.stepId);
    await postAgentMemory(config, "/agentmemory/observe", {
      hookType: "AOPStepComplete",
      sessionId,
      project: input.repoId,
      cwd: input.worktreePath,
      timestamp: new Date().toISOString(),
      data: {
        workerId: input.workerId,
        taskId: input.taskId,
        executionId: input.executionId,
        stepId: input.stepId,
        stepType: input.stepType,
        changePath: input.changePath,
        status: input.status,
        runtimeSessionId: input.sessionId,
      },
    });
    await postAgentMemory(config, "/agentmemory/session/end", { sessionId });
  },
});

export const isAgentMemoryEnabled = (config = readAgentMemoryConfig()): boolean => config.enabled;

export const searchAgentMemory = async (
  input: AgentMemorySearchInput,
  config = readAgentMemoryConfig(),
): Promise<AgentMemorySearchResult[]> => {
  if (!config.enabled) return [];

  const limit = clampSearchLimit(input.limit);
  const results = await Promise.all(
    input.targets.map(async (target): Promise<AgentMemorySearchResult | null> => {
      const response = await postAgentMemory<AgentMemoryResponse>(config, "/agentmemory/search", {
        query: buildSearchQuery(input, target),
        project: target.repoId,
        cwd: target.repoPath,
        format: "compact",
        token_budget: config.tokenBudget,
        limit,
      });
      const snippet = extractMemoryText(response);

      return snippet.length > 0
        ? {
            agentId: target.agentId,
            agentName: target.agentName,
            repoId: target.repoId,
            repoName: target.repoName,
            snippet,
          }
        : null;
    }),
  );

  return results.filter((result): result is AgentMemorySearchResult => result !== null);
};

export const buildWorkerMemorySessionId = (
  workerId: string | null,
  executionId: string,
  stepId: string,
): string =>
  `aop-worker-${sanitizeIdPart(workerId ?? "unassigned")}-${sanitizeIdPart(executionId)}-${sanitizeIdPart(stepId)}`;

export const formatWorkerMemoryContext = (sections: string[]): string =>
  [
    "## Worker Memory Context",
    "",
    "Treat this as heuristic context. Verify it against the current repo before acting.",
    "",
    ...sections.flatMap((section, index) => (index === 0 ? [section] : ["", section])),
  ].join("\n");

const readAgentMemoryConfig = (): AgentMemoryConfig => {
  const provider = process.env.AOP_WORKER_MEMORY_PROVIDER?.trim().toLowerCase();
  const baseUrl = normalizeBaseUrl(
    process.env.AOP_AGENTMEMORY_URL?.trim() ||
      process.env.AGENTMEMORY_URL?.trim() ||
      DEFAULT_AGENTMEMORY_URL,
  );
  return {
    enabled: provider === "agentmemory",
    baseUrl,
    secret: process.env.AOP_AGENTMEMORY_SECRET ?? process.env.AGENTMEMORY_SECRET ?? null,
    tokenBudget: readPositiveInt(process.env.AOP_WORKER_MEMORY_TOKEN_BUDGET, DEFAULT_TOKEN_BUDGET),
  };
};

const buildRecallQuery = (input: WorkerMemoryRecallInput): string =>
  [
    `Worker: ${input.workerId ?? "unassigned"}`,
    `Task: ${input.taskId}`,
    `Change path: ${input.changePath}`,
    input.prompt,
  ].join("\n");

const buildSearchQuery = (input: AgentMemorySearchInput, target: AgentMemorySearchTarget): string =>
  [
    `Worker: ${target.agentId}`,
    `Agent: ${target.agentName}`,
    input.taskId ? `Task: ${input.taskId}` : null,
    input.changePath ? `Change path: ${input.changePath}` : null,
    input.query?.trim() || null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");

const postAgentMemory = async <T = unknown>(
  config: AgentMemoryConfig,
  path: string,
  body: unknown,
): Promise<T> => {
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(config.secret ? { authorization: `Bearer ${config.secret}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`agentmemory ${path} failed with HTTP ${response.status}`);
  }

  return (await response.json()) as T;
};

const extractMemoryText = (response: AgentMemoryResponse): string => {
  const candidates = [response.context, response.results, response.memories, response.observations];
  return candidates.map(renderMemoryValue).filter(Boolean).join("\n\n").trim();
};

const renderMemoryValue = (value: unknown): string => {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(renderMemoryValue).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["content", "text", "summary", "narrative", "context"]) {
    const rendered = renderMemoryValue(record[key]);
    if (rendered) return rendered;
  }
  return "";
};

const sanitizeIdPart = (value: string): string => {
  const sanitized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
};

const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/, "");

const clampSearchLimit = (limit: number | undefined): number => {
  if (!Number.isInteger(limit) || !limit || limit < 1) return 5;
  return Math.min(limit, 10);
};

const readPositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};
