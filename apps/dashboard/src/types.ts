import type { DashboardTask, TaskStatus } from "@aop/common";

export type BoardColumn = "DRAFT" | "READY" | "IN_PROGRESS" | "DONE";

export interface Agent {
  id: string;
  name: string;
  role: "architect" | "developer" | "reviewer" | "custom";
  runtimeProvider: "pi" | string;
  provider?: string | null;
  model: string;
  workflowId?: string | null;
  workflowName?: string | null;
  repoIds: string[];
  status: "active" | "archived";
  privateChannelId?: string | null;
  sourceKind?: string | null;
  sourceRef?: string | null;
  autoDistributeDisabled?: boolean;
  focus?: string | null;
}

export interface Channel {
  id: string;
  repoId: string | null;
  ownerAgentId?: string | null;
  kind: "group" | "private";
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  authorType: "user" | "agent" | "system";
  authorAgentId?: string | null;
  content: string;
  createdAt: string;
}

interface BaseAgentCreateInput {
  name: string;
  role: Agent["role"];
  workflowId: string;
  repoIds: string[];
  autoDistributeDisabled?: boolean;
  focus?: string | null;
}

export type AgentCreateInput =
  | (BaseAgentCreateInput & {
      integrationMode: "worker";
    })
  | (BaseAgentCreateInput & {
      integrationMode: "manual";
      runtimeProvider: "hermes";
      model: string;
    });

export interface AgentMemorySearchInput {
  repoId?: string | null;
  agentId?: string | null;
  taskId?: string | null;
  query: string;
  limit?: number;
}

export interface AgentMemorySearchResult {
  agentId: string;
  agentName: string;
  repoId: string;
  repoName: string | null;
  snippet: string;
}

export interface AgentMemorySearchResponse {
  enabled: boolean;
  results: AgentMemorySearchResult[];
}

export type Task = DashboardTask & {
  assignedAgentId?: string | null;
  assignedAgentName?: string | null;
  boardColumn?: BoardColumn;
  repoIds?: string[];
};

export interface Repo {
  id: string;
  path: string;
  name: string | null;
}

export type StepStatus = "running" | "success" | "failure" | "cancelled";

export interface Step {
  id: string;
  stepId?: string;
  stepType: string | null;
  status: StepStatus;
  signal?: string | null;
  startedAt: string;
  endedAt?: string;
  error?: string;
}

export interface Execution {
  id: string;
  taskId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  steps: Step[];
}

export interface Metrics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  successRate: number;
  avgDurationMs: number;
  avgFailedDurationMs: number;
}

export type ConnectionState = "disconnected" | "idle" | "working";
