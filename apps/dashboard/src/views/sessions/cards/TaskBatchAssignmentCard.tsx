import type {
  ChatActionPayload,
  TaskBatchAssignmentFields,
  TaskBatchAssignmentItem,
  TaskBatchRoutedOutcome,
} from "@aop/common";
import { type CSSProperties, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { confirmTaskBatchRow } from "../../../api/client";
import { asTaskBatchAssignment, unknownCardFallbackText } from "./chat-cards";

/** Sentinel destination: keep the row's task unassigned in Backlog. */
const BACKLOG = "__backlog__";

interface RowUiState {
  destination: string;
  status: "idle" | "busy" | "resolved";
  outcome?: TaskBatchRoutedOutcome;
  workerName?: string;
  error: string | null;
}

export const TaskBatchAssignmentCard = ({
  action,
  sessionId,
  messageId,
  tasks,
  workers,
  onNavigate,
}: {
  action: ChatActionPayload;
  sessionId?: string | null;
  messageId?: string;
  tasks: Array<{ id: string; status: string; assignedAgentId?: string | null }>;
  workers: Array<{ id: string; name: string }>;
  onNavigate: (path: string) => void;
}) => {
  const proposal = asTaskBatchAssignment(action);
  if (!proposal) {
    return <p style={META}>{unknownCardFallbackText(action)}</p>;
  }
  return (
    <BatchRoutingBoard
      proposal={proposal}
      source={sessionId && messageId ? { sessionId, messageId } : undefined}
      tasks={tasks}
      workers={workers}
      onNavigate={onNavigate}
    />
  );
};

const BatchRoutingBoard = ({
  proposal,
  source,
  tasks,
  workers,
  onNavigate,
}: {
  proposal: TaskBatchAssignmentFields;
  source?: { sessionId: string; messageId: string };
  tasks: Array<{ id: string; status: string; assignedAgentId?: string | null }>;
  workers: Array<{ id: string; name: string }>;
  onNavigate: (path: string) => void;
}) => {
  const [rows, setRows] = useState<Record<string, RowUiState>>(() =>
    Object.fromEntries(
      proposal.items.map((item) => [item.taskId, initialRowState(item, workers, tasks)]),
    ),
  );

  const patchRow = (taskId: string, patch: Partial<RowUiState>) =>
    setRows((current) => ({
      ...current,
      [taskId]: { ...(current[taskId] as RowUiState), ...patch },
    }));

  const confirm = async (item: TaskBatchAssignmentItem, mode: "assign" | "start") => {
    const row = rows[item.taskId];
    if (row?.status !== "idle") return;
    await routeBatchRow({ item, row, mode, repoId: proposal.repoId, workers, source, patchRow });
  };

  const resolved = proposal.items.filter((item) => rows[item.taskId]?.status === "resolved");
  const options = [
    { value: BACKLOG, label: "Backlog" },
    ...workers.map((worker) => ({ value: worker.id, label: worker.name })),
  ];

  return (
    <div data-testid="task-batch-assignment-card" style={CARD}>
      <div style={HEADER}>
        <span style={TITLE}>
          {proposal.items.length} {proposal.items.length === 1 ? "task" : "tasks"} created
        </span>
        <span style={META}>
          {resolved.length} of {proposal.items.length} routed
        </span>
      </div>
      {proposal.items.map((item) => {
        const row = rows[item.taskId];
        if (!row) return null;
        return (
          <BatchRow
            key={item.taskId}
            item={item}
            row={row}
            options={options}
            onNavigate={onNavigate}
            onDestinationChange={(destination) => patchRow(item.taskId, { destination })}
            onConfirm={(mode) => void confirm(item, mode)}
          />
        );
      })}
      {resolved.length === proposal.items.length ? (
        <div data-testid="task-batch-footer" style={META}>
          {countOutcome(rows, "assigned")} assigned · {countOutcome(rows, "started")} started ·{" "}
          {countOutcome(rows, "backlog")} in Backlog
        </div>
      ) : null}
    </div>
  );
};

const BatchRow = ({
  item,
  row,
  options,
  onNavigate,
  onDestinationChange,
  onConfirm,
}: {
  item: TaskBatchAssignmentItem;
  row: RowUiState;
  options: Array<{ value: string; label: string }>;
  onNavigate: (path: string) => void;
  onDestinationChange: (destination: string) => void;
  onConfirm: (mode: "assign" | "start") => void;
}) => (
  <div data-testid="task-batch-row" style={ROW}>
    <div style={ROW_LEFT}>
      <span style={TASK_TITLE} title={item.title}>
        {item.title}
      </span>
      <button type="button" style={LINKISH} onClick={() => onNavigate(`/tasks/${item.taskId}`)}>
        Open
      </button>
    </div>
    <div style={ROW_RIGHT}>
      {row.status === "resolved" ? (
        <RowOutcomeChip row={row} />
      ) : (
        <>
          <Select
            value={row.destination}
            disabled={row.status === "busy"}
            onValueChange={onDestinationChange}
          >
            <SelectTrigger aria-label={`Destination for ${item.title}`} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RowActions row={row} onConfirm={onConfirm} />
        </>
      )}
    </div>
    {row.error ? (
      <div role="alert" style={ERROR}>
        {row.error}
      </div>
    ) : null}
  </div>
);

const RowActions = ({
  row,
  onConfirm,
}: {
  row: RowUiState;
  onConfirm: (mode: "assign" | "start") => void;
}) => (
  <>
    <button
      type="button"
      style={SECONDARY}
      disabled={row.status === "busy"}
      onClick={() => onConfirm("assign")}
    >
      Assign
    </button>
    {row.destination === BACKLOG ? null : (
      <button
        type="button"
        style={PRIMARY}
        disabled={row.status === "busy"}
        onClick={() => onConfirm("start")}
      >
        Assign and Start
      </button>
    )}
  </>
);

const RowOutcomeChip = ({ row }: { row: RowUiState }) => {
  if (row.outcome === "backlog") return <span style={CHIP_MUTED}>In Backlog</span>;
  return (
    <span style={CHIP_OK}>
      {row.outcome === "started" ? "Started" : "Assigned"} · {row.workerName}
    </span>
  );
};

export const initialRowState = (
  item: TaskBatchAssignmentItem,
  workers: Array<{ id: string; name: string }>,
  tasks: Array<{ id: string; status: string; assignedAgentId?: string | null }>,
): RowUiState =>
  fromPersistedRouting(item, workers) ??
  fromLiveTaskAssignment(item, workers, tasks) ??
  idlePrefill(item, workers);

const fromPersistedRouting = (
  item: TaskBatchAssignmentItem,
  workers: Array<{ id: string; name: string }>,
): RowUiState | null => {
  if (item.routedOutcome === "backlog") {
    return { destination: BACKLOG, status: "resolved", outcome: "backlog", error: null };
  }
  if (item.routedOutcome !== "assigned" && item.routedOutcome !== "started") return null;
  const workerId = item.routedWorkerId ?? item.workerId ?? "";
  return {
    destination: workerId || BACKLOG,
    status: "resolved",
    outcome: item.routedOutcome,
    workerName: workers.find((worker) => worker.id === workerId)?.name ?? workerId,
    error: null,
  };
};

const fromLiveTaskAssignment = (
  item: TaskBatchAssignmentItem,
  workers: Array<{ id: string; name: string }>,
  tasks: Array<{ id: string; status: string; assignedAgentId?: string | null }>,
): RowUiState | null => {
  const task = tasks.find((candidate) => candidate.id === item.taskId);
  if (!task?.assignedAgentId) return null;
  return {
    destination: task.assignedAgentId,
    status: "resolved",
    outcome: task.status === "DRAFT" ? "assigned" : "started",
    workerName:
      workers.find((worker) => worker.id === task.assignedAgentId)?.name ?? task.assignedAgentId,
    error: null,
  };
};

const idlePrefill = (
  item: TaskBatchAssignmentItem,
  workers: Array<{ id: string; name: string }>,
): RowUiState => ({
  destination: workers.some((worker) => worker.id === item.workerId)
    ? (item.workerId as string)
    : BACKLOG,
  status: "idle",
  error: null,
});

const outcomeForConfirm = (
  destination: string,
  mode: "assign" | "start",
): TaskBatchRoutedOutcome => {
  if (destination === BACKLOG) return "backlog";
  return mode === "start" ? "started" : "assigned";
};

const routeBatchRow = async (input: {
  item: TaskBatchAssignmentItem;
  row: RowUiState;
  mode: "assign" | "start";
  repoId: string;
  workers: Array<{ id: string; name: string }>;
  source?: { sessionId: string; messageId: string };
  patchRow: (taskId: string, patch: Partial<RowUiState>) => void;
}): Promise<void> => {
  const { item, row, mode, repoId, workers, source, patchRow } = input;
  const outcome = outcomeForConfirm(row.destination, mode);
  const worker = workers.find((candidate) => candidate.id === row.destination);
  patchRow(item.taskId, { status: "busy", error: null });
  const result = await tryConfirmBatchRow(
    {
      repoId,
      taskId: item.taskId,
      outcome,
      workerId: outcome === "backlog" ? null : row.destination,
      workflowId: item.workflowId ?? null,
      workflowName: item.workflowName ?? null,
    },
    source,
  );
  if (!result.ok) {
    patchRow(item.taskId, { status: "idle", error: result.error });
    return;
  }
  patchRow(item.taskId, {
    status: "resolved",
    outcome,
    workerName: outcome === "backlog" ? undefined : (worker?.name ?? row.destination),
  });
};

const tryConfirmBatchRow = async (
  input: {
    repoId: string;
    taskId: string;
    outcome: TaskBatchRoutedOutcome;
    workerId?: string | null;
    workflowId?: string | null;
    workflowName?: string | null;
  },
  source?: { sessionId: string; messageId: string },
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    await confirmTaskBatchRow(input, source);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatBatchRowError(err) };
  }
};

