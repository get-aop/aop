import { z } from "zod";

export const AgentRole = {
  ARCHITECT: "architect",
  DEVELOPER: "developer",
} as const;

export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const DeveloperLifecycleStage = {
  QUEUED: "queued",
  ASSIGNED: "assigned",
  IMPLEMENTING: "implementing",
  VERIFYING: "verifying",
  HANDOFF: "handoff",
  COMPLETED: "completed",
} as const;

export type DeveloperLifecycleStage =
  (typeof DeveloperLifecycleStage)[keyof typeof DeveloperLifecycleStage];

export const RepositoryAssignment = {
  CONTROL_PLANE: "control-plane",
  REVIEW: "review",
  PRIMARY: "primary",
  SUPPORTING: "supporting",
} as const;

export type RepositoryAssignment = (typeof RepositoryAssignment)[keyof typeof RepositoryAssignment];

export const RepositoryCoordinationMode = {
  SINGLE_REPOSITORY: "single-repository",
  MULTI_REPOSITORY: "multi-repository",
} as const;

export type RepositoryCoordinationMode =
  (typeof RepositoryCoordinationMode)[keyof typeof RepositoryCoordinationMode];

export const AgentRoleSchema = z.enum(["architect", "developer"]);
export const DeveloperLifecycleStageSchema = z.enum([
  "queued",
  "assigned",
  "implementing",
  "verifying",
  "handoff",
  "completed",
]);
export const RepositoryAssignmentSchema = z.enum([
  "control-plane",
  "review",
  "primary",
  "supporting",
]);
export const RepositoryCoordinationModeSchema = z.enum(["single-repository", "multi-repository"]);

export const RepositoryScopeSchema = z.object({
  repoId: z.string().min(1),
  assignment: RepositoryAssignmentSchema,
});

export type RepositoryScope = z.infer<typeof RepositoryScopeSchema>;

export const TeamAgentSchema = z
  .object({
    id: z.string().min(1),
    role: AgentRoleSchema,
    repositories: z.array(RepositoryScopeSchema).min(1),
  })
  .superRefine((agent, ctx) => {
    const architectAssignments = new Set<RepositoryAssignment>([
      RepositoryAssignment.CONTROL_PLANE,
      RepositoryAssignment.REVIEW,
    ]);
    const developerAssignments = new Set<RepositoryAssignment>([
      RepositoryAssignment.PRIMARY,
      RepositoryAssignment.SUPPORTING,
    ]);
    const seenRepoIds = new Set<string>();

    for (const [index, repository] of agent.repositories.entries()) {
      const allowedAssignments =
        agent.role === AgentRole.ARCHITECT ? architectAssignments : developerAssignments;

      if (seenRepoIds.has(repository.repoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repositories", index, "repoId"],
          message: "Agent repository scopes must not repeat the same repoId",
        });
      }

      seenRepoIds.add(repository.repoId);

      if (!allowedAssignments.has(repository.assignment)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repositories", index, "assignment"],
          message:
            agent.role === AgentRole.ARCHITECT
              ? "Architect assignments must use control-plane or review scope"
              : "Developer assignments must use primary or supporting scope",
        });
      }
    }
  });

export type TeamAgent = z.infer<typeof TeamAgentSchema>;

export const MultiAgentTeamSchema = z.array(TeamAgentSchema).superRefine((team, ctx) => {
  const architectCount = team.filter((agent) => agent.role === AgentRole.ARCHITECT).length;
  const developerCount = team.filter((agent) => agent.role === AgentRole.DEVELOPER).length;

  if (architectCount !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AOP requires exactly one architect in the active team",
    });
  }

  if (developerCount > 5) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AOP allows up to five developers in the active team",
    });
  }

  if (team.length > 6) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "AOP allows at most six agents total in the active team",
    });
  }
});

export type MultiAgentTeam = z.infer<typeof MultiAgentTeamSchema>;

export const MultiAgentArchitectureSchema = z.object({
  version: z.literal(1),
  limits: z.object({
    maxTotalAgents: z.literal(6),
    architectAgents: z.literal(1),
    developerAgents: z.literal(5),
  }),
  runtimeBoundary: z.object({
    aopOwns: z.array(z.string()).min(1),
    piOwns: z.array(z.string()).min(1),
    integrationContract: z.array(z.string()).min(1),
  }),
  architect: z.object({
    responsibilities: z.array(z.string()).min(1),
    ownsDecisions: z.array(z.string()).min(1),
  }),
  developer: z.object({
    responsibilities: z.array(z.string()).min(1),
    lifecycle: z.array(DeveloperLifecycleStageSchema).min(1),
  }),
  orchestration: z.object({
    architectOwns: z.array(z.string()).min(1),
    developerOwns: z.array(z.string()).min(1),
    handoffArtifacts: z.array(z.string()).min(1),
    escalationTriggers: z.array(z.string()).min(1),
  }),
  repositoryTopology: z.object({
    supportedModes: z.array(RepositoryCoordinationModeSchema).min(1),
    architectScope: z.string().min(1),
    developerScope: z.string().min(1),
    crossRepoChangePolicy: z.string().min(1),
  }),
  followUpGuidance: z
    .array(
      z.object({
        ticket: z.string().regex(/^GET-\d+$/),
        focus: z.string().min(1),
        deliverables: z.array(z.string()).min(1),
      }),
    )
    .min(1),
});

