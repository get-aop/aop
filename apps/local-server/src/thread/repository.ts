import {
  type BlockedQuestion,
  BUILT_IN_RUNTIME_ID,
  type PullRequestChecks,
  type PullRequestRef,
  type Thread,
  type ThreadAccess,
  type ThreadDegraded,
  ThreadSchema,
  type ThreadStatus,
  type ThreadStep,
  type ThreadTarget,
  type ThreadWait,
} from "@aop/common";
import { type Kysely, sql } from "kysely";
import { READ_ONLY_ACCESS } from "../chat-session/run-profile.ts";
import type { ChatSession, ChatSessionUpdate, Database } from "../db/schema.ts";

/**
 * A status change together with the one field only that status carries. Any other status
 * clears all three, so a thread cannot keep a question after the user answered, a resolution
 * time after it reopened or a resume time after it resumed (the database refuses those rows too).
 */
export type ThreadStatusChange =
  | { status: "waiting-on-you"; blockedQuestion: BlockedQuestion }
  | { status: "resolved"; resolvedAt: string }
  | { status: "rate-limited"; resumesAt: string }
  | { status: Exclude<ThreadStatus, "waiting-on-you" | "resolved" | "rate-limited"> };

/** The thread state that changes after creation. Absent keys stay as they are. */
export interface ThreadPatch {
  status?: ThreadStatusChange;
  steps?: ThreadStep[];
  liveStatusLine?: string | null;
  branch?: string | null;
  /** `null` clears the pull request. Its checks are left as they are; `checks` sets those. */
  pullRequest?: PullRequestRef | null;
  /** What the checks of the recorded pull request add up to; `null` clears it. */
  checks?: PullRequestChecks | null;
  target?: ThreadTarget;
  unread?: boolean;
  lastActivityAt?: string;
  /**
   * What a working thread waits on the person for, and whether its AOP tools are lost; `null`
   * clears it. Both belong to the running turn: any status but `working` clears them too.
   */
  waitingOn?: ThreadWait | null;
  degraded?: ThreadDegraded | null;
}

/**
 * Reads and writes the thread columns of chat_sessions. It does not create sessions: a
 * thread is inserted like any session, with its `project_id`, `kind` and `state` set.
 * Only rows with kind `thread` are threads; a coordinator is never returned here.
 *
 * Artifacts hold the pull request only. Files a thread produced join them when the
 * Library has a source for them. `repliesCount` counts the assistant messages of the
 * thread's session.
 */
export interface ThreadRepository {
  getById: (id: string) => Promise<Thread | null>;
  /** Most recent activity first. */
  listByProject: (projectId: string) => Promise<Thread[]>;
  update: (id: string, patch: ThreadPatch) => Promise<Thread | null>;
  /** Applies a project's thread access to every one of its threads, for their next turns. */
  setAccessForProject: (projectId: string, access: ThreadAccess) => Promise<void>;
}

type ThreadRow = ChatSession & { replies_count: number };

export const createThreadRepository = (
  db: Kysely<Database>,
  now: () => Date = () => new Date(),
): ThreadRepository => ({
  getById: async (id) => {
    const row = await selectThreads(db).where("chat_sessions.id", "=", id).executeTakeFirst();
    return row ? toThread(row) : null;
  },

  listByProject: async (projectId) => {
    const rows = await selectThreads(db)
      .where("chat_sessions.project_id", "=", projectId)
      .orderBy("chat_sessions.last_activity_at", "desc")
      .orderBy("chat_sessions.id")
      .execute();
    return rows.map(toThread);
  },

  update: async (id, patch) => {
    // A no-op on a missing or non-thread row: the read below then finds nothing.
    await db
      .updateTable("chat_sessions")
      .set({ ...toColumns(patch), updated_at: now().toISOString() })
      .where("id", "=", id)
      .where("kind", "=", "thread")
      .execute();
    const row = await selectThreads(db).where("chat_sessions.id", "=", id).executeTakeFirst();
    return row ? toThread(row) : null;
  },

  setAccessForProject: async (projectId, access) => {
    await db
      .updateTable("chat_sessions")
      .set({ runtime_access_mode: access })
      .where("project_id", "=", projectId)
      .where("kind", "=", "thread")
      // A thread started read-only stays read-only: the project's access is what it could do.
      .where("runtime_access_mode", "!=", READ_ONLY_ACCESS)
      .execute();
  },
});

