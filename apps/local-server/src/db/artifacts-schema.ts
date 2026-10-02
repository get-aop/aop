import type { ArtifactKind } from "@aop/common";
import type { Insertable, Selectable } from "kysely";

/** Added by migration v23; see artifacts-v23.ts for what each column means. */
export interface LibraryArtifactsTable {
  item_id: string;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  current_version: number;
  origin_message_id: string | null;
  /** The diagram type a Visualize artifact was last drawn as. */
  origin_type: string | null;
}

export interface LibraryArtifactVersionsTable {
  item_id: string;
  version: number;
  sha256: string;
  size: number;
  mime_type: string;
  kind: ArtifactKind;
  note: string | null;
  session_id: string | null;
  message_id: string | null;
  created_at: string;
}

export interface ArtifactsDatabase {
  library_artifacts: LibraryArtifactsTable;
  library_artifact_versions: LibraryArtifactVersionsTable;
}

export type LibraryArtifactRow = Selectable<LibraryArtifactsTable>;
export type LibraryArtifactVersionRow = Selectable<LibraryArtifactVersionsTable>;
export type NewLibraryArtifactVersionRow = Insertable<LibraryArtifactVersionsTable>;
