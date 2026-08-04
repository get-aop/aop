import { randomUUID } from "node:crypto";
import { getLogger } from "@aop/infra";
import type { ChatCheckpointCleanupJob } from "../db/chat-history-schema.ts";
import type { CheckpointGitOptions } from "../session-git/checkpoint-types.ts";
import {
  deleteWorkspaceCheckpointRefs,
  resolveCheckpointWorkspaceIdentity,
} from "../session-git/checkpoints.ts";
import {
  CleanupManifestError,
  parseCleanupRefsJson,
  requireParsedCheckpointRef,
} from "./checkpoint-cleanup-manifest.ts";
import type { ChatCheckpointCleanupRepository } from "./checkpoint-cleanup-repository.ts";

const logger = getLogger("chat-checkpoint-cleanup");

/** How long a claim stays valid before another worker may take the job over. */
export const CLEANUP_CLAIM_LEASE_MS = 5 * 60_000;

export interface CheckpointCleanupDeps {
  repository: ChatCheckpointCleanupRepository;
  git?: CheckpointGitOptions;
  now?: () => Date;
  newToken?: () => string;
  deleteRefs?: typeof deleteWorkspaceCheckpointRefs;
  resolveIdentity?: typeof resolveCheckpointWorkspaceIdentity;
}

export interface CheckpointCleanupOptions {
  /** Restricts processing to jobs a destructive flow just persisted. */
  jobIds?: readonly string[];
  limit?: number;
  /** 0 recovers every abandoned claim immediately, which is what startup wants. */
  leaseMs?: number;
}

export interface CheckpointCleanupResult {
  completedJobIds: string[];
  failedJobIds: string[];
}

/**
 * Claims cleanup jobs atomically, deletes their hidden refs only after the live
 * Git identity still matches the stored one, and records the outcome. One
 * failing job never stops the rest; failures stay durable for a later retry.
 */
export const processCheckpointCleanupJobs = async (
  deps: CheckpointCleanupDeps,
  options: CheckpointCleanupOptions = {},
): Promise<CheckpointCleanupResult> => {
  const clock = deps.now ?? (() => new Date());
  const token = deps.newToken?.() ?? randomUUID();
  const startedAt = clock();
  const claimed = await deps.repository.claim({
    token,
    now: startedAt.toISOString(),
    staleBefore: new Date(
      startedAt.getTime() - (options.leaseMs ?? CLEANUP_CLAIM_LEASE_MS),
    ).toISOString(),
    ids: options.jobIds,
    limit: options.limit,
  });

  const result: CheckpointCleanupResult = { completedJobIds: [], failedJobIds: [] };
  for (const job of claimed) {
    const failure = await deleteJobRefs(deps, job);
    const finishedAt = clock().toISOString();
    if (failure) {
      await deps.repository.markFailed(job.id, token, failure, finishedAt);
      result.failedJobIds.push(job.id);
      logger.warn("Checkpoint cleanup job {jobId} failed: {reason}", {
        jobId: job.id,
        reason: failure,
      });
      continue;
    }
    if (await deps.repository.markCompleted(job.id, token, finishedAt)) {
      result.completedJobIds.push(job.id);
      continue;
    }
    // The lease was taken over mid-flight; treat as unfinished so it is retried.
    result.failedJobIds.push(job.id);
    logger.warn("Checkpoint cleanup job {jobId} lost its claim before completion", {
      jobId: job.id,
    });
  }
  return result;
};

/** Startup pass: recovers claims abandoned by a crashed server, then retries. */
export const retryUnfinishedCheckpointCleanup = (
  deps: CheckpointCleanupDeps,
): Promise<CheckpointCleanupResult> => processCheckpointCleanupJobs(deps, { leaseMs: 0 });

/**
 * Boot hook. A failure here must never block startup and must never touch the
 * job rows, so unfinished cleanup survives for the next attempt.
 */
export const runStartupCheckpointCleanup = async (
  repository: ChatCheckpointCleanupRepository,
): Promise<CheckpointCleanupResult | null> => {
  try {
    const result = await retryUnfinishedCheckpointCleanup({ repository });
    if (result.completedJobIds.length > 0 || result.failedJobIds.length > 0) {
      logger.info("Startup checkpoint cleanup finished {completed} and left {failed} for retry", {
        completed: result.completedJobIds.length,
        failed: result.failedJobIds.length,
      });
    }
    return result;
  } catch (error) {
    logger.error("Startup checkpoint cleanup failed; jobs remain durable for retry: {error}", {
      error: String(error),
    });
    return null;
  }
};

const deleteJobRefs = async (
  deps: CheckpointCleanupDeps,
  job: ChatCheckpointCleanupJob,
): Promise<string | null> => {
  let refs: string[];
  try {
    refs = validateJobRefs(job);
  } catch (error) {
    return error instanceof CleanupManifestError
      ? `${error.code}: ${error.message}`
      : String(error);
  }
  if (refs.length === 0) return null;

  const resolveIdentity = deps.resolveIdentity ?? resolveCheckpointWorkspaceIdentity;
  const identity = await resolveIdentity({ workspacePath: job.workspace_path, ...deps.git });
  if (!identity.success) {
    return `WORKSPACE_UNAVAILABLE: ${identity.error.code} ${identity.error.message}`;
  }
  const mismatch = describeIdentityMismatch(job, identity.value);
  if (mismatch) return mismatch;

  const deleteRefs = deps.deleteRefs ?? deleteWorkspaceCheckpointRefs;
  const deleted = await deleteRefs({ workspacePath: job.workspace_path, refs, ...deps.git });
  if (!deleted.success) {
    return `REF_DELETE_FAILED: ${deleted.error.code} ${deleted.error.message}`;
  }
  return null;
};

const validateJobRefs = (job: ChatCheckpointCleanupJob): string[] => {
  const refs = parseCleanupRefsJson(job.refs_json, `Cleanup job ${job.id} refs_json`);
  const owners = new Set(
    parseCleanupRefsJson(job.session_ids_json, `Cleanup job ${job.id} session_ids_json`),
  );
  for (const ref of refs) {
    const parsed = requireParsedCheckpointRef(ref, `Cleanup job ${job.id} ref`);
    // Rows written before ownership was recorded carry no owners; those can only
    // be checked for syntax, and re-verifying identity still guards the delete.
    if (owners.size > 0 && !owners.has(parsed.sessionId)) {
      throw new CleanupManifestError(
        "REF_OWNERSHIP_MISMATCH",
        `Cleanup job ${job.id} ref ${ref} is owned by session ${parsed.sessionId}`,
      );
    }
  }
  return refs;
};

/**
 * Path identity is the only durable proof that the workspace on disk is still
 * the repository the refs were captured in. A moved, missing, or replaced
 * workspace resolves to a different triple and must never be modified.
 */
const describeIdentityMismatch = (
  job: ChatCheckpointCleanupJob,
  identity: { workspacePath: string; worktreeRoot: string; gitCommonDirectory: string },
): string | null => {
  const differences: string[] = [];
  if (identity.workspacePath !== job.workspace_path) {
    differences.push(`workspace_path ${identity.workspacePath} != ${job.workspace_path}`);
  }
  if (identity.worktreeRoot !== job.worktree_root) {
    differences.push(`worktree_root ${identity.worktreeRoot} != ${job.worktree_root}`);
  }
  if (identity.gitCommonDirectory !== job.git_common_dir) {
    differences.push(`git_common_dir ${identity.gitCommonDirectory} != ${job.git_common_dir}`);
  }
  return differences.length === 0 ? null : `IDENTITY_MISMATCH: ${differences.join("; ")}`;
};
