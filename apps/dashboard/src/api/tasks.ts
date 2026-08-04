import type {
  RepoBulkAction,
  RepoBulkActionResult,
  RuntimeEvent,
  TaskAssignmentFields,
} from "@aop/common";
import type {
  Agent,
  AgentCreateInput,
  AgentMemorySearchInput,
  AgentMemorySearchResponse,
  BoardColumn,
  Channel,
  ChatMessage,
  Execution,
  Metrics,
  Task,
} from "../types";
import { request } from "./request";

export const consumeSignalAsDraftTask = async (signalId: string): Promise<{ task: Task }> => {
  return request<{ signal: unknown; task: Task }>(`/signals/${signalId}/consume`, {
    method: "POST",
  });
};

export const getAgents = async (): Promise<Agent[]> => {
  const data = await request<{ agents: Agent[] }>("/agents");
  return data.agents;
};

export const createAgent = async (input: AgentCreateInput): Promise<Agent> => {
  if (input.integrationMode === "worker") {
    const data = await request<{ agent: Agent }>("/agents/workers", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        role: input.role,
        workflowId: input.workflowId,
        repoIds: input.repoIds,
        autoDistributeDisabled: input.autoDistributeDisabled,
        focus: input.focus,
      }),
    });

    return data.agent;
  }

  const data = await request<{ agent: Agent }>("/agents/manual", {
    method: "POST",
    body: JSON.stringify({
      name: input.name,
      role: input.role,
      runtimeProvider: input.runtimeProvider,
      model: input.model,
      workflowId: input.workflowId,
    }),
  });

  return syncAgentRepoMemberships(data.agent, input.repoIds);
};

export const duplicateAgent = async (source: Agent, newName: string): Promise<Agent> =>
  createAgent({
    integrationMode: "worker",
    name: newName,
    role: source.role,
    workflowId: source.workflowId ?? source.workflowName ?? "",
    repoIds: source.repoIds,
    autoDistributeDisabled: source.autoDistributeDisabled,
    focus: source.focus,
  });

export interface WorkerAgentUpdateInput {
  role: Agent["role"];
  workflowId: string;
  repoIds: string[];
  autoDistributeDisabled?: boolean;
  focus?: string | null;
}

export const updateWorkerAgent = async (
  agentId: string,
  input: WorkerAgentUpdateInput,
): Promise<Agent> => {
  const data = await request<{ agent: Agent }>(`/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({
      role: input.role,
      workflowId: input.workflowId,
      autoDistributeDisabled: input.autoDistributeDisabled,
      focus: input.focus,
    }),
  });

  return syncAgentRepoMemberships(data.agent, input.repoIds);
};

export const archiveWorkerAgent = async (agentId: string): Promise<Agent> => {
  const data = await request<{ agent: Agent }>(`/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "archived" }),
  });

  return data.agent;
};

export const getFactoryChannel = async (): Promise<Channel> => {
  const data = await request<{ channel: Channel }>("/channels/factory");
  return data.channel;
};

export const getChannelMessages = async (channelId: string): Promise<ChatMessage[]> => {
  const data = await request<{ messages: ChatMessage[] }>(`/channels/${channelId}/messages`);
  return data.messages;
};

