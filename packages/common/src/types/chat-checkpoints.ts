import type { ChatSessionSummary } from "./chat-session-summary.ts";
import type { SessionDiffFile, SessionDiffFileStatus } from "./session-git.ts";

export type ChatCheckpointCaptureStatus = "pending" | "ready" | "failed" | "unsupported";

export type ChatCheckpointAvailability = ChatCheckpointCaptureStatus | "workspace-mismatch";

export type ChatTurnDiffStatus = ChatCheckpointCaptureStatus | "empty";

export interface ChatTurnDiffFileSummary {
  path: string;
  oldPath: string | null;
  status: SessionDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  detailsPending: true;
}

export interface ChatTurnDiffTotals {
  filesChanged: number;
  additions: number;
  deletions: number;
}

export interface ChatTurnDiffSummary {
  id: string;
  runId: string;
  status: ChatTurnDiffStatus;
  files: ChatTurnDiffFileSummary[];
  totals: ChatTurnDiffTotals;
  detailsPending: true;
}

export interface ChatTurnDiffResponse {
  id: string;
  runId: string;
  status: ChatTurnDiffStatus;
  files: SessionDiffFile[];
  totals: ChatTurnDiffTotals;
}

export type ChatRevertAvailability = ChatCheckpointAvailability;

/**
 * Result of applying a revert. Temporary backup refs and cleanup bookkeeping
 * stay server-side; only the trimmed counts and the updated session are wired.
 */
export interface ChatRevertResult {
  sessionId: string;
  targetMessageId: string;
  removedMessageCount: number;
  removedRunCount: number;
  /** The session as it stands after trimming, so clients need no follow-up fetch. */
  session: ChatSessionSummary;
  updatedAt: string;
}

export interface SessionRevertedSsePayload extends ChatRevertResult {
  type: "session-reverted";
}
