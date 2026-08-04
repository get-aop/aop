import type { AgentRole } from "./multi-agent-architecture.ts";
import type { TaskStatus } from "./task.ts";
import type { TaskCoordinationPhase, TaskExecutionModel } from "./task-execution-model.ts";

export const DashboardSwimlaneId = {
  ARCHITECT_CONTROL: "architect-control",
  DEVELOPER_EXECUTION: "developer-execution",
  COMPLETED: "completed",
} as const;

export type DashboardSwimlaneId = (typeof DashboardSwimlaneId)[keyof typeof DashboardSwimlaneId];

export type DashboardSwimlaneOwnerRole = AgentRole | "system";

export interface DashboardSwimlane {
  id: DashboardSwimlaneId;
  title: string;
  description: string;
  ownerRole: DashboardSwimlaneOwnerRole;
  order: number;
}

export interface TaskSwimlane {
  laneId: DashboardSwimlaneId;
  phaseLabel: string;
  ownerLabel: string;
  ownerRole: DashboardSwimlaneOwnerRole;
}

export const DEFAULT_DASHBOARD_SWIMLANES: DashboardSwimlane[] = [
  {
    id: DashboardSwimlaneId.ARCHITECT_CONTROL,
    title: "Control Plane",
    description: "Assign work, pick workflows, monitor Pi sessions, and accept handoffs.",
    ownerRole: "architect",
    order: 0,
  },
  {
    id: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    title: "Pi Worker Execution",
    description: "Implement, verify, and hand off active worker slices through Pi.",
    ownerRole: "developer",
    order: 1,
  },
  {
    id: DashboardSwimlaneId.COMPLETED,
    title: "Completed",
    description: "Accepted work that has cleared the active execution loop.",
    ownerRole: "system",
    order: 2,
  },
];

const LEGACY_SWIMLANE_BY_STATUS: Record<TaskStatus, TaskSwimlane> = {
  DRAFT: {
    laneId: DashboardSwimlaneId.ARCHITECT_CONTROL,
    phaseLabel: "Planning",
    ownerLabel: "Architect",
    ownerRole: "architect",
  },
  READY: {
    laneId: DashboardSwimlaneId.ARCHITECT_CONTROL,
    phaseLabel: "Assigned",
    ownerLabel: "Architect",
    ownerRole: "architect",
  },
  RESUMING: {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Resuming",
    ownerLabel: "Developer",
    ownerRole: "developer",
  },
  WORKING: {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Implementing",
    ownerLabel: "Developer",
    ownerRole: "developer",
  },
  PAUSED: {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Paused",
    ownerLabel: "Developer",
    ownerRole: "developer",
  },
  DONE: {
    laneId: DashboardSwimlaneId.COMPLETED,
    phaseLabel: "Completed",
    ownerLabel: "Architect",
    ownerRole: "architect",
  },
  BLOCKED: {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Blocked",
    ownerLabel: "Developer",
    ownerRole: "developer",
  },
  REMOVED: {
    laneId: DashboardSwimlaneId.COMPLETED,
    phaseLabel: "Removed",
    ownerLabel: "System",
    ownerRole: "system",
  },
};

const EXECUTION_SWIMLANE_BY_PHASE: Record<
  TaskCoordinationPhase,
  Pick<TaskSwimlane, "laneId" | "phaseLabel" | "ownerRole">
> = {
  "developers-assigned": {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Assigned",
    ownerRole: "developer",
  },
  "developers-implementing": {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Implementing",
    ownerRole: "developer",
  },
  "developers-verifying": {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Verifying",
    ownerRole: "developer",
  },
  "developer-handoff": {
    laneId: DashboardSwimlaneId.DEVELOPER_EXECUTION,
    phaseLabel: "Handoff",
    ownerRole: "developer",
  },
  "architect-review": {
    laneId: DashboardSwimlaneId.ARCHITECT_CONTROL,
    phaseLabel: "Review",
    ownerRole: "architect",
  },
  completed: {
    laneId: DashboardSwimlaneId.COMPLETED,
    phaseLabel: "Completed",
    ownerRole: "architect",
  },
};

const readArchitectOwnerLabel = (execution: TaskExecutionModel): string => {
  return execution.architect.agentId || "Architect";
};