const formatBatchRowError = (error: unknown): string => {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    const message = typeof candidate.message === "string" ? candidate.message : String(error);
    return typeof candidate.code === "string" ? `${candidate.code}: ${message}` : message;
  }
  return String(error);
};

const countOutcome = (rows: Record<string, RowUiState>, outcome: RowUiState["outcome"]): number =>
  Object.values(rows).filter((row) => row.status === "resolved" && row.outcome === outcome).length;

const CARD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 11,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  padding: "11px 13px",
  maxWidth: "min(680px, 100%)",
};
const HEADER: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 8,
};
const TITLE: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--color-text)",
};
const META: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-text-subtle)",
};
const ROW: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  borderTop: "1px solid var(--color-border-strong)",
  paddingTop: 8,
};
const ROW_LEFT: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 0,
};
const ROW_RIGHT: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
};
const TASK_TITLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--color-text)",
};
const LINKISH: CSSProperties = {
  border: "none",
  background: "transparent",
  color: "var(--accent, var(--color-primary))",
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
};
const PRIMARY: CSSProperties = {
  border: "none",
  borderRadius: 10,
  background: "var(--color-primary)",
  color: "var(--color-primary-foreground)",
  padding: "8px 12px",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const SECONDARY: CSSProperties = {
  border: "1px solid var(--color-border-strong)",
  borderRadius: 10,
  background: "var(--color-raised)",
  color: "var(--color-text)",
  padding: "8px 12px",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
const ERROR: CSSProperties = {
  gridColumn: "1 / -1",
  color: "var(--color-blocked)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 500,
};
const CHIP_MUTED: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-text-subtle)",
};
const CHIP_OK: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--color-ok)",
};
