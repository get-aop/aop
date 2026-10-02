import type { LibrarySource } from "@aop/common";
import type { Generated, Insertable, Selectable } from "kysely";

/** Added by migration v22; see library-v22.ts for what each column means. */
export interface LibraryItemsTable {
  id: string;
  project_id: string;
  source: LibrarySource;
  name: string;
  folder: Generated<string>;
  description: Generated<string>;
  mime_type: string;
  size: number;
  sha256: string;
  /** SQLite has no boolean: 0 or 1. */
  pinned: Generated<0 | 1>;
  session_id: string | null;
  message_id: string | null;
  attachment_file: string | null;
  created_at: string;
  added_at: string;
  updated_at: string;
  last_accessed_at: string;
  removed_at: Generated<string | null>;
  removed_reason: Generated<LibraryRemovedReason | null>;
}

export type LibraryRemovedReason = "expired" | "deleted";

export interface LibrarySettingsTable {
  project_id: string;
  retention_days: number | null;
  cap_mb: number | null;
}

export interface LibraryDatabase {
  library_items: LibraryItemsTable;
  library_settings: LibrarySettingsTable;
}

export type LibraryItemRow = Selectable<LibraryItemsTable>;
export type NewLibraryItemRow = Insertable<LibraryItemsTable>;
