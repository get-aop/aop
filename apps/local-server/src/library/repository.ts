import { type Kysely, sql } from "kysely";
import type {
  LibraryItemRow,
  LibraryRemovedReason,
  NewLibraryItemRow,
} from "../db/library-schema.ts";
import type { Database } from "../db/schema.ts";

/** A live item with what its "used in" link needs: the kind of the session it came from. */
export type LibraryItemWithSession = LibraryItemRow & { session_kind: string | null };

export interface LibraryItemUpdate {
  name?: string;
  folder?: string;
  description?: string;
  pinned?: 0 | 1;
  updated_at?: string;
  last_accessed_at?: string;
  /** A new version of an artifact: the item serves its content from now on. */
  sha256?: string;
  size?: number;
  mime_type?: string;
  /** Restarts the retention clock. */
  added_at?: string;
}

export interface LibraryRepository {
  insert: (row: NewLibraryItemRow) => Promise<void>;
  /** Inserts a chat attachment once; indexing the same file again does nothing. */
  insertChatOnce: (row: NewLibraryItemRow) => Promise<boolean>;
  /** A live item of the project. */
  getLive: (projectId: string, id: string) => Promise<LibraryItemWithSession | null>;
  /** The project's live items, newest first; a chat item whose session is gone is left out. */
  listLive: (projectId: string) => Promise<LibraryItemWithSession[]>;
  /** A live item with this content, name and folder: saving it again returns it. */
  findTwin: (
    projectId: string,
    twin: { sha256: string; name: string; folder: string },
  ) => Promise<LibraryItemRow | null>;
  update: (id: string, patch: LibraryItemUpdate) => Promise<void>;
  delete: (id: string) => Promise<void>;
  /** Keeps a chat item as a marker after its file went, so its message can say why. */
  markRemoved: (id: string, reason: LibraryRemovedReason, at: string) => Promise<void>;
  /** Live non-chat items still pointing at a blob, and versions of live artifacts that keep it. */
  blobUsers: (projectId: string, sha256: string) => Promise<number>;
  /** The removed marker of a chat attachment, if retention or the person removed it. */
  chatRemoval: (
    sessionId: string,
    attachmentFile: string,
  ) => Promise<{ reason: LibraryRemovedReason; at: string } | null>;
  /** Bytes on disk: each blob once, each chat attachment once. Null project is the whole host. */
  usedBytes: (projectId: string | null) => Promise<number>;
  /** Unpinned automatic items, least recently used first. Null project is the whole host. */
  evictionCandidates: (projectId: string | null) => Promise<LibraryItemRow[]>;
  /** Unpinned automatic items that entered the Library before `cutoff`. */
  addedBefore: (projectId: string, cutoff: string) => Promise<LibraryItemRow[]>;
  /** Chat items of sessions that no longer exist. */
  orphanedChatItems: (projectId: string) => Promise<LibraryItemRow[]>;
  /** The projects that hold any item, live or removed. */
  projectIds: () => Promise<string[]>;
  getSettings: (
    projectId: string,
  ) => Promise<{ retentionDays: number | null; capMb: number | null }>;
  setSettings: (
    projectId: string,
    settings: { retentionDays: number | null; capMb: number | null },
  ) => Promise<void>;
}

const AUTOMATIC_SOURCES = ["artifact", "chat"] as const;

