export type RuntimeEventKind =
  | "session_started"
  | "session_resumed"
  | "session_completed"
  | "session_failed"
  | "session_interrupted"
  | "assistant_text"
  | "assistant_summary"
  | "tool_started"
  | "tool_completed"
  | "worker_attention"
  | "supervisor_decision_requested"
  | "task_blocked"
  | "handoff_produced"
  | "verification_evidence_recorded"
  | "scheduler_triggered"
  | "scheduler_promoted"
  | "scheduler_skipped"
  | "scheduler_failed";

export interface RuntimeEvent {
  id: string;
  taskId: string;
  executionId: string;
  stepExecutionId: string;
  sessionId: string | null;
  agentId: string | null;
  kind: RuntimeEventKind;
  title: string | null;
  message: string | null;
  toolName: string | null;
  status: string | null;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export type VerificationEvidenceKind =
  | "task_document"
  | "test_command"
  | "typecheck_command"
  | "lint_command"
  | "build_command"
  | "pull_request"
  | "ci_check"
  | "human_approval"
  | "review_verdict"
  | "runtime_review";

export type VerificationEvidenceStatus = "passed" | "failed" | "skipped";

export interface VerificationEvidence {
  kind: VerificationEvidenceKind;
  status: VerificationEvidenceStatus;
  summary: string;
  command?: string;
  source?: string;
  exitCode?: number | null;
  startedAt: string;
  endedAt: string;
  artifactPath?: string;
}

export interface RuntimeActivitySummary {
  sessionId: string | null;
  sessionState: "idle" | "running" | "completed" | "failed" | "interrupted";
  latestEventKind: RuntimeEventKind | null;
  latestEventAt: string | null;
  latestMessage: string | null;
  needsAttention: boolean;
  blocked: boolean;
  handoffProduced: boolean;
  verificationEvidenceRecorded: boolean;
}
