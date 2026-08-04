import { z } from "zod";
import {
  AgentRole,
  DeveloperLifecycleStage,
  DeveloperLifecycleStageSchema,
  INITIAL_MULTI_AGENT_ARCHITECTURE,
  MultiAgentTeamSchema,
  RepositoryAssignment,
  RepositoryCoordinationMode,
  RepositoryCoordinationModeSchema,
  RepositoryScopeSchema,
} from "./multi-agent-architecture.ts";

export const TaskCoordinationPhase = {
  DEVELOPERS_ASSIGNED: "developers-assigned",
  DEVELOPERS_IMPLEMENTING: "developers-implementing",
  DEVELOPERS_VERIFYING: "developers-verifying",
  DEVELOPER_HANDOFF: "developer-handoff",
  ARCHITECT_REVIEW: "architect-review",
  COMPLETED: "completed",
} as const;

export type TaskCoordinationPhase =
  (typeof TaskCoordinationPhase)[keyof typeof TaskCoordinationPhase];

export const TaskCoordinationPhaseSchema = z.enum([
  "developers-assigned",
  "developers-implementing",
  "developers-verifying",
  "developer-handoff",
  "architect-review",
  "completed",
]);

export const TaskExecutionGuardrailsSchema = z.object({
  maxTotalAgents: z.literal(INITIAL_MULTI_AGENT_ARCHITECTURE.limits.maxTotalAgents),
  maxDeveloperAgents: z.literal(INITIAL_MULTI_AGENT_ARCHITECTURE.limits.developerAgents),
  maxDeveloperAssignmentsPerTask: z.literal(1),
  requireSinglePrimaryRepository: z.literal(true),
  allowSupportingRepositories: z.literal(true),
  architectRunsInControlPlane: z.literal(true),
});

export type TaskExecutionGuardrails = z.infer<typeof TaskExecutionGuardrailsSchema>;

export const INITIAL_TASK_EXECUTION_GUARDRAILS: TaskExecutionGuardrails = {
  maxTotalAgents: INITIAL_MULTI_AGENT_ARCHITECTURE.limits.maxTotalAgents,
  maxDeveloperAgents: INITIAL_MULTI_AGENT_ARCHITECTURE.limits.developerAgents,
  maxDeveloperAssignmentsPerTask: 1,
  requireSinglePrimaryRepository: true,
  allowSupportingRepositories: true,
  architectRunsInControlPlane: true,
};

export const ArchitectTaskAssignmentSchema = z.object({
  agentId: z.string().min(1),
  role: z.literal(AgentRole.ARCHITECT),
  repositories: z.array(RepositoryScopeSchema).min(1),
});

export type ArchitectTaskAssignment = z.infer<typeof ArchitectTaskAssignmentSchema>;

export const DeveloperTaskAssignmentSchema = z
  .object({
    agentId: z.string().min(1),
    role: z.literal(AgentRole.DEVELOPER),
    sliceId: z.string().min(1),
    lifecycle: DeveloperLifecycleStageSchema,
    repositories: z.array(RepositoryScopeSchema).min(1),
  })
  .superRefine((assignment, ctx) => {
    const primaryRepositories = assignment.repositories.filter(
      (repository) => repository.assignment === RepositoryAssignment.PRIMARY,
    );

    if (primaryRepositories.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repositories"],
        message: "Developer assignments must declare exactly one primary repository",
      });
    }
  });

export type DeveloperTaskAssignment = z.infer<typeof DeveloperTaskAssignmentSchema>;

const createTaskExecutionTeam = (model: {
  architect: ArchitectTaskAssignment;
  developers: DeveloperTaskAssignment[];
}) => {
  return [
    {
      id: model.architect.agentId,
      role: model.architect.role,
      repositories: model.architect.repositories,
    },
    ...model.developers.map((developer) => ({
      id: developer.agentId,
      role: developer.role,
      repositories: developer.repositories,
    })),
  ];
};