export const createLibraryRepository = (db: Kysely<Database>): LibraryRepository => ({
  insert: async (row) => {
    await db.insertInto("library_items").values(row).execute();
  },

  insertChatOnce: async (row) => {
    const result = await db
      .insertInto("library_items")
      .values(row)
      .onConflict((oc) =>
        oc
          .columns(["session_id", "attachment_file"])
          .where("attachment_file", "is not", null)
          .doNothing(),
      )
      .executeTakeFirst();
    return Number(result.numInsertedOrUpdatedRows ?? 0) > 0;
  },

  getLive: async (projectId, id) =>
    (await liveItems(db, projectId).where("library_items.id", "=", id).executeTakeFirst()) ?? null,

  listLive: (projectId) =>
    liveItems(db, projectId)
      .orderBy("library_items.created_at", "desc")
      .orderBy("library_items.id", "desc")
      .execute(),

  findTwin: async (projectId, twin) =>
    (await db
      .selectFrom("library_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("removed_at", "is", null)
      .where("source", "!=", "chat")
      .where("sha256", "=", twin.sha256)
      .where("name", "=", twin.name)
      .where("folder", "=", twin.folder)
      .executeTakeFirst()) ?? null,

  update: async (id, patch) => {
    await db.updateTable("library_items").set(patch).where("id", "=", id).execute();
  },

  delete: async (id) => {
    await db.deleteFrom("library_items").where("id", "=", id).execute();
  },

  markRemoved: async (id, reason, at) => {
    await db
      .updateTable("library_items")
      .set({ removed_at: at, removed_reason: reason, updated_at: at })
      .where("id", "=", id)
      .execute();
  },

  blobUsers: async (projectId, sha256) => {
    const row = await db
      .selectFrom("library_items")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("project_id", "=", projectId)
      .where("sha256", "=", sha256)
      .where("source", "!=", "chat")
      .where("removed_at", "is", null)
      .executeTakeFirstOrThrow();
    const versions = await db
      .selectFrom("library_artifact_versions")
      .innerJoin("library_items", "library_items.id", "library_artifact_versions.item_id")
      .select((eb) => eb.fn.countAll<number>().as("count"))
      .where("library_items.project_id", "=", projectId)
      .where("library_items.removed_at", "is", null)
      .where("library_artifact_versions.sha256", "=", sha256)
      .executeTakeFirstOrThrow();
    return Number(row.count) + Number(versions.count);
  },

  chatRemoval: async (sessionId, attachmentFile) => {
    const row = await db
      .selectFrom("library_items")
      .select(["removed_reason", "removed_at"])
      .where("session_id", "=", sessionId)
      .where("attachment_file", "=", attachmentFile)
      .executeTakeFirst();
    return row?.removed_reason && row.removed_at
      ? { reason: row.removed_reason, at: row.removed_at }
      : null;
  },

  usedBytes: async (projectId) => {
    const scope = projectId === null ? sql`1 = 1` : sql`project_id = ${projectId}`;
    const versionScope =
      projectId === null ? sql`1 = 1` : sql`library_items.project_id = ${projectId}`;
    // An artifact's earlier versions are files on disk too, each blob still counted once.
    const { rows } = await sql<{ bytes: number | null }>`
      SELECT SUM(size) AS bytes FROM (
        SELECT MAX(size) AS size FROM (
          SELECT project_id, sha256, size FROM library_items
            WHERE ${scope} AND removed_at IS NULL AND source != 'chat'
          UNION ALL
          SELECT library_items.project_id, library_artifact_versions.sha256,
              library_artifact_versions.size
            FROM library_artifact_versions
            JOIN library_items ON library_items.id = library_artifact_versions.item_id
            WHERE ${versionScope} AND library_items.removed_at IS NULL
        )
          GROUP BY project_id, sha256
        UNION ALL
        SELECT size FROM library_items
          WHERE ${scope} AND removed_at IS NULL AND source = 'chat'
      )
    `.execute(db);
    return Number(rows[0]?.bytes ?? 0);
  },

  evictionCandidates: (projectId) => {
    let query = db
      .selectFrom("library_items")
      .selectAll()
      .where("removed_at", "is", null)
      .where("pinned", "=", 0)
      .where("source", "in", AUTOMATIC_SOURCES);
    if (projectId !== null) query = query.where("project_id", "=", projectId);
    return query.orderBy("last_accessed_at", "asc").orderBy("id", "asc").execute();
  },

  addedBefore: (projectId, cutoff) =>
    db
      .selectFrom("library_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("removed_at", "is", null)
      .where("pinned", "=", 0)
      .where("source", "in", AUTOMATIC_SOURCES)
      .where("added_at", "<", cutoff)
      .orderBy("added_at", "asc")
      .execute(),

  orphanedChatItems: (projectId) =>
    db
      .selectFrom("library_items")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("source", "=", "chat")
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom("chat_sessions")
              .select("chat_sessions.id")
              .whereRef("chat_sessions.id", "=", "library_items.session_id"),
          ),
        ),
      )
      .execute(),

  projectIds: async () =>
    (await db.selectFrom("library_items").select("project_id").distinct().execute()).map(
      (row) => row.project_id,
    ),

  getSettings: async (projectId) => {
    const row = await db
      .selectFrom("library_settings")
      .select(["retention_days", "cap_mb"])
      .where("project_id", "=", projectId)
      .executeTakeFirst();
    return { retentionDays: row?.retention_days ?? null, capMb: row?.cap_mb ?? null };
  },

  setSettings: async (projectId, settings) => {
    const values = { retention_days: settings.retentionDays, cap_mb: settings.capMb };
    await db
      .insertInto("library_settings")
      .values({ project_id: projectId, ...values })
      .onConflict((oc) => oc.column("project_id").doUpdateSet(values))
      .execute();
  },
});

const liveItems = (db: Kysely<Database>, projectId: string) =>
  db
    .selectFrom("library_items")
    .leftJoin("chat_sessions", "chat_sessions.id", "library_items.session_id")
    .selectAll("library_items")
    .select("chat_sessions.kind as session_kind")
    .where("library_items.project_id", "=", projectId)
    .where("library_items.removed_at", "is", null)
    .where((eb) =>
      eb.or([eb("library_items.source", "!=", "chat"), eb("chat_sessions.id", "is not", null)]),
    );
