import type { Kysely } from "kysely";
import type {
  LibraryArtifactRow,
  LibraryArtifactVersionRow,
  NewLibraryArtifactVersionRow,
} from "../db/artifacts-schema.ts";
import type { Database } from "../db/schema.ts";

export interface ArtifactRepository {
  get: (itemId: string) => Promise<LibraryArtifactRow | null>;
  /** Oldest first. */
  versions: (itemId: string) => Promise<LibraryArtifactVersionRow[]>;
  /** The diagram Visualize drew from a reply, if it is still in the Library. */
  byOriginMessage: (projectId: string, messageId: string) => Promise<LibraryArtifactRow | null>;
  /** Makes a Library item an artifact, with its first version. */
  insert: (artifact: LibraryArtifactRow, first: NewLibraryArtifactVersionRow) => Promise<void>;
  /** Adds a version and makes it current; title, kind or the diagram type change with it if given. */
  addVersion: (
    version: NewLibraryArtifactVersionRow,
    changes: { title?: string; kind?: LibraryArtifactRow["kind"]; origin_type?: string },
  ) => Promise<void>;
}

export const createArtifactRepository = (db: Kysely<Database>): ArtifactRepository => ({
  get: async (itemId) =>
    (await db
      .selectFrom("library_artifacts")
      .selectAll()
      .where("item_id", "=", itemId)
      .executeTakeFirst()) ?? null,

  versions: (itemId) =>
    db
      .selectFrom("library_artifact_versions")
      .selectAll()
      .where("item_id", "=", itemId)
      .orderBy("version", "asc")
      .execute(),

  byOriginMessage: async (projectId, messageId) =>
    (await db
      .selectFrom("library_artifacts")
      .innerJoin("library_items", "library_items.id", "library_artifacts.item_id")
      .selectAll("library_artifacts")
      .where("library_items.project_id", "=", projectId)
      .where("library_items.removed_at", "is", null)
      .where("library_artifacts.origin_message_id", "=", messageId)
      .executeTakeFirst()) ?? null,

  insert: async (artifact, first) => {
    await db.transaction().execute(async (tx) => {
      await tx.insertInto("library_artifacts").values(artifact).execute();
      await tx.insertInto("library_artifact_versions").values(first).execute();
    });
  },

  addVersion: async (version, changes) => {
    await db.transaction().execute(async (tx) => {
      await tx.insertInto("library_artifact_versions").values(version).execute();
      await tx
        .updateTable("library_artifacts")
        .set({ current_version: version.version, ...changes })
        .where("item_id", "=", version.item_id)
        .execute();
    });
  },
});
