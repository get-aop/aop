import { z } from "zod";

/**
 * What the watcher has already done for one thread's pull request. It is the watcher's memory
 * across restarts: an occurrence that has an entry is never answered again, and the fix entries
 * are the attempts counted against the cap.
 */
export const WatchEntrySchema = z.object({
  id: z.string().min(1),
  /**
   * `fix`: a prompt sent to the thread. `cap`, `merged` and `closed`: the report the coordinator
   * got when the watcher gave up, or the pull request ended.
   */
  kind: z.enum(["fix", "cap", "merged", "closed"]),
  /** Which occurrences a fix answered: check runs, reviews, a conflicting head commit. */
  keys: z.array(z.string()),
  /** One line saying what was sent, for the log and the summary a person reads. */
  summary: z.string(),
  at: z.string(),
  /**
   * A fix is written down before the thread is sent it, and confirmed once it has it, so a crash
   * between the two is found and settled (see `reconcile`). A report is never in between: it is
   * stored in the transaction that writes its entry.
   */
  delivered: z.boolean(),
});
export type WatchEntry = z.infer<typeof WatchEntrySchema>;

export const WatchEntriesSchema = z.array(WatchEntrySchema);

export type ReportKind = Exclude<WatchEntry["kind"], "fix">;

export const attemptsOf = (entries: readonly WatchEntry[]): number =>
  entries.filter((entry) => entry.kind === "fix").length;

/** Every occurrence a fix has answered, or is answering now. */
export const handledKeys = (entries: readonly WatchEntry[]): Set<string> =>
  new Set(entries.filter((entry) => entry.kind === "fix").flatMap((entry) => entry.keys));

export const hasKind = (entries: readonly WatchEntry[], kind: WatchEntry["kind"]): boolean =>
  entries.some((entry) => entry.kind === kind);

export const newFix = (keys: string[], summary: string, at: Date): WatchEntry => ({
  id: crypto.randomUUID(),
  kind: "fix",
  keys,
  summary,
  at: at.toISOString(),
  delivered: false,
});

export const newReport = (kind: ReportKind, summary: string, at: Date): WatchEntry => ({
  id: crypto.randomUUID(),
  kind,
  keys: [],
  summary,
  at: at.toISOString(),
  delivered: true,
});

/** Writes the fix down as an attempt; refused when the cap is reached or an occurrence in it is already answered. */
export const claim = (
  entries: readonly WatchEntry[],
  fix: WatchEntry,
  maxAttempts: number,
): WatchEntry[] | null => {
  if (attemptsOf(entries) >= maxAttempts) return null;
  const handled = handledKeys(entries);
  return fix.keys.some((key) => handled.has(key)) ? null : [...entries, fix];
};

export const confirm = (entries: readonly WatchEntry[], id: string): WatchEntry[] =>
  entries.map((entry) => (entry.id === id ? { ...entry, delivered: true } : entry));

/** The attempt did not happen: the thread was not sent the prompt. */
export const release = (entries: readonly WatchEntry[], id: string): WatchEntry[] =>
  entries.filter((entry) => entry.id !== id);

/**
 * Settles the fixes a crash left between "written down" and "sent": one whose message the thread
 * has is confirmed, one it does not have never happened and is released. `wasSent` says which.
 */
export const reconcile = (
  entries: readonly WatchEntry[],
  wasSent: (id: string) => boolean,
): WatchEntry[] =>
  entries.flatMap((entry) => {
    if (entry.delivered) return [entry];
    return wasSent(entry.id) ? [{ ...entry, delivered: true }] : [];
  });

export const unsettled = (entries: readonly WatchEntry[]): WatchEntry[] =>
  entries.filter((entry) => !entry.delivered);
