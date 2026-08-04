import type { WorkflowRuntimeReasoning } from "@aop/common";
import { request } from "./request";

export const getWorkflows = async (): Promise<string[]> => {
  const data = await request<{ workflows: string[] }>("/workflows");
  return data.workflows;
};

export interface WorkflowSummaryStep {
  id: string;
  type: string;
  promptTemplate: string;
  maxAttempts: number;
  signals?: { name: string; description: string }[];
  transitions: WorkflowTransition[];
  agent?: WorkflowStepAgent;
  verifyCommands?: string[];
  checkerStep?: boolean;
}

export type WorkflowConnectionHandle =
  | "top-left"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom-left"
  | "left";

export interface WorkflowCanvasEdgeConnection {
  sourceHandle?: WorkflowConnectionHandle;
  targetHandle?: WorkflowConnectionHandle;
}

export interface WorkflowCanvasLayout {
  version: 1;
  nodes: Record<string, { x: number; y: number }>;
  edges?: Record<string, WorkflowCanvasEdgeConnection>;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  version: number;
  active: boolean;
  source: "builtin" | "user";
  stepCount: number;
  steps: WorkflowSummaryStep[];
  canvas?: WorkflowCanvasLayout;
}

export interface StepLibraryBlock {
  id: string;
  type: string;
  category: "general" | "backend" | "frontend" | "business" | "research";
  description: string;
  signals: { name: string; description: string }[];
  promptTemplate: string;
  promptContent?: string;
  defaults: { maxAttempts: number };
  agent?: WorkflowStepAgent;
  source?: "builtin" | "user" | "local";
}

export type WorkflowStepProvider = "claude-code" | "codex-cli" | "grok-build" | "pi" | "opencode";
export type WorkflowStepReasoning = WorkflowRuntimeReasoning;

export interface WorkflowStepAgent {
  provider: WorkflowStepProvider;
  runtimeConfigurationId?: string;
  model: string;
  reasoning: WorkflowStepReasoning;
  fastMode?: boolean;
  ultracode?: boolean;
  browserControl?: boolean;
  computerControl?: boolean;
  runtimeAlias?: string;
}

export interface WorkflowTransition {
  condition: string;
  target: string;
  maxIterations?: number;
  onMaxIterations?: string;
  afterIteration?: number;
  thenTarget?: string;
}

export interface WorkflowStepSaveInput {
  id?: string;
  skillId: string;
  maxAttempts?: number;
  transitions?: WorkflowTransition[];
  agent?: WorkflowStepAgent;
  verifyCommands?: string[];
  checkerStep?: boolean;
}

export interface SkillBlockSaveInput {
  id: string;
  type: string;
  category: StepLibraryBlock["category"];
  description: string;
  signals: { name: string; description: string }[];
  promptTemplate: string;
  defaults: { maxAttempts: number };
}

export const getWorkflowDetails = async (): Promise<WorkflowSummary[]> => {
  const data = await request<{ workflows: WorkflowSummary[] }>("/workflows/details");
  return data.workflows;
};

export const getStepLibrary = async (): Promise<StepLibraryBlock[]> => {
  const data = await request<{ steps: StepLibraryBlock[] }>("/workflows/step-library");
  return data.steps;
};

export const saveWorkflow = async (input: {
  sourceWorkflowId?: string;
  name: string;
  stepIds?: string[];
  steps?: WorkflowStepSaveInput[];
  canvas?: WorkflowCanvasLayout;
}): Promise<WorkflowSummary> => {
  const data = await request<{ workflow: WorkflowSummary }>("/workflows", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.workflow;
};

export const deleteWorkflow = async (id: string): Promise<void> => {
  await request(`/workflows/${encodeURIComponent(id)}`, { method: "DELETE" });
};

export const saveSkillBlock = async (input: SkillBlockSaveInput): Promise<StepLibraryBlock> => {
  const data = await request<{ step: StepLibraryBlock }>("/workflows/step-library", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.step;
};

export const deleteSkillBlock = async (id: string): Promise<void> => {
  await request(`/workflows/step-library/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
};
