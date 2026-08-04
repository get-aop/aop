import type { ChatActionPayload, TaskAssignmentFields } from "@aop/common";
import { ArrowRightIcon } from "lucide-react";
import { type CSSProperties, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import { confirmTaskAssignment } from "../../../api/client";
import { asTaskAssignment, unknownCardFallbackText } from "./chat-cards";

export const TaskAssignmentCard = ({
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
  tasks: Array<{ id: string; assignedAgentId?: string | null }>;
  workers: Array<{ id: string; name: string }>;
  onNavigate: (path: string) => void;
}) => {
  const proposal = asTaskAssignment(action);
  if (!proposal) {
    return <p style={META}>{unknownCardFallbackText(action)}</p>;
  }

  const multiSelect = Boolean(proposal.candidates && proposal.candidates.length > 0);
  if (multiSelect) {
    return (
      <MultiTaskAssignmentForm
        action={action}
        proposal={proposal}
        source={sessionId && messageId ? { sessionId, messageId } : undefined}
        assignedWorkerId={assignedWorkerForTasks(proposal.taskIds, tasks)}
        workers={workers}
        onNavigate={onNavigate}
      />
    );
  }
  return (
    <FixedTaskAssignmentForm
      action={action}
      proposal={proposal}
      source={sessionId && messageId ? { sessionId, messageId } : undefined}
      assignedWorkerId={assignedWorkerForTasks(proposal.taskIds, tasks)}
      workers={workers}
      onNavigate={onNavigate}
    />
  );
};

const FixedTaskAssignmentForm = ({
  action,
  proposal,
  source,
  assignedWorkerId,
  workers,
  onNavigate,
}: {
  action: ChatActionPayload;
  proposal: TaskAssignmentFields;
  source?: { sessionId: string; messageId: string };
  assignedWorkerId: string | null;
  workers: Array<{ id: string; name: string }>;
  onNavigate: (path: string) => void;
}) => {
  const [error, setError] = useState<string | null>(action.error ?? null);
  const [busy, setBusy] = useState(false);
  const [workerId, setWorkerId] = useState(proposal.workerId ?? assignedWorkerId ?? "");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completed, setCompleted] = useState(
    action.status === "confirmed" || assignedWorkerId !== null,
  );

  const taskId = proposal.taskIds[currentIndex] as string;
  const multiple = proposal.taskIds.length > 1;
  const hasNext = currentIndex < proposal.taskIds.length - 1;

  const confirm = async (mode: "assign" | "start") => {
    if (!workerId || busy || completed) return;
    setBusy(true);
    setError(null);
    const result = await tryConfirmAssignment(
      { ...proposal, taskIds: [taskId], workerId },
      mode,
      source,
    );
    setBusy(false);
    if (result.ok) {
      setCompleted(true);
      return;
    }
    setError(result.error);
  };

  return (
    <div data-testid="task-assignment-card" style={CARD}>
      <div style={TITLE}>{proposal.title ?? action.label}</div>
      {proposal.workflowName ? <div style={META}>Workflow: #{proposal.workflowName}</div> : null}
      {multiple ? (
        <div style={META}>
          Task {currentIndex + 1} of {proposal.taskIds.length}
        </div>
      ) : null}
      <button type="button" style={SECONDARY} onClick={() => onNavigate(`/tasks/${taskId}`)}>
        Open task
      </button>
      <WorkerField
        workerId={workerId}
        workers={workers}
        disabled={busy || completed}
        onChange={setWorkerId}
      />
      {error ? (
        <div role="alert" style={ERROR}>
          {error}
        </div>
      ) : null}
      <AssignmentActions
        busy={busy}
        completed={completed}
        hasNext={hasNext}
        canConfirm={Boolean(workerId)}
        onConfirm={confirm}
        onNext={() => {
          setCurrentIndex((index) => index + 1);
          setCompleted(false);
          setError(null);
        }}
      />
    </div>
  );
};

const MultiTaskAssignmentForm = ({
  action,
  proposal,
  source,
  assignedWorkerId,
  workers,
  onNavigate,
}: {
  action: ChatActionPayload;
  proposal: TaskAssignmentFields;
  source?: { sessionId: string; messageId: string };
  assignedWorkerId: string | null;
  workers: Array<{ id: string; name: string }>;
  onNavigate: (path: string) => void;
}) => {
  const candidates = proposal.candidates ?? [];
  const [error, setError] = useState<string | null>(action.error ?? null);
  const [busy, setBusy] = useState(false);
  const [workerId, setWorkerId] = useState(proposal.workerId ?? assignedWorkerId ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(proposal.taskIds.filter((id) => candidates.some((c) => c.id === id))),
  );
  const [completed, setCompleted] = useState(
    action.status === "confirmed" || assignedWorkerId !== null,
  );

  const toggle = (taskId: string) => {
    if (busy || completed) return;
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const confirm = async (mode: "assign" | "start") => {
    if (!workerId || selected.size === 0 || busy || completed) return;
    setBusy(true);
    setError(null);
    const result = await tryConfirmAssignment(
      { ...proposal, taskIds: [...selected], workerId, candidates: undefined },
      mode,
      source,
    );
    setBusy(false);
    if (result.ok) {
      setCompleted(true);
      return;
    }
    setError(result.error);
  };

  return (
    <div data-testid="task-assignment-card" style={CARD}>
      <div style={TITLE}>{proposal.title ?? action.label}</div>
      {proposal.workflowName ? <div style={META}>Workflow: #{proposal.workflowName}</div> : null}
      <div style={META}>
        {selected.size} of {candidates.length} selected
      </div>
      <fieldset aria-label="Backlog tasks" style={TASK_LIST}>
        {candidates.map((candidate) => (
          <label key={candidate.id} style={TASK_ROW}>
            <input
              type="checkbox"
              checked={selected.has(candidate.id)}
              disabled={busy || completed}
              onChange={() => toggle(candidate.id)}
              aria-label={candidate.title}
            />
            <span style={TASK_TITLE}>{candidate.title}</span>
            <button
              type="button"
              style={LINKISH}
              onClick={(event) => {
                event.preventDefault();
                onNavigate(`/tasks/${candidate.id}`);
              }}
            >
              Open
            </button>
          </label>
        ))}
      </fieldset>
      <WorkerField
        workerId={workerId}
        workers={workers}
        disabled={busy || completed}
        onChange={setWorkerId}
      />
      {error ? (
        <div role="alert" style={ERROR}>
          {error}
        </div>
      ) : null}
      <AssignmentActions
        busy={busy}
        completed={completed}
        hasNext={false}
        canConfirm={Boolean(workerId) && selected.size > 0}
        onConfirm={confirm}
        onNext={() => {}}
      />
    </div>
  );
};

const WorkerField = ({
  workerId,
  workers,
  disabled,
  onChange,
}: {
  workerId: string;
  workers: Array<{ id: string; name: string }>;
  disabled: boolean;
  onChange: (id: string) => void;
}) => (
  <div style={FIELD}>
    Worker
    <Select value={workerId} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger aria-label="Worker" className="w-full">
        <SelectValue placeholder="Choose a worker" />
      </SelectTrigger>
      <SelectContent>
        {workers.map((worker) => (
          <SelectItem key={worker.id} value={worker.id}>
            {worker.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
);

const AssignmentActions = ({
  busy,
  completed,
  hasNext,
  canConfirm,
  onConfirm,
  onNext,
}: {
  busy: boolean;
  completed: boolean;
  hasNext: boolean;
  canConfirm: boolean;
  onConfirm: (mode: "assign" | "start") => Promise<void>;
  onNext: () => void;
}) => (
  <div style={ACTIONS}>
    {completed ? (
      <div style={OK}>Assigned</div>
    ) : (
      <>
        <button
          type="button"
          disabled={busy || !canConfirm}
          style={SECONDARY}
          onClick={() => void onConfirm("assign")}
        >
          Assign
        </button>
        <button
          type="button"
          disabled={busy || !canConfirm}
          style={PRIMARY}
          onClick={() => void onConfirm("start")}
        >
          Assign and Start
        </button>
      </>
    )}
    {completed && hasNext ? (
      <button
        type="button"
        aria-label="Next task"
        title="Next task"
        style={PRIMARY}
        onClick={onNext}
      >
        <ArrowRightIcon className="size-4" strokeWidth={1.7} />
      </button>
    ) : null}
  </div>
);

export const tryConfirmAssignment = async (
  fields: TaskAssignmentFields,
  mode: "assign" | "start",
  source?: { sessionId: string; messageId: string },
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    await confirmTaskAssignment(fields, mode, source);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: formatAssignmentError(err) };
  }
};

const assignedWorkerForTasks = (
  taskIds: string[],
  tasks: Array<{ id: string; assignedAgentId?: string | null }>,
): string | null => {
  if (taskIds.length === 0) return null;
  const assigned = taskIds.map((id) => tasks.find((task) => task.id === id)?.assignedAgentId);
  const workerId = assigned[0];
  return workerId && assigned.every((candidate) => candidate === workerId) ? workerId : null;
};

const formatAssignmentError = (error: unknown): string => {
  if (error && typeof error === "object") {
    const candidate = error as { code?: unknown; message?: unknown };
    const message = typeof candidate.message === "string" ? candidate.message : String(error);
    return typeof candidate.code === "string" ? `${candidate.code}: ${message}` : message;
  }
  return String(error);
};

const CARD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  marginTop: 11,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  padding: "11px 13px",
  maxWidth: "min(480px, 100%)",
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
const FIELD: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  fontWeight: 500,
  color: "var(--color-text-muted)",
};
const TASK_LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  maxHeight: 220,
  overflowY: "auto",
  padding: "4px 0",
};
const TASK_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--color-text)",
  cursor: "pointer",
};
const TASK_TITLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontFamily: "var(--font-mono)",
  fontSize: 11,
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
const ACTIONS: CSSProperties = { display: "flex", flexWrap: "wrap", gap: 8 };
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
  color: "var(--color-blocked)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 500,
};
const OK: CSSProperties = {
  color: "var(--color-ok)",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 600,
};