export type MultiAgentArchitecture = z.infer<typeof MultiAgentArchitectureSchema>;

export const INITIAL_MULTI_AGENT_ARCHITECTURE: MultiAgentArchitecture = {
  version: 1,
  limits: {
    maxTotalAgents: 6,
    architectAgents: 1,
    developerAgents: 5,
  },
  runtimeBoundary: {
    aopOwns: [
      "Task intake, assignment, workflow selection, status projection, and operator controls",
      "Linear-backed source metadata, task dependencies, and repository scope",
      "Dashboard read models for workers, tickets, blockers, logs, chats, and handoffs",
      "Durable bindings between AOP tasks and Pi sessions for recovery and auditability",
    ],
    piOwns: [
      "Agent sessions, memory, tools, subagents, model execution, and inter-agent coordination",
      "Coding-agent behavior, tool execution, approvals, context management, and session trees",
      "pi-subagents orchestration primitives such as single runs, chains, parallel fan-out, and async control",
      "pi-intercom coordination when workers need supervisor decisions or progress updates",
    ],
    integrationContract: [
      "AOP launches or resumes Pi work through a narrow runtime adapter instead of provider-specific harness code",
      "AOP stores Pi session identifiers, event cursors, output paths, and recoverable metadata per active task",
      "AOP projects Pi events into stable task, worker, step, blocker, and chat state for the dashboard",
      "AOP can steer, follow up, interrupt, or resume Pi sessions only through adapter capabilities",
    ],
  },
  architect: {
    responsibilities: [
      "Represent the operator/coordinator control plane rather than an AOP-owned autonomous agent",
      "Turn imported tickets and task docs into worker assignments with explicit repo and workflow scope",
      "Replace manual CLI skill chaining with durable workflow runs that record logs, state, and handoff evidence",
      "Coordinate sequencing, blocked decisions, and final handoff acceptance from Pi worker sessions",
    ],
    ownsDecisions: [
      "Task priority, assignment, and workflow selection",
      "Cross-repository dependency ordering and writable repository scope",
      "Approval for scope changes that a Pi worker escalates",
      "Final readiness for operator handoff after Pi reports completion and verification evidence",
    ],
  },
  developer: {
    responsibilities: [
      "Execute one assigned technical slice through a Pi-backed worker session",
      "Keep changes minimal, verified, and aligned with repository conventions",
      "Return code, tests, verification evidence, blockers, and handoff notes through Pi session output",
    ],
    lifecycle: [
      DeveloperLifecycleStage.QUEUED,
      DeveloperLifecycleStage.ASSIGNED,
      DeveloperLifecycleStage.IMPLEMENTING,
      DeveloperLifecycleStage.VERIFYING,
      DeveloperLifecycleStage.HANDOFF,
      DeveloperLifecycleStage.COMPLETED,
    ],
  },
  orchestration: {
    architectOwns: [
      "Ticket intake and task package readiness",
      "Worker assignment, reassignment, workflow selection, and capacity policy",
      "Cross-repository coordination and dependency ordering",
      "Acceptance of Pi worker handoffs and operator-visible blocked decisions",
    ],
    developerOwns: [
      "Implementation inside assigned repository scope through Pi",
      "Local testing and verification for touched code",
      "Explicit blocker escalation when the slice cannot proceed safely",
    ],
    handoffArtifacts: [
      "Slice summary",
      "Changed files and verification commands",
      "Pi session id, output/log references, and relevant event cursor",
      "Cross-repository dependency notes",
      "Open risks that need operator or coordinator judgment",
    ],
    escalationTriggers: [
      "Cross-repository interface changes",
      "Dependency ordering conflicts",
      "Unclear ownership between worker slices",
      "Blocked verification or unsafe merge conditions",
      "Any product, architecture, or scope choice not approved by the operator",
    ],
  },
  repositoryTopology: {
    supportedModes: [
      RepositoryCoordinationMode.SINGLE_REPOSITORY,
      RepositoryCoordinationMode.MULTI_REPOSITORY,
    ],
    architectScope:
      "AOP maintains global task, repository, and ticket awareness while Pi sessions execute bounded work.",
    developerScope:
      "Each Pi-backed worker is assigned one writable primary repository slice and may receive supporting repositories as read-only context.",
    crossRepoChangePolicy:
      "Cross-repository changes are planned and sequenced by AOP, then executed as explicit worker assignments rather than ad hoc shared ownership.",
  },
  followUpGuidance: [
    {
      ticket: "GET-58",
      focus: "Pi runtime adapter for task execution",
      deliverables: [
        "SDK/RPC adapter boundary",
        "Task-to-session binding metadata",
        "Launch, resume, interrupt, and event ingestion contract",
      ],
    },
    {
      ticket: "GET-56",
      focus: "Task assignment and workflow model for Pi workers",
      deliverables: [
        "Worker assignment records",
        "Task-level workflow selection semantics",
        "Repository scope and capacity guardrails",
      ],
    },
    {
      ticket: "GET-55",
      focus: "Pi-backed worker profile management",
      deliverables: [
        "Worker profile contract",
        "Repo membership rules",
        "Default workflow/model hints without custom AOP memory",
      ],
    },
    {
      ticket: "GET-59",
      focus: "Private and group chat backed by Pi sessions and intercom",
      deliverables: [
        "Private worker chat route",
        "Group coordination channel",
        "Pending decision and progress update projection",
      ],
    },
    {
      ticket: "GET-57",
      focus: "Agent swimlane software factory dashboard",
      deliverables: [
        "Worker swimlane board",
        "Task card runtime/status metadata",
        "Operator controls for assignment, workflow, chat, blockers, and handoff",
      ],
    },
    {
      ticket: "GET-42",
      focus: "Pi session event projection and recovery",
      deliverables: [
        "Canonical AOP runtime event schema",
        "Projection-backed task and worker status",
        "Restart and reattach behavior from Pi session metadata",
      ],
    },
    {
      ticket: "GET-43",
      focus: "Dashboard task creation via Pi chat",
      deliverables: [
        "Create-from-scratch entrypoint",
        "Pi-backed brainstorming session",
        "Task package persistence from the completed chat",
      ],
    },
    {
      ticket: "GET-44",
      focus: "Task-level workflow selection",
      deliverables: [
        "Workflow picker on task detail",
        "Persisted task workflow override",
        "Execution start/resume honoring the selected workflow",
      ],
    },
  ],
};

