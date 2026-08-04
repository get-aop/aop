import type { RuntimeEvent } from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { SchedulerTrigger, Task } from "../db/schema.ts";
import { listSignals, type SignalDto } from "../signals/service.ts";

export type ReviewInboxItemType =
  | "handoff_approval"
  | "blocked_budget"
  | "failed_verification"
  | "guard_failure"
  | "schedule_error"
  | "generated_follow_up";

export type ReviewInboxSeverity = "low" | "medium" | "high";
export type ReviewInboxSource = "approval" | "runtime_event" | "scheduler" | "signal";

export interface ReviewInboxFilters {
  repoId?: string;
  workerId?: string;
  source?: ReviewInboxSource;
  severity?: ReviewInboxSeverity;
}

export interface ReviewInboxItem {
  id: string;
  type: ReviewInboxItemType;
  severity: ReviewInboxSeverity;
  source: ReviewInboxSource;
  title: string;
  message: string | null;
  repoId: string;
  taskId: string;
  taskStatus: Task["status"];
  workerId: string | null;
  workerName: string | null;
  executionId: string | null;
  stepExecutionId: string | null;
  retryFromStep: string | null;
  eventId: string | null;
  evidenceKind: string | null;
  triggerId: string | null;
  occurredAt: string;
}

type InboxAssignment = { agentId: string; agentName: string | null } | undefined;

export const listReviewInboxItems = async (
  ctx: LocalServerContext,
  filters: ReviewInboxFilters = {},
): Promise<ReviewInboxItem[]> => {
  const tasks = await ctx.taskRepository.list({ excludeRemoved: true });
  const assignments = await ctx.taskAssignmentRepository.getCurrentWithAgentNameByTaskIds(
    tasks.map((task) => task.id),
  );
  const taskItems = await projectTaskInboxItems(ctx, tasks, assignments);
  const signals = await listSignals(ctx, { openOnly: true, repoId: filters.repoId });
  const runtimeBlockerKeys = buildRuntimeBlockerKeys(taskItems);
  const signalItems = signals
    .filter((signal) => !isAopBlockerSignalMirror(signal, runtimeBlockerKeys))
    .map((signal) => projectSignal(signal, tasks));
  const schedulerItems = await projectSchedulerInboxItems(ctx);

  return [...taskItems, ...signalItems, ...schedulerItems]
    .filter((item) => matchesFilters(item, filters))
    .sort(compareInboxItems);
};

const projectTaskInboxItems = async (
  ctx: LocalServerContext,
  tasks: Task[],
  assignments: Map<string, { agentId: string; agentName: string | null }>,
): Promise<ReviewInboxItem[]> => {
  const items: ReviewInboxItem[] = [];
  for (const task of tasks) {
    const assignment = assignments.get(task.id);
    const handoffItem = projectHandoffApproval(task, assignment);
    if (handoffItem) items.push(handoffItem);
    if (task.status === "DONE") continue;

    const events = await ctx.runtimeEventRepository.listByTaskId(task.id);
    items.push(...events.flatMap((event) => projectRuntimeEvent(task, assignment, event) ?? []));
  }
  return items;
};

const projectHandoffApproval = (
  task: Task,
  assignment: InboxAssignment,
): ReviewInboxItem | null => {
  if (!task.handoff_pending_approval) return null;

  return {
    id: `handoff:${task.id}`,
    type: "handoff_approval",
    severity: "medium",
    source: "approval",
    title: "Completion awaiting approval",
    message: "Review and approve this task before handoff.",
    repoId: task.repo_id,
    taskId: task.id,
    taskStatus: task.status,
    workerId: assignment?.agentId ?? null,
    workerName: assignment?.agentName ?? null,
    executionId: null,
    stepExecutionId: null,
    retryFromStep: null,
    eventId: null,
    evidenceKind: null,
    triggerId: null,
    occurredAt: task.updated_at,
  };
};

const projectSignal = (signal: SignalDto, tasks: Task[]): ReviewInboxItem => {
  const sourceTask = signal.sourceTaskId
    ? tasks.find((task) => task.id === signal.sourceTaskId)
    : null;

  return {
    id: `signal:${signal.id}`,
    type: "generated_follow_up",
    severity: signal.confidence === "high" ? "medium" : "low",
    source: "signal",
    title: signal.title,
    message: signal.body,
    repoId: signal.repoId,
    taskId: signal.sourceTaskId ?? signal.id,
    taskStatus: sourceTask?.status ?? "DRAFT",
    workerId: null,
    workerName: null,
    executionId: signal.sourceExecutionId,
    stepExecutionId: null,
    retryFromStep: null,
    eventId: null,
    evidenceKind: signal.kind,
    triggerId: signal.id,
    occurredAt: signal.createdAt,
  };
};

const projectSchedulerInboxItems = async (ctx: LocalServerContext): Promise<ReviewInboxItem[]> => {
  const triggers = await ctx.schedulerRepository.listAll();
  return triggers.flatMap(projectSchedulerTrigger);
};

