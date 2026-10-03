import { INBOX_DEFAULTS, parseLibraryRetentionDays } from "@aop/common";
import type { Kysely } from "kysely";
import type { LocalServerContext } from "../context.ts";
import { SettingKey } from "../settings/types.ts";
import type { InboxDatabase } from "./database.ts";
import { createInboxService, type InboxService } from "./service.ts";

/** The host's Inbox: its own database, the retention the person set in AOP settings. */
export const createHostInboxService = (
  ctx: LocalServerContext,
  db: Kysely<InboxDatabase>,
): InboxService =>
  createInboxService({
    db,
    retentionDays: async () =>
      parseLibraryRetentionDays(
        await ctx.settingsRepository.get(SettingKey.INBOX_RETENTION_DAYS),
      ) ?? INBOX_DEFAULTS.retentionDays,
  });
