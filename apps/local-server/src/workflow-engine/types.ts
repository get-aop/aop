import { StepAgentSchema as BaseStepAgentSchema, validateWorkflowRuntimeAgent } from "@aop/common";
import { z } from "zod";

export const StepType = {
  IMPLEMENT: "implement",
  TEST: "test",
  REVIEW: "review",
  DEBUG: "debug",
  ITERATE: "iterate",
  RESEARCH: "research",
} as const;

export type StepType = (typeof StepType)[keyof typeof StepType];

const StepTypeEnum = z.enum(["implement", "test", "review", "debug", "iterate", "research"]);

export const StepAgentSchema = BaseStepAgentSchema.superRefine((agent, ctx) => {
  validateWorkflowRuntimeAgent(agent, ctx);
});

export type StepAgent = z.infer<typeof StepAgentSchema>;

export const TransitionCondition = {
  SUCCESS: "success",
  FAILURE: "failure",
  NONE: "__none__",
} as const;

export type TransitionCondition = (typeof TransitionCondition)[keyof typeof TransitionCondition];

export const TransitionSchema = z.object({
  condition: z.string(),
  target: z.string(),
  maxIterations: z.number().int().positive().optional(),
  onMaxIterations: z.string().optional(),
  afterIteration: z.number().int().nonnegative().optional(),
  thenTarget: z.string().optional(),
});

export type Transition = z.infer<typeof TransitionSchema>;

export const WorkflowStepSchema = z.object({
  id: z.string(),
  type: StepTypeEnum,
  promptTemplate: z.string(),
  maxAttempts: z.number().int().positive().default(1),
  agent: StepAgentSchema.optional(),
  transitions: z.array(TransitionSchema),
  signals: z.array(z.object({ name: z.string(), description: z.string() })).optional(),
  verifyCommands: z.array(z.string().min(1)).optional(),
  checkerStep: z.boolean().optional(),
  isolation: z.enum(["hermetic", "open"]).optional(),
});

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;

export const WorkflowCanvasNodePositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

/** New corner handles plus legacy centered top/bottom kept so older saved canvases still parse. */
const WorkflowConnectionHandleEnum = z.enum([
  "top-left",
  "top-right",
  "right",
  "bottom-right",
  "bottom-left",
  "left",
  "top",
  "bottom",
]);

export const WorkflowCanvasEdgeConnectionSchema = z.object({
  sourceHandle: WorkflowConnectionHandleEnum.optional(),
  targetHandle: WorkflowConnectionHandleEnum.optional(),
});

export const WorkflowCanvasSchema = z.object({
  version: z.literal(1),
  nodes: z.record(z.string(), WorkflowCanvasNodePositionSchema),
  edges: z.record(z.string(), WorkflowCanvasEdgeConnectionSchema).optional(),
});

export type WorkflowCanvas = z.infer<typeof WorkflowCanvasSchema>;

export const WorkflowDefinitionSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  initialStep: z.string(),
  steps: z.record(z.string(), WorkflowStepSchema),
  terminalStates: z.array(z.string()),
  canvas: WorkflowCanvasSchema.optional(),
});

export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const TERMINAL_SUCCESS = "__done__" as const;
export const TERMINAL_BLOCKED = "__blocked__" as const;
export const TERMINAL_PAUSED = "__paused__" as const;
export const TERMINAL_DRAFT = "__draft__" as const;

export const isTerminalState = (target: string): boolean =>
  target === TERMINAL_SUCCESS ||
  target === TERMINAL_BLOCKED ||
  target === TERMINAL_PAUSED ||
  target === TERMINAL_DRAFT;