export const renderMultiAgentArchitectureMarkdown = (
  architecture: MultiAgentArchitecture,
): string => {
  return [
    "# AOP Control Plane Over Pi",
    "",
    "## V1 Factory Limits",
    `- Total active runtime slots: ${architecture.limits.maxTotalAgents}`,
    `- Coordinator/control-plane slots: ${architecture.limits.architectAgents}`,
    `- Pi-backed developer worker slots: ${architecture.limits.developerAgents}`,
    "",
    "## Runtime Boundary",
    "### AOP owns",
    ...architecture.runtimeBoundary.aopOwns.map((item) => `- ${item}`),
    "",
    "### Pi owns",
    ...architecture.runtimeBoundary.piOwns.map((item) => `- ${item}`),
    "",
    "### Adapter contract",
    ...architecture.runtimeBoundary.integrationContract.map((item) => `- ${item}`),
    "",
    "## AOP Control Plane",
    ...architecture.architect.responsibilities.map((responsibility) => `- ${responsibility}`),
    "",
    "### Control-plane decision boundaries",
    ...architecture.architect.ownsDecisions.map((decision) => `- ${decision}`),
    "",
    "## Pi-Backed Workers",
    ...architecture.developer.responsibilities.map((responsibility) => `- ${responsibility}`),
    "",
    "### Worker lifecycle",
    ...architecture.developer.lifecycle.map((stage, index) => `${index + 1}. ${stage}`),
    "",
    "## Orchestration Boundaries",
    "### AOP control plane owns",
    ...architecture.orchestration.architectOwns.map((item) => `- ${item}`),
    "",
    "### Pi workers own",
    ...architecture.orchestration.developerOwns.map((item) => `- ${item}`),
    "",
    "### Handoff artifacts",
    ...architecture.orchestration.handoffArtifacts.map((item) => `- ${item}`),
    "",
    "### Escalation triggers",
    ...architecture.orchestration.escalationTriggers.map((item) => `- ${item}`),
    "",
    "## Repository Topology",
    `- Supported modes: ${architecture.repositoryTopology.supportedModes.join(", ")}`,
    `- Control-plane scope: ${architecture.repositoryTopology.architectScope}`,
    `- Worker scope: ${architecture.repositoryTopology.developerScope}`,
    `- Cross-repo change policy: ${architecture.repositoryTopology.crossRepoChangePolicy}`,
    "",
    "## Follow-Up Tickets",
    ...architecture.followUpGuidance.map(
      (guidance) => `- ${guidance.ticket}: ${guidance.focus} (${guidance.deliverables.join("; ")})`,
    ),
    "",
  ].join("\n");
};
