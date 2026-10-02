import {
  LIBRARY_DEFAULTS,
  type LibraryItem,
  type LibraryRetention,
  type LibrarySettings,
  parseLibraryCapMb,
  parseLibraryRetentionDays,
} from "@aop/common";
import type { LibraryItemRow } from "../db/library-schema.ts";
import type { SettingsRepository } from "../settings/repository.ts";
import { SettingKey } from "../settings/types.ts";
import type { LibraryItemWithSession } from "./repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The host's defaults, as the settings hold them; a value that does not parse is the built-in one. */
export const hostLibraryDefaults = async (
  settings: SettingsRepository,
): Promise<LibraryRetention & { hostCapMb: number }> => ({
  retentionDays:
    parseLibraryRetentionDays(await settings.get(SettingKey.LIBRARY_RETENTION_DAYS)) ??
    LIBRARY_DEFAULTS.retentionDays,
  capMb:
    parseLibraryCapMb(await settings.get(SettingKey.LIBRARY_PROJECT_CAP_MB)) ??
    LIBRARY_DEFAULTS.projectCapMb,
  hostCapMb:
    parseLibraryCapMb(await settings.get(SettingKey.LIBRARY_HOST_CAP_MB)) ??
    LIBRARY_DEFAULTS.hostCapMb,
});

/** What applies to a project: each of its own settings over the host's default. */
export const effectiveRetention = (
  settings: LibrarySettings,
  defaults: LibraryRetention,
): LibraryRetention => ({
  retentionDays: settings.retentionDays ?? defaults.retentionDays,
  capMb: settings.capMb ?? defaults.capMb,
});

export const megabytes = (mb: number): number | null => (mb > 0 ? mb * 1024 * 1024 : null);

/** Only what arrived on its own goes by age; what the person added or pinned stays. */
export const isAutomatic = (row: Pick<LibraryItemRow, "source" | "pinned">): boolean =>
  row.pinned === 0 && row.source !== "upload";

export const expiresAtOf = (
  row: Pick<LibraryItemRow, "source" | "pinned" | "added_at">,
  retentionDays: number,
): string | null =>
  isAutomatic(row) && retentionDays > 0
    ? new Date(Date.parse(row.added_at) + retentionDays * DAY_MS).toISOString()
    : null;

/** The moment before which an automatic item has outlived `retentionDays`. */
export const retentionCutoff = (now: Date, retentionDays: number): string =>
  new Date(now.getTime() - retentionDays * DAY_MS).toISOString();

export const toLibraryItem = (row: LibraryItemWithSession, retentionDays: number): LibraryItem => ({
  id: row.id,
  name: row.name,
  folder: row.folder,
  description: row.description,
  source: row.source,
  mimeType: row.mime_type,
  size: row.size,
  pinned: row.pinned === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAccessedAt: row.last_accessed_at,
  expiresAt: expiresAtOf(row, retentionDays),
  usedIn: row.session_id
    ? {
        threadId: row.session_kind === "thread" ? row.session_id : null,
        messageId: row.message_id,
      }
    : null,
});
