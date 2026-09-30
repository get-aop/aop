import type { SessionDiffFileStatus } from "./session-git.ts";

export type ChatCheckpointCaptureStatus = "pending" | "ready" | "failed" | "unsupported";

export interface ChatTurnDiffFileSummary {
  path: string;
  oldPath: string | null;
  status: SessionDiffFileStatus;
  additions: number;
  deletions: number;
  binary: boolean;
  detailsPending: true;
}
