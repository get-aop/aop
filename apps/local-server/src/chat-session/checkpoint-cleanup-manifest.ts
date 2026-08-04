import { createHash } from "node:crypto";
import type {
  ChatRevertOperation,
  ChatRunCheckpoint,
  NewChatCheckpointCleanupJob,
} from "../db/chat-history-schema.ts";
import {
  type ParsedCheckpointRef,
  parseWorkspaceCheckpointRef,
} from "../session-git/checkpoint-refs.ts";

export type CleanupManifestErrorCode =
  | "MALFORMED_REFS_JSON"
  | "INVALID_REF"
  | "REF_OWNERSHIP_MISMATCH"
  | "UNKNOWN_RUN"
  | "MISSING_WORKSPACE_IDENTITY";

export class CleanupManifestError extends Error {
  readonly code: CleanupManifestErrorCode;

  constructor(code: CleanupManifestErrorCode, message: string) {
    super(message);
    this.name = "CleanupManifestError";
    this.code = code;
  }
}

export interface CleanupWorkspaceIdentity {
  workspacePath: string;
  worktreeRoot: string;
  gitCommonDir: string;
}

export interface CleanupManifest extends CleanupWorkspaceIdentity {
  refs: string[];
  sessionIds: string[];
}

/** Checkpoint row fields the manifest needs; keeps this module free of Kysely types. */
export interface CheckpointRefRow extends CleanupWorkspaceIdentity {
  runId: string;
  beforeRef: string;
  afterRef: string;
}

/** Revert-operation fields the manifest needs. */
export interface RevertRefRow {
  id: string;
  sessionId: string;
  targetRunId: string;
  targetCheckpointRef: string;
  backupCheckpointRef: string;
  refsToDeleteJson: string;
}

export interface CleanupManifestInput {
  checkpoints: readonly CheckpointRefRow[];
  revertOperations: readonly RevertRefRow[];
  /** Session that owns each checkpoint run id. Checkpoint rows carry no session column. */
  runSessionIds: ReadonlyMap<string, string>;
}

/**
 * Strict `refs_json` / `refs_to_delete_json` parsing. Malformed JSON must never
 * degrade into an empty manifest, because that silently orphans hidden refs.
 */
