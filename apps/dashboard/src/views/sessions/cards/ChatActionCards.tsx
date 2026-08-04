import type { ChatActionPayload } from "@aop/common";
import { type CSSProperties, useState } from "react";
import { approveHandoff, createAgent, rejectHandoff, saveWorkflow } from "../../../api/client";
import {
  asApproval,
  asWorkflowPreview,
  isTypedChatCard,
  unknownCardFallbackText,
} from "./chat-cards";
import { TaskAssignmentCard } from "./TaskAssignmentCard";
import { TaskBatchAssignmentCard } from "./TaskBatchAssignmentCard";

interface ChatActionCardsProps {
  sessionId?: string | null;
  messageId?: string;
  action: ChatActionPayload;
  onNavigate: (path: string) => void;
  onLegacyAction: (action: ChatActionPayload) => void;
  tasks?: Array<{ id: string; status: string; assignedAgentId?: string | null }>;
  workers?: Array<{ id: string; name: string }>;
}

export const ChatActionCards = ({
  sessionId,
  messageId,
  action,
  onNavigate,
  onLegacyAction,
  tasks = [],
  workers = [],
}: ChatActionCardsProps) => {
  if (!isTypedChatCard(action)) {
    return (
      <button type="button" onClick={() => onLegacyAction(action)} style={LEGACY_BUTTON}>
        <strong>{action.label}</strong>
        <span>
          {action.sub} · {action.meta}
        </span>
      </button>
    );
  }

  if (action.type === "task-assignment") {
    return (
      <TaskAssignmentCard
        action={action}
        sessionId={sessionId}
        messageId={messageId}
        tasks={tasks}
        workers={workers}
        onNavigate={onNavigate}
      />
    );
  }
  if (action.type === "task-batch-assignment") {
    return (
      <TaskBatchAssignmentCard
        action={action}
        sessionId={sessionId}
        messageId={messageId}
        tasks={tasks}
        workers={workers}
        onNavigate={onNavigate}
      />
    );
  }
  if (action.type === "task-live") {
    return <TaskLiveCard action={action} tasks={tasks} onNavigate={onNavigate} />;
  }
  if (action.type === "workflow-preview") {
    return <WorkflowPreviewCard action={action} onNavigate={onNavigate} />;
  }
  if (action.type === "approval") {
    return <ApprovalCard action={action} />;
  }
  if (action.type === "worker-card") {
    return <WorkerProposalCard action={action} onNavigate={onNavigate} />;
  }
  if (action.type === "status-summary") {
    return (
      <div data-testid="status-summary-card" style={CARD}>
        <div style={TITLE}>{action.label}</div>
        <div style={META}>{action.sub}</div>
        <button type="button" style={SECONDARY} onClick={() => onNavigate("/pool")}>
          Open Pool
        </button>
      </div>
    );
  }

  return <p style={META}>{unknownCardFallbackText(action)}</p>;
};

const TaskLiveCard = ({
  action,
  tasks,
  onNavigate,
}: {
  action: ChatActionPayload;
  tasks: Array<{ id: string; status: string }>;
  onNavigate: (path: string) => void;
}) => {
  const taskId = action.id;
  const live = taskId ? tasks.find((task) => task.id === taskId) : undefined;
  const status = live?.status ?? action.meta;
  return (
    <div data-testid="task-live-card" style={CARD}>
      <div style={TITLE}>{action.label}</div>
      <div style={META}>
        {action.sub} · {status}
      </div>
      {taskId ? (
        <button type="button" style={PRIMARY} onClick={() => onNavigate(`/tasks/${taskId}`)}>
          Open task
        </button>
      ) : null}
    </div>
  );
};

