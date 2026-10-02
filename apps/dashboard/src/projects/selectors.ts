import type { Artifact, PullRequestRef, Thread, ThreadStatus } from "@aop/common";
import { plainStatusLine } from "./plain-status-line";
import type { ProjectEntry, ProjectsState } from "./projects-state";

export interface Attention {
  /** Threads blocked on a question only the person can answer. */
  waiting: number;
  /** Threads with an agent turn running. */
  working: number;
  /** Threads with something the person has not looked at. */
  unread: number;
}

export const attentionOf = (threads: readonly Thread[]): Attention => ({
  waiting: threads.filter((thread) => thread.status === "waiting-on-you").length,
  working: threads.filter((thread) => thread.status === "working").length,
  unread: threads.filter((thread) => thread.unread).length,
});

export type AttentionKind = "waiting" | "working" | "none";

/** What a project row shows: the most urgent thing first, so a question outranks running work. */
export const attentionKind = ({ waiting, working }: Attention): AttentionKind =>
  waiting > 0 ? "waiting" : working > 0 ? "working" : "none";

/** "2 threads are waiting on you" or, when nothing is, the plain reassurance. */
export const attentionSentence = (waiting: number): string => {
  if (waiting === 0) return "Nothing is waiting on you.";
  return waiting === 1 ? "1 thread is waiting on you." : `${waiting} threads are waiting on you.`;
};

// The order a person should look at threads in: questions first, closed work last.
const STATUS_RANK: Record<ThreadStatus, number> = {
  "waiting-on-you": 0,
  working: 1,
  queued: 2,
  "rate-limited": 3,
  "ready-for-review": 4,
  landing: 5,
  idle: 6,
  resolved: 7,
};

export const sortThreads = (threads: readonly Thread[]): Thread[] =>
  [...threads].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
  );

/** Every status in the order a person should look at them; the Overview shows one group per status. */
export const THREAD_STATUS_ORDER: readonly ThreadStatus[] = Object.entries(STATUS_RANK)
  .sort(([, a], [, b]) => a - b)
  .map(([status]) => status as ThreadStatus);

export interface ThreadGroup {
  status: ThreadStatus;
  threads: Thread[];
}

/**
 * The groups that stay on the Overview at zero, each with the line that says what goes in it:
 * they are where the person looks for a decision to make or for work that is finished.
 */
export const ALWAYS_LISTED: Readonly<Partial<Record<ThreadStatus, string>>> = {
  "waiting-on-you": "Decisions, reviews, and permission requests.",
  resolved: "Completed threads.",
};

/**
 * The line an empty group shows. While the host's agents skip permission checks, no thread can
 * be waiting on a permission, so Waiting on you does not offer one.
 */
export const emptyGroupLine = (
  status: ThreadStatus,
  skipsPermissions: boolean,
): string | undefined =>
  status === "waiting-on-you" && skipsPermissions
    ? "Decisions and reviews."
    : ALWAYS_LISTED[status];

/**
 * The Overview's groups: one per status, questions first and closed work last, each newest
 * activity first, except the queue, which lists threads in the order the host starts them
 * (oldest first). A status with no thread has no group, unless it is one of `alwaysListed`.
 */
export const groupThreads = (
  threads: readonly Thread[],
  alwaysListed: readonly ThreadStatus[] = [],
): ThreadGroup[] => {
  const sorted = sortThreads(threads);
  return THREAD_STATUS_ORDER.flatMap((status) => {
    const inStatus = sorted.filter((thread) => thread.status === status);
    if (inStatus.length === 0 && !alwaysListed.includes(status)) return [];
    return [{ status, threads: status === "queued" ? inStatus.toReversed() : inStatus }];
  });
};

export const THREAD_STATUS_LABEL: Record<ThreadStatus, string> = {
  "waiting-on-you": "Waiting on you",
  working: "Working",
  queued: "Queued",
  "rate-limited": "Rate limited",
  "ready-for-review": "Ready for review",
  landing: "Landing",
  idle: "Idle",
  resolved: "Resolved",
};

/** The pull request a thread opened, if it has: a thread has at most one. */
export const pullRequestOf = (thread: Thread): PullRequestRef | null =>
  thread.artifacts.find(
    (artifact): artifact is Artifact & { type: "pr" } => artifact.type === "pr",
  ) ?? null;

/**
 * A thread that has stopped, with an open pull request whose checks fail: nothing is ready for
 * anyone until they are fixed, which the person has to do or ask for once auto-fix has stopped at
 * its cap. A working thread may be fixing them, and a resolved one is closed out.
 */
export const hasFailingChecks = (thread: Thread): boolean => {
  if (thread.status !== "ready-for-review" && thread.status !== "idle") return false;
  const pullRequest = pullRequestOf(thread);
  return pullRequest?.state === "open" && pullRequest.checks?.state === "failure";
};

export const matchesThreadSearch = (thread: Thread, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    thread.title,
    plainStatusLine(thread.liveStatusLine ?? ""),
    thread.blockedQuestion?.question ?? "",
    thread.branch ?? "",
    THREAD_STATUS_LABEL[thread.status],
  ];
  return haystack.some((text) => text.toLowerCase().includes(needle));
};

export interface ProjectGroups {
  pinned: ProjectEntry[];
  active: ProjectEntry[];
  archived: ProjectEntry[];
}

/**
 * The sidebar's groups. Pinned projects (a per-device choice) lead; each group is newest
 * first by last change, which the host bumps on every project update.
 */
export const groupProjects = (
  entries: readonly ProjectEntry[],
  pinnedIds: readonly string[],
): ProjectGroups => {
  const pinnedSet = new Set(pinnedIds);
  const byRecency = (a: ProjectEntry, b: ProjectEntry) =>
    Date.parse(b.project.updatedAt) - Date.parse(a.project.updatedAt);
  const live = entries.filter(({ project }) => project.status !== "archived");
  return {
    pinned: live.filter(({ project }) => pinnedSet.has(project.id)).sort(byRecency),
    active: live.filter(({ project }) => !pinnedSet.has(project.id)).sort(byRecency),
    archived: entries.filter(({ project }) => project.status === "archived").sort(byRecency),
  };
};

export const matchesProjectSearch = (entry: ProjectEntry, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.project.name, entry.project.goal].some((text) =>
    text.toLowerCase().includes(needle),
  );
};

/** "now", "5m", "3h", "2d", then a date: the terse age the Overview rows use. */
export const formatAge = (iso: string, now: number = Date.now()): string => {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** "just now", "5m ago", "3h ago", "2d ago", then a date: formatAge's ages in words. Empty for a time it cannot read. */
export const formatAgo = (iso: string, now: number = Date.now()): string => {
  if (Number.isNaN(Date.parse(iso))) return "";
  const age = formatAge(iso, now);
  if (age === "now") return "just now";
  return /^\d+[mhd]$/.test(age) ? `${age} ago` : age;
};

export type HostConnection = "connected" | "reconnecting" | "offline";

/**
 * How the page is doing with the host, from what it can observe: no fetch has been
 * answered lately (offline), or a stream is trying to come back (reconnecting).
 */
export const hostConnection = (state: ProjectsState): HostConnection => {
  if (!state.reachable) return "offline";
  const entries = Object.values(state.byId);
  return entries.some(({ connection }) => connection === "reconnecting")
    ? "reconnecting"
    : "connected";
};