const selectThreads = (db: Kysely<Database>) =>
  db
    .selectFrom("chat_sessions")
    .selectAll()
    .select(
      sql<number>`(
        SELECT COUNT(*)
        FROM chat_messages AS reply
        WHERE reply.session_id = chat_sessions.id AND reply.role = 'assistant'
      )`.as("replies_count"),
    )
    .where("chat_sessions.kind", "=", "thread");

// The status goes last: a change away from `working` clears what the turn told the person, even
// when the same patch sets it.
const toColumns = (patch: ThreadPatch): ChatSessionUpdate => ({
  ...(patch.pullRequest !== undefined && pullRequestColumns(patch.pullRequest)),
  ...(patch.checks !== undefined && {
    pr_checks_json: patch.checks === null ? null : JSON.stringify(patch.checks),
  }),
  ...plainColumns(patch),
  ...(patch.status && statusColumns(patch.status)),
});

const jsonOrNull = (value: object | null): string | null =>
  value === null ? null : JSON.stringify(value);

const statusColumns = (change: ThreadStatusChange): ChatSessionUpdate => ({
  state: change.status,
  blocked_question_json:
    change.status === "waiting-on-you" ? JSON.stringify(change.blockedQuestion) : null,
  resolved_at: change.status === "resolved" ? change.resolvedAt : null,
  resumes_at: change.status === "rate-limited" ? change.resumesAt : null,
  // A thread that goes on working keeps what its turn told the person; any other status ends the turn.
  ...(change.status !== "working" && { waiting_on_json: null, tools_degraded_json: null }),
});

// The checks belong to the pull request the watcher read them from, so they go with it and are
// otherwise not touched: a merge that read its pull request a moment ago must not put back a
// summary the watcher has replaced since.
const pullRequestColumns = (pullRequest: PullRequestRef | null): ChatSessionUpdate => ({
  pr_number: pullRequest?.number ?? null,
  pr_url: pullRequest?.url ?? null,
  pr_state: pullRequest?.state ?? null,
  ...(pullRequest === null && { pr_checks_json: null }),
});

const plainColumns = (patch: ThreadPatch): ChatSessionUpdate => {
  const columns: ChatSessionUpdate = {};
  if (patch.steps) columns.steps_json = JSON.stringify(patch.steps);
  if (patch.liveStatusLine !== undefined) columns.status_line = patch.liveStatusLine;
  if (patch.branch !== undefined) columns.branch = patch.branch;
  if (patch.target) columns.target_json = JSON.stringify(patch.target);
  if (patch.unread !== undefined) columns.unread = patch.unread ? 1 : 0;
  if (patch.lastActivityAt) columns.last_activity_at = patch.lastActivityAt;
  if (patch.waitingOn !== undefined) columns.waiting_on_json = jsonOrNull(patch.waitingOn);
  if (patch.degraded !== undefined) columns.tools_degraded_json = jsonOrNull(patch.degraded);
  return columns;
};

/** The stored JSON is checked against the wire schema on every read, so a corrupt row fails loudly. */
const toThread = (row: ThreadRow): Thread =>
  ThreadSchema.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    runtime: {
      provider: row.runtime,
      // A thread started before runtimes were bound to sessions ran on the built-in one.
      runtimeId: row.runtime_configuration_id ?? BUILT_IN_RUNTIME_ID,
      model: row.model,
      effort: row.reasoning_effort,
    },
    target: JSON.parse(row.target_json),
    repoId: row.repo_id,
    branch: row.branch,
    steps: JSON.parse(row.steps_json),
    liveStatusLine: row.status_line,
    artifacts:
      row.pr_number === null
        ? []
        : [
            {
              type: "pr",
              number: row.pr_number,
              url: row.pr_url,
              state: row.pr_state,
              ...(row.pr_checks_json !== null && { checks: JSON.parse(row.pr_checks_json) }),
            },
          ],
    repliesCount: Number(row.replies_count),
    unread: row.unread === 1,
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at,
    status: row.state,
    // Keys only the waiting and resolved variants carry are left out, not set to undefined.
    ...(row.blocked_question_json === null
      ? {}
      : { blockedQuestion: JSON.parse(row.blocked_question_json) }),
    ...(row.resolved_at === null ? {} : { resolvedAt: row.resolved_at }),
    ...(row.resumes_at === null ? {} : { resumesAt: row.resumes_at }),
    ...(row.waiting_on_json === null ? {} : { waitingOn: JSON.parse(row.waiting_on_json) }),
    ...(row.tools_degraded_json === null ? {} : { degraded: JSON.parse(row.tools_degraded_json) }),
  });