const WorkflowPreviewCard = ({
  action,
  onNavigate,
}: {
  action: ChatActionPayload;
  onNavigate: (path: string) => void;
}) => {
  const preview = asWorkflowPreview(action);
  const [status, setStatus] = useState(action.status ?? "proposed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!preview) return <p style={META}>{unknownCardFallbackText(action)}</p>;

  const hasFullDefinition = Boolean(
    preview.definition &&
      typeof preview.definition === "object" &&
      Array.isArray((preview.definition as { steps?: unknown }).steps),
  );

  const save = async () => {
    if (busy || status === "confirmed" || !hasFullDefinition) return;
    setBusy(true);
    setError(null);
    try {
      const steps = (preview.definition as { steps: unknown }).steps;
      await saveWorkflow({
        name: preview.name,
        steps: steps as never,
      });
      setStatus("confirmed");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setBusy(false);
    }
  };

  const openStudio = () =>
    onNavigate(
      preview.workflowId ? `/workflows/${encodeURIComponent(preview.workflowId)}` : "/workflows",
    );

  return (
    <div data-testid="workflow-preview-card" style={CARD}>
      <div style={TITLE}>{preview.name}</div>
      <ol
        style={{
          margin: "8px 0",
          paddingLeft: 18,
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          fontWeight: 500,
        }}
      >
        {preview.steps.map((step) => (
          <li key={step.id}>
            {step.id} · {step.type}
            {step.model ? ` · ${step.model}` : ""}
          </li>
        ))}
      </ol>
      {error ? (
        <div role="alert" style={ERROR}>
          {error}
        </div>
      ) : null}
      {!hasFullDefinition ? (
        <p style={META}>Open in Studio to finish the workflow definition before saving.</p>
      ) : null}
      <div style={ACTIONS}>
        {hasFullDefinition ? (
          <button
            type="button"
            style={PRIMARY}
            disabled={busy || status === "confirmed"}
            onClick={() => void save()}
          >
            {status === "confirmed" ? "Saved" : "Save"}
          </button>
        ) : null}
        <button type="button" style={hasFullDefinition ? SECONDARY : PRIMARY} onClick={openStudio}>
          Open in Studio
        </button>
      </div>
    </div>
  );
};

const ApprovalCard = ({ action }: { action: ChatActionPayload }) => {
  const approval = asApproval(action);
  const [status, setStatus] = useState(action.status ?? "proposed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!approval) return <p style={META}>{unknownCardFallbackText(action)}</p>;

  const act = async (kind: "approve" | "return") => {
    if (busy || status === "confirmed") return;
    const repoId = approval.repoId;
    if (!repoId) {
      setError("Repository information is missing for this approval.");
      setStatus("error");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await tryApprovalAction(kind, repoId, approval.taskId);
    setBusy(false);
    if (result.ok) setStatus("confirmed");
    else {
      setError(result.error);
      setStatus("error");
    }
  };

  return (
    <div data-testid="approval-card" style={CARD}>
      <div style={TITLE}>{approval.title}</div>
      <div style={META}>Task {approval.taskId}</div>
      {error ? (
        <div role="alert" style={ERROR}>
          {error}
        </div>
      ) : null}
      <div style={ACTIONS}>
        <button
          type="button"
          style={PRIMARY}
          disabled={busy || status === "confirmed"}
          onClick={() => void act("approve")}
        >
          Approve
        </button>
        <button
          type="button"
          style={SECONDARY}
          disabled={busy || status === "confirmed"}
          onClick={() => void act("return")}
        >
          Return
        </button>
      </div>
    </div>
  );
};

const WorkerProposalCard = ({
  action,
  onNavigate,
}: {
  action: ChatActionPayload;
  onNavigate: (path: string) => void;
}) => {
  const proposal = action.proposal as {
    name?: string;
    role?: string;
    workflowId?: string;
    repoIds?: string[];
  } | null;
  const [status, setStatus] = useState(action.status ?? "proposed");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!proposal?.name || busy || status === "confirmed") return;
    setBusy(true);
    const result = await tryRegisterWorker(proposal);
    setBusy(false);
    if (result.ok) setStatus("confirmed");
    else {
      setError(result.error);
      setStatus("error");
    }
  };

  return (
    <div data-testid="worker-card" style={CARD}>
      <div style={TITLE}>{proposal?.name ?? action.label}</div>
      <div style={META}>{proposal?.role ?? action.meta}</div>
      {error ? (
        <div role="alert" style={ERROR}>
          {error}
        </div>
      ) : null}
      <div style={ACTIONS}>
        <button
          type="button"
          style={PRIMARY}
          disabled={busy || status === "confirmed"}
          onClick={() => void confirm()}
        >
          {status === "confirmed" ? "Registered" : "Confirm worker"}
        </button>
        <button type="button" style={SECONDARY} onClick={() => onNavigate("/workers")}>
          Open Workers
        </button>
      </div>
    </div>
  );
};

const tryApprovalAction = async (
  kind: "approve" | "return",
  repoId: string,
  taskId: string,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    if (kind === "approve") await approveHandoff(repoId, taskId);
    else
      await rejectHandoff(repoId, taskId, {
        action: "return_to_draft",
        reason: "Returned from chat",
      });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const tryRegisterWorker = async (proposal: {
  name?: string;
  role?: string;
  workflowId?: string;
  repoIds?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> => {
  try {
    await createAgent({
      name: proposal.name ?? "Worker",
      role: (proposal.role as "developer") ?? "developer",
      workflowId: proposal.workflowId ?? "aop-default-gpt",
      repoIds: proposal.repoIds ?? [],
      integrationMode: "worker",
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
};

const CARD: CSSProperties = {
  marginTop: 11,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  boxShadow: "var(--shadow-1)",
  padding: "12px 14px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
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
const LEGACY_BUTTON: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  marginTop: 11,
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-strong)",
  borderRadius: 12,
  padding: "11px 13px",
  cursor: "pointer",
  textAlign: "left",
  color: "var(--color-text)",
};
