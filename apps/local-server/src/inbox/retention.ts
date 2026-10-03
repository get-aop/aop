import { startPeriodicJob } from "../process/periodic-job.ts";
import type { InboxService } from "./service.ts";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Removes what outlived the Inbox's retention a minute after start and then every hour: often
 * enough that "30 days" means 30 days, and cheap, since a sweep is three indexed statements.
 */
export const startInboxRetention = (inbox: InboxService): (() => void) =>
  startPeriodicJob({
    name: "Inbox cleanup",
    run: () => inbox.sweep(),
    startupDelayMs: 60 * 1000,
    intervalMs: HOUR_MS,
  });
