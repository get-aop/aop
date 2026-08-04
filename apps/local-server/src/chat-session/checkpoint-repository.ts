import type { ChatCheckpointCaptureStatus } from "@aop/common";
import type { Kysely } from "kysely";
import { chunkIds, chunkRows } from "../db/batching.ts";
import type {
  ChatRunChangedFile,
  ChatRunCheckpoint,
  NewChatRunChangedFile,
  NewChatRunCheckpoint,
} from "../db/chat-history-schema.ts";
import type { Database } from "../db/schema.ts";
import { parseWorkspaceCheckpointRef } from "../session-git/checkpoint-refs.ts";

export interface ChatCheckpointCaptureUpdate {
  status: ChatCheckpointCaptureStatus;
  oid: string | null;
  error: string | null;
  updatedAt: string;
}

export class ChatCheckpointStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatCheckpointStateError";
  }
}

export interface ChatCheckpointRepository {
  create: (checkpoint: NewChatRunCheckpoint) => Promise<ChatRunCheckpoint>;
  getByRunId: (runId: string) => Promise<ChatRunCheckpoint | null>;
  listByRunIds: (runIds: string[]) => Promise<ChatRunCheckpoint[]>;
  updateBeforeCapture: (
    runId: string,
    update: ChatCheckpointCaptureUpdate,
  ) => Promise<ChatRunCheckpoint | null>;
  updateAfterCapture: (
    runId: string,
    update: ChatCheckpointCaptureUpdate,
  ) => Promise<ChatRunCheckpoint | null>;
  replaceChangedFiles: (
    runId: string,
    files: Array<Omit<NewChatRunChangedFile, "run_id">>,
  ) => Promise<void>;
  listChangedFiles: (runId: string) => Promise<ChatRunChangedFile[]>;
  listChangedFilesByRunIds: (runIds: string[]) => Promise<ChatRunChangedFile[]>;
  listRefsByRunIds: (runIds: string[]) => Promise<ChatRunCheckpoint[]>;
}

export const createChatCheckpointRepository = (db: Kysely<Database>): ChatCheckpointRepository => ({
  create: async (checkpoint) => {
    requireCanonicalRefs(checkpoint);
    await db
      .insertInto("chat_run_checkpoints")
      .values(checkpoint)
      .onConflict((oc) => oc.column("run_id").doNothing())
      .execute();
    return db
      .selectFrom("chat_run_checkpoints")
      .selectAll()
      .where("run_id", "=", checkpoint.run_id)
      .executeTakeFirstOrThrow();
  },

  getByRunId: async (runId) =>
    (await db
      .selectFrom("chat_run_checkpoints")
      .selectAll()
      .where("run_id", "=", runId)
      .executeTakeFirst()) ?? null,

  listByRunIds: (runIds) => listCheckpoints(db, runIds),

  updateBeforeCapture: (runId, update) => updateCapture(db, runId, "before", update),

  updateAfterCapture: (runId, update) => updateCapture(db, runId, "after", update),

  replaceChangedFiles: async (runId, files) => {
    // One transaction for the whole replacement; the inserts are chunked inside
    // it so a large diff cannot exceed SQLite's bind-parameter limit.
    await db.transaction().execute(async (trx) => {
      await trx.deleteFrom("chat_run_changed_files").where("run_id", "=", runId).execute();
      for (const batch of chunkRows(files.map((file) => ({ ...file, run_id: runId })))) {
        await trx.insertInto("chat_run_changed_files").values(batch).execute();
      }
    });
  },

  listChangedFiles: (runId) =>
    db
      .selectFrom("chat_run_changed_files")
      .selectAll()
      .where("run_id", "=", runId)
      .orderBy("path")
      .execute(),

  listChangedFilesByRunIds: (runIds) => listChangedFiles(db, runIds),

  listRefsByRunIds: (runIds) => listCheckpoints(db, runIds),
});

/**
 * Both refs must be canonical so ownership stays provable, and the audit
 * columns stay honest: `branch`/`head_oid` may be null (detached HEAD, unborn
 * repository) but a ref is never optional.
 */
const requireCanonicalRefs = (checkpoint: NewChatRunCheckpoint): void => {
  for (const ref of [checkpoint.before_ref, checkpoint.after_ref]) {
    const parsed = parseWorkspaceCheckpointRef(ref);
    if (parsed?.kind !== "run" || parsed.runId !== checkpoint.run_id) {
      throw new ChatCheckpointStateError(
        `Checkpoint ref ${ref} is not a canonical run ref for ${checkpoint.run_id}`,
      );
    }
  }
};

/** A ready capture always names a commit; every other status never does. */
const requireCaptureConsistency = (
  runId: string,
  side: "before" | "after",
  update: ChatCheckpointCaptureUpdate,
): void => {
  if (update.status === "ready" && !update.oid) {
    throw new ChatCheckpointStateError(
      `Checkpoint ${runId}/${side} cannot be ready without a captured commit`,
    );
  }
  if (update.status !== "ready" && update.oid) {
    throw new ChatCheckpointStateError(
      `Checkpoint ${runId}/${side} is ${update.status} and must not carry a commit`,
    );
  }
};

const updateCapture = async (
  db: Kysely<Database>,
  runId: string,
  side: "before" | "after",
  update: ChatCheckpointCaptureUpdate,
): Promise<ChatRunCheckpoint | null> => {
  requireCaptureConsistency(runId, side, update);
  const patch =
    side === "before"
      ? {
          before_status: update.status,
          before_oid: update.oid,
          before_error: update.error,
          updated_at: update.updatedAt,
        }
      : {
          after_status: update.status,
          after_oid: update.oid,
          after_error: update.error,
          updated_at: update.updatedAt,
        };
  await db.updateTable("chat_run_checkpoints").set(patch).where("run_id", "=", runId).execute();
  return (
    (await db
      .selectFrom("chat_run_checkpoints")
      .selectAll()
      .where("run_id", "=", runId)
      .executeTakeFirst()) ?? null
  );
};

const listCheckpoints = async (
  db: Kysely<Database>,
  runIds: string[],
): Promise<ChatRunCheckpoint[]> => {
  const rows: ChatRunCheckpoint[] = [];
  for (const batch of chunkIds(runIds)) {
    rows.push(
      ...(await db
        .selectFrom("chat_run_checkpoints")
        .selectAll()
        .where("run_id", "in", batch)
        .orderBy("run_id")
        .execute()),
    );
  }
  return rows.sort((left, right) => left.run_id.localeCompare(right.run_id));
};

const listChangedFiles = async (
  db: Kysely<Database>,
  runIds: string[],
): Promise<ChatRunChangedFile[]> => {
  const rows: ChatRunChangedFile[] = [];
  for (const batch of chunkIds(runIds)) {
    rows.push(
      ...(await db
        .selectFrom("chat_run_changed_files")
        .selectAll()
        .where("run_id", "in", batch)
        .orderBy("run_id")
        .orderBy("path")
        .execute()),
    );
  }
  return rows.sort(
    (left, right) => left.run_id.localeCompare(right.run_id) || left.path.localeCompare(right.path),
  );
};
