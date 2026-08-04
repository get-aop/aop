import { CheckpointFailure } from "./checkpoint-command.ts";

const SEGMENT = "[A-Za-z0-9][A-Za-z0-9_-]*";
const RUN_REF = new RegExp(`^refs/aop/chat-checkpoints/(${SEGMENT})/(${SEGMENT})/(before|after)$`);
const REVERT_REF = new RegExp(
  `^refs/aop/chat-checkpoints/(${SEGMENT})/reverts/(${SEGMENT})/backup$`,
);

export type CheckpointRefSide = "before" | "after";

export interface RunCheckpointRef {
  kind: "run";
  ref: string;
  sessionId: string;
  runId: string;
  side: CheckpointRefSide;
}

export interface RevertBackupCheckpointRef {
  kind: "revert-backup";
  ref: string;
  sessionId: string;
  operationId: string;
}

export type ParsedCheckpointRef = RunCheckpointRef | RevertBackupCheckpointRef;

export const buildRunCheckpointRef = (
  sessionId: string,
  runId: string,
  side: CheckpointRefSide,
): string =>
  validateWorkspaceCheckpointRef(`refs/aop/chat-checkpoints/${sessionId}/${runId}/${side}`);

export const buildRevertBackupCheckpointRef = (sessionId: string, operationId: string): string =>
  validateWorkspaceCheckpointRef(
    `refs/aop/chat-checkpoints/${sessionId}/reverts/${operationId}/backup`,
  );

/**
 * The single canonical parser for the hidden checkpoint namespace. Every caller
 * that needs the session, run, or revert-operation encoded in a ref must go
 * through this so ownership rules cannot drift between modules.
 */
export const parseWorkspaceCheckpointRef = (ref: string): ParsedCheckpointRef | null => {
  const revert = REVERT_REF.exec(ref);
  if (revert?.[1] && revert[2]) {
    return { kind: "revert-backup", ref, sessionId: revert[1], operationId: revert[2] };
  }
  const run = RUN_REF.exec(ref);
  if (run?.[1] && run[2] && run[3]) {
    return {
      kind: "run",
      ref,
      sessionId: run[1],
      runId: run[2],
      side: run[3] as CheckpointRefSide,
    };
  }
  return null;
};

export const validateWorkspaceCheckpointRef = (ref: string): string => {
  if (!parseWorkspaceCheckpointRef(ref)) {
    throw new CheckpointFailure({
      code: "INVALID_REF",
      message: `Invalid workspace checkpoint ref: ${ref}`,
    });
  }
  return ref;
};

export const isWorkspaceCheckpointRef = (ref: string): boolean =>
  parseWorkspaceCheckpointRef(ref) !== null;