export const sendChannelMessage = async (
  channelId: string,
  content: string,
): Promise<ChatMessage> => {
  const data = await request<{ message: ChatMessage }>(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  return data.message;
};

export const searchAgentMemory = async (
  input: AgentMemorySearchInput,
): Promise<AgentMemorySearchResponse> => {
  return request<AgentMemorySearchResponse>("/agent-memory/search", {
    method: "POST",
    body: JSON.stringify({
      ...(input.repoId ? { repoId: input.repoId } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      query: input.query,
      ...(input.limit ? { limit: input.limit } : {}),
    }),
  });
};

export const assignTaskAgent = async (
  repoId: string,
  taskId: string,
  agentId: string | null,
): Promise<{ taskId: string; assignedAgentId: string | null }> => {
  const data = await request<{ ok: boolean; taskId: string; assignedAgentId: string | null }>(
    `/repos/${repoId}/tasks/${taskId}/assignment`,
    {
      method: "PUT",
      body: JSON.stringify({ agentId }),
    },
  );

  return { taskId: data.taskId, assignedAgentId: data.assignedAgentId };
};

export const moveTaskToBoardColumn = async (
  repoId: string,
  taskId: string,
  boardColumn: BoardColumn,
  agentId: string | null,
): Promise<{
  taskId: string;
  boardColumn: BoardColumn;
  status: Task["status"];
  assignedAgentId: string;
}> => {
  const data = await request<{
    ok: boolean;
    taskId: string;
    boardColumn: BoardColumn;
    status: Task["status"];
    assignedAgentId: string;
  }>(`/repos/${repoId}/tasks/${taskId}/board-column`, {
    method: "PATCH",
    body: JSON.stringify({ column: boardColumn, agentId }),
  });

  return {
    taskId: data.taskId,
    boardColumn: data.boardColumn,
    status: data.status,
    assignedAgentId: data.assignedAgentId,
  };
};

export interface MarkReadyOptions {
  retryFromStep?: string;
}

export const markReady = async (
  repoId: string,
  taskId: string,
  optionsOrRetryFromStep?: string | MarkReadyOptions,
): Promise<{ taskId: string }> => {
  const options =
    typeof optionsOrRetryFromStep === "string"
      ? { retryFromStep: optionsOrRetryFromStep }
      : (optionsOrRetryFromStep ?? {});
  const body: Record<string, string> = {};
  if (options.retryFromStep) body.retryFromStep = options.retryFromStep;
  return request<{ ok: boolean; taskId: string }>(`/repos/${repoId}/tasks/${taskId}/ready`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

export const approveHandoff = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string }> => {
  return request<{ ok: boolean; taskId: string }>(
    `/repos/${repoId}/tasks/${taskId}/handoff/approve`,
    { method: "POST" },
  );
};

export const rejectHandoff = async (
  repoId: string,
  taskId: string,
  input: { action: "return_to_draft" | "block"; reason: string },
): Promise<{ taskId: string }> => {
  return request<{ ok: boolean; taskId: string }>(
    `/repos/${repoId}/tasks/${taskId}/handoff/reject`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
};

export const fetchExecutions = async (repoId: string, taskId: string): Promise<Execution[]> => {
  const data = await request<{ executions: Execution[] }>(
    `/repos/${repoId}/tasks/${taskId}/executions`,
  );
  return data.executions;
};

export const fetchRuntimeEvents = async (executionId: string): Promise<RuntimeEvent[]> => {
  const data = await request<{ events: RuntimeEvent[] }>(
    `/executions/${executionId}/runtime-events`,
  );
  return Array.isArray(data.events) ? data.events : [];
};

export interface StepUsageRecord {
  stepExecutionId: string;
  provider: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  durationMs: number | null;
}

export interface ExecutionUsage {
  usage: StepUsageRecord[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
  };
}

export const fetchExecutionUsage = async (executionId: string): Promise<ExecutionUsage> => {
  const data = await request<ExecutionUsage>(`/executions/${executionId}/usage`);
  if (!data.totals) return emptyExecutionUsage();
  return data;
};

const emptyExecutionUsage = (): ExecutionUsage => ({
  usage: [],
  totals: {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    durationMs: 0,
  },
});

const syncAgentRepoMemberships = async (agent: Agent, repoIds: string[]): Promise<Agent> => {
  if (repoIds.length === 0) {
    return agent;
  }

  const data = await request<{ repoIds: string[] }>(`/agents/${agent.id}/repos`, {
    method: "PUT",
    body: JSON.stringify({ repoIds }),
  });

  return {
    ...agent,
    repoIds: data.repoIds,
  };
};

export const removeTask = async (
  repoId: string,
  taskId: string,
  force = false,
): Promise<{ taskId: string; aborted: boolean }> => {
  const query = force ? "?force=true" : "";
  return request<{ ok: boolean; taskId: string; aborted: boolean }>(
    `/repos/${repoId}/tasks/${taskId}${query}`,
    { method: "DELETE" },
  );
};

export const blockTask = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string; agentKilled: boolean }> => {
  return request<{ ok: boolean; taskId: string; agentKilled: boolean }>(
    `/repos/${repoId}/tasks/${taskId}/block`,
    { method: "POST" },
  );
};

export const archiveTask = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string; archivedAt: string | null }> => {
  return request<{ ok: boolean; taskId: string; archivedAt: string | null }>(
    `/repos/${repoId}/tasks/${taskId}/archive`,
    { method: "POST" },
  );
};

export const unarchiveTask = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string; archivedAt: string | null }> => {
  return request<{ ok: boolean; taskId: string; archivedAt: string | null }>(
    `/repos/${repoId}/tasks/${taskId}/unarchive`,
    { method: "POST" },
  );
};

export const resetTaskExecution = async (
  repoId: string,
  taskId: string,
): Promise<{ taskId: string; aborted: boolean }> => {
  return request<{ ok: boolean; taskId: string; aborted: boolean }>(
    `/repos/${repoId}/tasks/${taskId}/reset`,
    { method: "POST" },
  );
};

export interface TaskPullRequestStatusResponse {
  success: true;
  branchName: string;
  hasPullRequest: boolean;
  pullRequestUrl: string | null;
  pullRequestNumber: number | null;
  pullRequestState: string | null;
  baseRefName?: string | null;
  needsBranchUpdate?: boolean;
  baseBehindCount?: number;
  checksState: "pending" | "success" | "failure" | null;
}

/** Read-only PR status for Pool cards. Mutations happen via chat, not the dashboard. */
export const getTaskPullRequestStatus = async (
  repoId: string,
  taskId: string,
): Promise<TaskPullRequestStatusResponse> => {
  return request<TaskPullRequestStatusResponse>(`/repos/${repoId}/tasks/${taskId}/pull-request`);
};

export const getMetrics = async (repoId?: string): Promise<Metrics> => {
  const query = repoId ? `?repoId=${repoId}` : "";
  return request<Metrics>(`/metrics${query}`);
};

export const fetchChangeFiles = async (repoId: string, taskId: string): Promise<string[]> => {
  const data = await request<{ files: string[] }>(`/repos/${repoId}/tasks/${taskId}/files`);
  return data.files;
};

export const fetchChangeFile = async (
  repoId: string,
  taskId: string,
  path: string,
): Promise<string> => {
  const data = await request<{ content: string }>(
    `/repos/${repoId}/tasks/${taskId}/files/${encodeURIComponent(path)}`,
  );
  return data.content;
};

export const confirmTaskAssignment = async (
  proposal: TaskAssignmentFields,
  mode: "assign" | "start",
  source?: { sessionId: string; messageId: string },
): Promise<{ ok: boolean; taskIds: string[] }> =>
  request<{ ok: boolean; taskIds: string[] }>("/mcp/confirm/task-assignment", {
    method: "POST",
    body: JSON.stringify({ proposal, mode, ...source }),
  });

export const confirmTaskBatchRow = async (
  input: {
    repoId: string;
    taskId: string;
    outcome: "backlog" | "assigned" | "started";
    workerId?: string | null;
    workflowId?: string | null;
    workflowName?: string | null;
  },
  source?: { sessionId: string; messageId: string },
): Promise<{ ok: boolean; taskId: string }> =>
  request<{ ok: boolean; taskId: string }>("/mcp/confirm/task-batch-row", {
    method: "POST",
    body: JSON.stringify({ ...input, ...source }),
  });

export const runRepoBulkAction = async (
  repoId: string,
  action: RepoBulkAction,
): Promise<RepoBulkActionResult> => {
  return request(`/repos/${repoId}/tasks/bulk/${action}`, { method: "POST" });
};
