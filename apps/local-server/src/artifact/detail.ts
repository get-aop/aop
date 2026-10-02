import {
  type ArtifactDetail,
  type ArtifactVersion,
  artifactKindOf,
  codeLanguageOf,
} from "@aop/common";
import type { LocalServerContext } from "../context.ts";
import type { LibraryArtifactRow, LibraryArtifactVersionRow } from "../db/artifacts-schema.ts";
import { effectiveRetention, expiresAtOf, hostLibraryDefaults } from "../library/item-dto.ts";
import type { LibraryItemWithSession, LibraryRepository } from "../library/repository.ts";

/** The retention that applies to the project's automatic items now. */
export const retentionDaysOf = async (
  ctx: LocalServerContext,
  items: LibraryRepository,
  projectId: string,
): Promise<number> => {
  const { hostCapMb: _hostCap, ...defaults } = await hostLibraryDefaults(ctx.settingsRepository);
  return effectiveRetention(await items.getSettings(projectId), defaults).retentionDays;
};

/**
 * A Library item as the artifact view reads it. An artifact has its own title, kind and
 * versions; any other file is its name, the kind its name and type say, and one version.
 */
export const toArtifactDetail = (
  row: LibraryItemWithSession,
  artifact: LibraryArtifactRow | null,
  versions: readonly LibraryArtifactVersionRow[],
  retentionDays: number,
): ArtifactDetail => {
  const fileKind = artifactKindOf(row.name, row.mime_type);
  const shown: ArtifactVersion[] =
    artifact && versions.length > 0
      ? versions.map((version) => ({
          version: version.version,
          size: version.size,
          mimeType: version.mime_type,
          kind: version.kind,
          note: version.note,
          createdAt: version.created_at,
          messageId: version.message_id,
        }))
      : [
          {
            version: 1,
            size: row.size,
            mimeType: row.mime_type,
            kind: fileKind,
            note: null,
            createdAt: row.created_at,
            messageId: row.message_id,
          },
        ];
  return {
    id: row.id,
    title: artifact?.title ?? row.name,
    kind: artifact?.kind ?? fileKind,
    language: artifact ? artifact.language : fileKind === "code" ? codeLanguageOf(row.name) : null,
    name: row.name,
    folder: row.folder,
    currentVersion: artifact?.current_version ?? 1,
    versions: shown,
    versioned: artifact !== null,
    originMessageId: artifact?.origin_message_id ?? null,
    expiresAt: expiresAtOf(row, retentionDays),
  };
};
