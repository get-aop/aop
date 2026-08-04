import type {
  ApprovalCardFields,
  ChatActionPayload,
  TaskAssignmentFields,
  TaskBatchAssignmentFields,
  TaskBatchAssignmentItem,
  WorkflowPreviewFields,
} from "@aop/common";

/** Forward-compatible parse: unknown types degrade to plain navigation-like cards. */
export const isTypedChatCard = (action: ChatActionPayload | null | undefined): boolean => {
  if (!action) return false;
  return (
    action.type === "task-assignment" ||
    action.type === "task-batch-assignment" ||
    action.type === "task-live" ||
    action.type === "workflow-preview" ||
    action.type === "worker-card" ||
    action.type === "approval" ||
    action.type === "status-summary" ||
    action.type === "workflow-run" ||
    action.type === "runtime-actions"
  );
};

export const asTaskAssignment = (action: ChatActionPayload): TaskAssignmentFields | null => {
  if (action.type !== "task-assignment" || !action.proposal) return null;
  const p = action.proposal as TaskAssignmentFields;
  if (!p.repoId || !Array.isArray(p.taskIds)) return null;
  const candidates = parseAssignmentCandidates(p.candidates);
  // Fixed selection needs ≥1 taskId; multi-select needs candidates.
  if (p.taskIds.length === 0 && !candidates) return null;
  return {
    taskIds: p.taskIds,
    title: p.title,
    repoId: p.repoId,
    workerId: p.workerId ?? null,
    workflowId: p.workflowId ?? null,
    workflowName: p.workflowName ?? null,
    ...(candidates ? { candidates } : {}),
  };
};

const parseAssignmentCandidates = (
  raw: TaskAssignmentFields["candidates"],
): TaskAssignmentFields["candidates"] => {
  if (!Array.isArray(raw)) return undefined;
  const candidates = raw.filter(
    (item): item is { id: string; title: string } =>
      typeof item?.id === "string" && typeof item?.title === "string",
  );
  return candidates.length > 0 ? candidates : undefined;
};

export const asTaskBatchAssignment = (
  action: ChatActionPayload,
): TaskBatchAssignmentFields | null => {
  if (action.type !== "task-batch-assignment" || !action.proposal) return null;
  const p = action.proposal as TaskBatchAssignmentFields;
  if (!p.repoId || !Array.isArray(p.items)) return null;
  const items = p.items
    .filter(
      (item): item is TaskBatchAssignmentItem =>
        typeof (item as TaskBatchAssignmentItem | undefined)?.taskId === "string" &&
        typeof (item as TaskBatchAssignmentItem | undefined)?.title === "string",
    )
    .map((item) => ({
      taskId: item.taskId,
      title: item.title,
      workerId: item.workerId ?? null,
      workflowId: item.workflowId ?? null,
      workflowName: item.workflowName ?? null,
      ...(item.routedOutcome
        ? {
            routedOutcome: item.routedOutcome,
            routedWorkerId: item.routedWorkerId ?? null,
          }
        : {}),
    }));
  if (items.length === 0) return null;
  return { repoId: p.repoId, items };
};

export const asWorkflowPreview = (action: ChatActionPayload): WorkflowPreviewFields | null => {
  if (action.type !== "workflow-preview" || !action.proposal) return null;
  const p = action.proposal as WorkflowPreviewFields;
  if (!p.name || !Array.isArray(p.steps)) return null;
  return p;
};

export const asApproval = (action: ChatActionPayload): ApprovalCardFields | null => {
  if (action.type !== "approval" || !action.proposal) return null;
  const p = action.proposal as ApprovalCardFields;
  if (!p.taskId || !p.handoffId) return null;
  return p;
};

export const unknownCardFallbackText = (action: ChatActionPayload): string =>
  [action.label, action.sub, action.meta].filter(Boolean).join(" · ");