export const parseCleanupRefsJson = (value: string, context: string): string[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new CleanupManifestError(
      "MALFORMED_REFS_JSON",
      `${context} does not contain valid JSON: ${truncate(value)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new CleanupManifestError("MALFORMED_REFS_JSON", `${context} is not a JSON array`);
  }
  return parsed.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      throw new CleanupManifestError(
        "MALFORMED_REFS_JSON",
        `${context} entry ${index} is not a non-empty ref string`,
      );
    }
    return entry;
  });
};

/** Parses a ref and rejects anything outside the canonical checkpoint namespace. */
export const requireParsedCheckpointRef = (ref: string, context: string): ParsedCheckpointRef => {
  const parsed = parseWorkspaceCheckpointRef(ref);
  if (!parsed) {
    throw new CleanupManifestError("INVALID_REF", `${context} is not a checkpoint ref: ${ref}`);
  }
  return parsed;
};

/**
 * Groups every ref that must be deleted by its exact canonical workspace
 * identity. Revert refs are attached only when their target checkpoint ref is
 * an exact member of a group; there is deliberately no "one group left" guess.
 */
export const buildCleanupManifests = (input: CleanupManifestInput): CleanupManifest[] => {
  const groups = groupCheckpointRows(input.checkpoints, input.runSessionIds);
  for (const operation of input.revertOperations) attachRevertRefs(groups, operation);
  return [...groups.values()]
    .map((group) => ({
      workspacePath: group.workspacePath,
      worktreeRoot: group.worktreeRoot,
      gitCommonDir: group.gitCommonDir,
      refs: [...group.refs].sort(),
      sessionIds: [...group.sessionIds].sort(),
    }))
    .filter((manifest) => manifest.refs.length > 0)
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)));
};

/**
 * Cleanup job ids are content-addressed so a retried deletion reuses the same
 * row instead of stacking duplicate pending work for identical refs.
 */
export const toCleanupJobRows = (
  manifests: readonly CleanupManifest[],
  now: string,
): NewChatCheckpointCleanupJob[] =>
  manifests.map((manifest) => ({
    id: cleanupJobId(manifest),
    workspace_path: manifest.workspacePath,
    worktree_root: manifest.worktreeRoot,
    git_common_dir: manifest.gitCommonDir,
    refs_json: JSON.stringify(manifest.refs),
    session_ids_json: JSON.stringify(manifest.sessionIds),
    status: "pending" as const,
    error_message: null,
    claim_token: null,
    claimed_at: null,
    attempts: 0,
    created_at: now,
    updated_at: now,
    completed_at: null,
  }));

/** One-shot plan used by every caller that deletes checkpoint-backed rows. */
export const planCleanupJobs = (
  input: CleanupManifestInput & { now: string },
): NewChatCheckpointCleanupJob[] => toCleanupJobRows(buildCleanupManifests(input), input.now);

export const toCheckpointRefRow = (checkpoint: ChatRunCheckpoint): CheckpointRefRow => ({
  runId: checkpoint.run_id,
  workspacePath: checkpoint.workspace_path,
  worktreeRoot: checkpoint.worktree_root,
  gitCommonDir: checkpoint.git_common_dir,
  beforeRef: checkpoint.before_ref,
  afterRef: checkpoint.after_ref,
});

export const toRevertRefRow = (operation: ChatRevertOperation): RevertRefRow => ({
  id: operation.id,
  sessionId: operation.session_id,
  targetRunId: operation.target_run_id,
  targetCheckpointRef: operation.target_checkpoint_ref,
  backupCheckpointRef: operation.backup_checkpoint_ref,
  refsToDeleteJson: operation.refs_to_delete_json,
});

export const cleanupJobId = (manifest: CleanupManifest): string => {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        manifest.workspacePath,
        manifest.worktreeRoot,
        manifest.gitCommonDir,
        manifest.refs,
      ]),
    )
    .digest("hex");
  return `cleanup_${digest.slice(0, 32)}`;
};

interface CleanupGroup extends CleanupWorkspaceIdentity {
  /** Immutable set of run checkpoint refs, used for exact revert identity matching. */
  checkpointRefs: Set<string>;
  refs: Set<string>;
  sessionIds: Set<string>;
}

const groupCheckpointRows = (
  checkpoints: readonly CheckpointRefRow[],
  runSessionIds: ReadonlyMap<string, string>,
): Map<string, CleanupGroup> => {
  const groups = new Map<string, CleanupGroup>();
  for (const checkpoint of checkpoints) {
    const sessionId = runSessionIds.get(checkpoint.runId);
    if (!sessionId) {
      throw new CleanupManifestError(
        "UNKNOWN_RUN",
        `Checkpoint run ${checkpoint.runId} has no owning session in this cleanup plan`,
      );
    }
    const key = identityKey(checkpoint);
    const group = groups.get(key) ?? {
      workspacePath: checkpoint.workspacePath,
      worktreeRoot: checkpoint.worktreeRoot,
      gitCommonDir: checkpoint.gitCommonDir,
      checkpointRefs: new Set<string>(),
      refs: new Set<string>(),
      sessionIds: new Set<string>(),
    };
    for (const ref of [checkpoint.beforeRef, checkpoint.afterRef]) {
      requireRunRefOwnership(ref, sessionId, checkpoint.runId);
      group.checkpointRefs.add(ref);
      group.refs.add(ref);
    }
    group.sessionIds.add(sessionId);
    groups.set(key, group);
  }
  return groups;
};

const attachRevertRefs = (groups: Map<string, CleanupGroup>, operation: RevertRefRow): void => {
  const refs = collectRevertRefs(operation);
  const group = [...groups.values()].find((candidate) =>
    candidate.checkpointRefs.has(operation.targetCheckpointRef),
  );
  if (!group) {
    throw new CleanupManifestError(
      "MISSING_WORKSPACE_IDENTITY",
      `Revert operation ${operation.id} has no checkpoint with an exact workspace identity for ${operation.targetCheckpointRef}`,
    );
  }
  for (const ref of refs) group.refs.add(ref);
  group.sessionIds.add(operation.sessionId);
};

const collectRevertRefs = (operation: RevertRefRow): string[] => {
  requireRunRefOwnership(
    operation.targetCheckpointRef,
    operation.sessionId,
    operation.targetRunId,
    `Revert operation ${operation.id} target ref`,
  );
  requireBackupRefOwnership(operation.backupCheckpointRef, operation.sessionId, operation.id);

  const context = `Revert operation ${operation.id} refs_to_delete_json`;
  const trimmed = parseCleanupRefsJson(operation.refsToDeleteJson, context);
  for (const ref of trimmed) {
    const parsed = requireParsedCheckpointRef(ref, context);
    if (parsed.sessionId !== operation.sessionId) {
      throw new CleanupManifestError(
        "REF_OWNERSHIP_MISMATCH",
        `${context} contains ref ${ref} owned by session ${parsed.sessionId}, expected ${operation.sessionId}`,
      );
    }
    if (parsed.kind === "revert-backup" && parsed.operationId !== operation.id) {
      throw new CleanupManifestError(
        "REF_OWNERSHIP_MISMATCH",
        `${context} contains backup ref ${ref} owned by operation ${parsed.operationId}`,
      );
    }
  }
  return [operation.targetCheckpointRef, operation.backupCheckpointRef, ...trimmed];
};

const requireRunRefOwnership = (
  ref: string,
  sessionId: string,
  runId: string,
  context = `Checkpoint ref for run ${runId}`,
): void => {
  const parsed = requireParsedCheckpointRef(ref, context);
  if (parsed.kind !== "run") {
    throw new CleanupManifestError(
      "REF_OWNERSHIP_MISMATCH",
      `${context} must be a run checkpoint ref: ${ref}`,
    );
  }
  if (parsed.sessionId !== sessionId || parsed.runId !== runId) {
    throw new CleanupManifestError(
      "REF_OWNERSHIP_MISMATCH",
      `${context} ${ref} is owned by ${parsed.sessionId}/${parsed.runId}, expected ${sessionId}/${runId}`,
    );
  }
};

const requireBackupRefOwnership = (ref: string, sessionId: string, operationId: string): void => {
  const context = `Revert operation ${operationId} backup ref`;
  const parsed = requireParsedCheckpointRef(ref, context);
  if (
    parsed.kind !== "revert-backup" ||
    parsed.sessionId !== sessionId ||
    parsed.operationId !== operationId
  ) {
    throw new CleanupManifestError(
      "REF_OWNERSHIP_MISMATCH",
      `${context} ${ref} is not owned by ${sessionId}/${operationId}`,
    );
  }
};

const identityKey = (identity: CleanupWorkspaceIdentity): string =>
  JSON.stringify([identity.workspacePath, identity.worktreeRoot, identity.gitCommonDir]);

const truncate = (value: string): string => (value.length > 80 ? `${value.slice(0, 80)}…` : value);
