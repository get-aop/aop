import {
  type EventLogEntry,
  EventLogEntrySchema,
  type Message,
  MessageSchema,
  type Project,
  ProjectSchema,
  type Thread,
  ThreadSchema,
} from "@aop/common";

type Overrides = Record<string, unknown>;

export const NOW = Date.parse("2026-09-30T12:00:00.000Z");
export const JUST_NOW = "2026-09-30T11:59:50.000Z";
export const LONG_AGO = "2026-09-30T09:00:00.000Z";

export const makeProject = (overrides: Overrides = {}): Project =>
  ProjectSchema.parse({
    id: "prj_1",
    name: "checkout-service",
    goal: "",
    instructions: "",
    coordinator: { provider: "claude-code", model: null, effort: "low" },
    thread: { provider: "claude-code", model: null, effort: "high" },
    notificationLevel: "coordinator",
    threadAccess: "auto-accept-edits",
    repoIds: [],
    status: "active",
    createdAt: LONG_AGO,
    updatedAt: LONG_AGO,
    ...overrides,
  });

export const makeThread = (overrides: Overrides = {}): Thread =>
  ThreadSchema.parse({
    id: "thr_1",
    projectId: "prj_1",
    title: "Fix the cold start",
    status: "working",
    runtime: { provider: "claude-code", model: "claude-opus-5", effort: "high" },
    target: { kind: "host" },
    repoId: null,
    branch: null,
    steps: [],
    liveStatusLine: null,
    artifacts: [],
    repliesCount: 0,
    unread: false,
    lastActivityAt: JUST_NOW,
    createdAt: LONG_AGO,
    ...overrides,
  });

export const waitingThread = (
  question = "Upgrade the Lambda, or pin the version?",
  overrides = {},
) =>
  makeThread({
    status: "waiting-on-you",
    blockedQuestion: { question, options: [] },
    ...overrides,
  });

export const pullRequest = (state: "open" | "merged" | "closed", number = 4821) => ({
  type: "pr",
  number,
  url: `https://github.com/acme/checkout-service/pull/${number}`,
  state,
});

export const makeMessage = (overrides: Overrides): Message =>
  MessageSchema.parse({
    id: "msg_1",
    projectId: "prj_1",
    threadId: null,
    createdAt: JUST_NOW,
    ...overrides,
  });

export const coordinatorPost = (text = "Started two threads.", overrides: Overrides = {}) =>
  makeMessage({ role: "assistant", blocks: [{ type: "text", text }], ...overrides });

export const threadReport = (outcome: "finished" | "needs-you" | "failed", text = "It ended.") =>
  makeMessage({ role: "thread-report", reportedThreadId: "thr_1", outcome, text });

let nextEntryId = 1;

export const entryFor = (
  payload:
    | { thread: Thread }
    | { message: Message }
    | { project: Project }
    | { threadId: string }
    | Record<string, never>,
  id = nextEntryId++,
): EventLogEntry => {
  const projectId = "prj_1";
  if ("thread" in payload) {
    return EventLogEntrySchema.parse({ id, projectId, type: "thread.upserted", payload });
  }
  if ("message" in payload) {
    return EventLogEntrySchema.parse({ id, projectId, type: "message.created", payload });
  }
  if ("project" in payload) {
    return EventLogEntrySchema.parse({ id, projectId, type: "project.upserted", payload });
  }
  if ("threadId" in payload) {
    return EventLogEntrySchema.parse({ id, projectId, type: "thread.removed", payload });
  }
  return EventLogEntrySchema.parse({ id, projectId, type: "project.removed", payload });
};