const appendTeamValidationIssues = (
  model: {
    architect: ArchitectTaskAssignment;
    developers: DeveloperTaskAssignment[];
  },
  ctx: z.RefinementCtx,
) => {
  const teamResult = MultiAgentTeamSchema.safeParse(createTaskExecutionTeam(model));
  if (teamResult.success) {
    return;
  }

  for (const issue of teamResult.error.issues) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: issue.message,
      path: issue.path,
    });
  }
};

const readExecutionModelRepositoryIds = (model: {
  architect: ArchitectTaskAssignment;
  developers: DeveloperTaskAssignment[];
}): Set<string> => {
  const repoIds = new Set<string>();

  for (const repository of model.architect.repositories) {
    repoIds.add(repository.repoId);
  }

  for (const developer of model.developers) {
    for (const repository of developer.repositories) {
      repoIds.add(repository.repoId);
    }
  }

  return repoIds;
};

const validateSingleRepositoryCoordination = (
  model: {
    coordinationMode: RepositoryCoordinationMode;
    architect: ArchitectTaskAssignment;
    developers: DeveloperTaskAssignment[];
  },
  ctx: z.RefinementCtx,
) => {
  if (model.coordinationMode !== RepositoryCoordinationMode.SINGLE_REPOSITORY) {
    return;
  }

  if (readExecutionModelRepositoryIds(model).size <= 1) {
    return;
  }

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ["coordinationMode"],
    message: "single-repository coordination cannot span multiple repositories",
  });
};

export const TaskExecutionModelSchema = z
  .object({
    version: z.literal(1),
    coordinationMode: RepositoryCoordinationModeSchema,
    coordinationPhase: TaskCoordinationPhaseSchema,
    architect: ArchitectTaskAssignmentSchema,
    developers: z.array(DeveloperTaskAssignmentSchema).min(1),
    guardrails: TaskExecutionGuardrailsSchema.default(INITIAL_TASK_EXECUTION_GUARDRAILS),
  })
  .superRefine((model, ctx) => {
    appendTeamValidationIssues(model, ctx);
    validateSingleRepositoryCoordination(model, ctx);
  });

export type TaskExecutionModel = z.infer<typeof TaskExecutionModelSchema>;

export const readPrimaryRepository = (assignment: DeveloperTaskAssignment) => {
  return (
    assignment.repositories.find(
      (repository) => repository.assignment === RepositoryAssignment.PRIMARY,
    ) ?? null
  );
};

export const readSupportingRepositories = (assignment: DeveloperTaskAssignment) => {
  return assignment.repositories.filter(
    (repository) => repository.assignment === RepositoryAssignment.SUPPORTING,
  );
};

export const clampDeveloperExecutionSlots = (requestedSlots: number): number => {
  const normalizedSlots = Number.isFinite(requestedSlots)
    ? Math.max(0, Math.trunc(requestedSlots))
    : INITIAL_TASK_EXECUTION_GUARDRAILS.maxDeveloperAgents;

  return Math.min(normalizedSlots, INITIAL_TASK_EXECUTION_GUARDRAILS.maxDeveloperAgents);
};

export const canExecutionPhaseLaunchDeveloperWork = (
  phase: TaskCoordinationPhase,
  lifecycle: DeveloperLifecycleStage,
): boolean => {
  const developerExecutionPhases = new Set<TaskCoordinationPhase>([
    TaskCoordinationPhase.DEVELOPERS_ASSIGNED,
    TaskCoordinationPhase.DEVELOPERS_IMPLEMENTING,
    TaskCoordinationPhase.DEVELOPERS_VERIFYING,
    TaskCoordinationPhase.DEVELOPER_HANDOFF,
  ]);
  const executableLifecycles = new Set<DeveloperLifecycleStage>([
    DeveloperLifecycleStage.ASSIGNED,
    DeveloperLifecycleStage.IMPLEMENTING,
    DeveloperLifecycleStage.VERIFYING,
    DeveloperLifecycleStage.HANDOFF,
  ]);

  return developerExecutionPhases.has(phase) && executableLifecycles.has(lifecycle);
};

export const isRepositoryAssignmentWritable = (assignment: RepositoryAssignment): boolean =>
  assignment === RepositoryAssignment.PRIMARY;