const projectSchedulerTrigger = (trigger: SchedulerTrigger): ReviewInboxItem[] => {
  const result = parseSchedulerResult(trigger.last_result_json);
  if (!result?.error) return [];

  return [
    {
      id: `scheduler:${trigger.id}`,
      type: "schedule_error",
      severity: "medium",
      source: "scheduler",
      title: `Scheduler failed: ${trigger.name}`,
      message: result.error,
      repoId: trigger.repo_id,
      taskId: `scheduler:${trigger.id}`,
      taskStatus: "BLOCKED",
      workerId: null,
      workerName: null,
      executionId: null,
      stepExecutionId: null,
      retryFromStep: null,
      eventId: null,
      evidenceKind: trigger.action,
      triggerId: trigger.id,
      occurredAt: trigger.last_run_at ?? trigger.updated_at,
    },
  ];
};

const parseSchedulerResult = (json: string | null): { error?: string } | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const error = (parsed as Record<string, unknown>).error;
    return typeof error === "string" && error.trim().length > 0 ? { error } : null;
  } catch {
    return null;
  }
};

const AOP_BLOCKER_SIGNAL_TITLE_PREFIXES = [
  "Budget blocked ",
  "Checker evidence missing ",
  "Completion guard blocked ",
  "Required workflow signal missing ",
  "Step blocked ",
];

const buildRuntimeBlockerKeys = (items: ReviewInboxItem[]): Set<string> => {
  return new Set(
    items
      .filter((item) => item.source === "runtime_event")
      .filter((item) => item.type === "blocked_budget" || item.type === "guard_failure")
      .flatMap((item) => runtimeBlockerKey(item.taskId, item.executionId) ?? []),
  );
};

const isAopBlockerSignalMirror = (signal: SignalDto, runtimeBlockerKeys: Set<string>): boolean => {
  if (signal.provenance !== "aop" || !signal.sourceTaskId || !signal.sourceExecutionId) {
    return false;
  }

  const key = runtimeBlockerKey(signal.sourceTaskId, signal.sourceExecutionId);
  if (!key || !runtimeBlockerKeys.has(key)) return false;

  return AOP_BLOCKER_SIGNAL_TITLE_PREFIXES.some((prefix) => signal.title.startsWith(prefix));
};

const runtimeBlockerKey = (taskId: string, executionId: string | null): string | null =>
  executionId ? `${taskId}:${executionId}` : null;

const projectRuntimeEvent = (
  task: Task,
  assignment: InboxAssignment,
  event: RuntimeEvent,
): ReviewInboxItem | null => {
  const projection = classifyRuntimeEvent(event);
  if (!projection) return null;

  return {
    id: `event:${event.id}`,
    type: projection.type,
    severity: projection.severity,
    source: projection.source,
    title: event.title ?? projection.title,
    message: event.message,
    repoId: task.repo_id,
    taskId: task.id,
    taskStatus: task.status,
    workerId: assignment?.agentId ?? null,
    workerName: assignment?.agentName ?? null,
    executionId: event.executionId,
    stepExecutionId: event.stepExecutionId,
    retryFromStep: getRetryFromStep(event),
    eventId: event.id,
    evidenceKind: getEvidenceKind(event),
    triggerId: getTriggerId(event),
    occurredAt: event.occurredAt,
  };
};

const classifyRuntimeEvent = (
  event: RuntimeEvent,
): Pick<ReviewInboxItem, "type" | "severity" | "source" | "title"> | null => {
  if (event.kind === "verification_evidence_recorded" && event.status === "failed") {
    return {
      type: "failed_verification",
      severity: "high",
      source: "runtime_event",
      title: "Verification failed",
    };
  }

  if (event.kind === "task_blocked") {
    const reason = String(event.metadata?.code ?? event.metadata?.reason ?? event.status ?? "");
    if (reason === "budget_exceeded") {
      return {
        type: "blocked_budget",
        severity: "high",
        source: "runtime_event",
        title: "Budget exceeded",
      };
    }

    return {
      type: "guard_failure",
      severity: "high",
      source: "runtime_event",
      title: "Completion guard failed",
    };
  }

  if (event.kind === "scheduler_failed") {
    return {
      type: "schedule_error",
      severity: "medium",
      source: "scheduler",
      title: "Scheduler failed",
    };
  }

  return null;
};

const getEvidenceKind = (event: RuntimeEvent): string | null => {
  const evidence = event.metadata?.evidence;
  if (!evidence || typeof evidence !== "object" || !("kind" in evidence)) return null;
  const kind = evidence.kind;
  return typeof kind === "string" ? kind : null;
};

const getTriggerId = (event: RuntimeEvent): string | null => {
  const triggerId = event.metadata?.triggerId;
  return typeof triggerId === "string" ? triggerId : null;
};

const getRetryFromStep = (event: RuntimeEvent): string | null => {
  const retryFromStep = event.metadata?.retryFromStep;
  return typeof retryFromStep === "string" && retryFromStep.trim().length > 0
    ? retryFromStep
    : null;
};

const matchesFilters = (item: ReviewInboxItem, filters: ReviewInboxFilters): boolean => {
  if (filters.repoId && item.repoId !== filters.repoId) return false;
  if (filters.workerId && item.workerId !== filters.workerId) return false;
  if (filters.source && item.source !== filters.source) return false;
  if (filters.severity && item.severity !== filters.severity) return false;
  return true;
};

const compareInboxItems = (left: ReviewInboxItem, right: ReviewInboxItem): number =>
  right.occurredAt.localeCompare(left.occurredAt);