const readDeveloperOwnerLabel = (execution: TaskExecutionModel): string => {
  return execution.developers[0]?.agentId || "Developer";
};

const readExecutionOwnerRole = (execution: TaskExecutionModel): DashboardSwimlaneOwnerRole => {
  const phase = EXECUTION_SWIMLANE_BY_PHASE[execution.coordinationPhase];
  return phase.ownerRole;
};

const readExecutionLaneId = (execution: TaskExecutionModel): DashboardSwimlaneId => {
  const phase = EXECUTION_SWIMLANE_BY_PHASE[execution.coordinationPhase];
  return phase.laneId;
};

const LIVE_WORKING_PHASE_BY_COORDINATION: Partial<Record<TaskCoordinationPhase, string>> = {
  "developers-verifying": "Verifying",
  "developer-handoff": "Handoff",
  "architect-review": "Review",
};

const isLiveDeveloperExecutionStatus = (status: TaskStatus): boolean =>
  status === "WORKING" || status === "RESUMING" || status === "PAUSED" || status === "BLOCKED";

const readWorkingPhaseLabel = (status: TaskStatus, execution: TaskExecutionModel): string => {
  const coordinatedPhase = LIVE_WORKING_PHASE_BY_COORDINATION[execution.coordinationPhase];
  if (coordinatedPhase) {
    return coordinatedPhase;
  }

  return status === "RESUMING" ? "Resuming" : "Implementing";
};

const readLivePhaseLabel = (status: TaskStatus, execution: TaskExecutionModel): string | null => {
  if (status === "WORKING" || status === "RESUMING") {
    return readWorkingPhaseLabel(status, execution);
  }

  if (status === "PAUSED") {
    return "Paused";
  }

  if (status === "BLOCKED") {
    return "Blocked";
  }

  return null;
};

const readOwnerLabel = (
  execution: TaskExecutionModel,
  ownerRole: DashboardSwimlaneOwnerRole,
): string => {
  return ownerRole === "architect"
    ? readArchitectOwnerLabel(execution)
    : readDeveloperOwnerLabel(execution);
};

const resolveDoneTaskSwimlane = (execution: TaskExecutionModel | null): TaskSwimlane => ({
  laneId: DashboardSwimlaneId.COMPLETED,
  phaseLabel: "Completed",
  ownerLabel: execution ? readArchitectOwnerLabel(execution) : "Architect",
  ownerRole: "architect",
});

const resolveLiveTaskSwimlane = (
  status: TaskStatus,
  execution: TaskExecutionModel,
  phaseLabel: string,
): TaskSwimlane => {
  const ownerRole = isLiveDeveloperExecutionStatus(status)
    ? "developer"
    : readExecutionOwnerRole(execution);

  return {
    laneId: isLiveDeveloperExecutionStatus(status)
      ? DashboardSwimlaneId.DEVELOPER_EXECUTION
      : readExecutionLaneId(execution),
    phaseLabel,
    ownerLabel: readOwnerLabel(execution, ownerRole),
    ownerRole,
  };
};

const resolveCoordinatedTaskSwimlane = (execution: TaskExecutionModel): TaskSwimlane => {
  const phase = EXECUTION_SWIMLANE_BY_PHASE[execution.coordinationPhase];

  return {
    laneId: phase.laneId,
    phaseLabel: phase.phaseLabel,
    ownerLabel: readOwnerLabel(execution, phase.ownerRole),
    ownerRole: phase.ownerRole,
  };
};

export const resolveTaskSwimlane = (
  status: TaskStatus,
  execution: TaskExecutionModel | null,
): TaskSwimlane => {
  if (status === "DONE") {
    return resolveDoneTaskSwimlane(execution);
  }

  if (status === "REMOVED") {
    return LEGACY_SWIMLANE_BY_STATUS.REMOVED;
  }

  if (!execution) {
    return LEGACY_SWIMLANE_BY_STATUS[status];
  }

  const livePhaseLabel = readLivePhaseLabel(status, execution);
  return livePhaseLabel
    ? resolveLiveTaskSwimlane(status, execution, livePhaseLabel)
    : resolveCoordinatedTaskSwimlane(execution);
};
