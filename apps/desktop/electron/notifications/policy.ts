import type { EventLogEntry, Message, Project, Thread } from "@aop/common";

export type NotificationKind =
  | "coordinator"
  | "needs-you"
  | "thread-error"
  | "pr-merged"
  | "pr-closed"
  | "turn-finished";

/** Where a click on the notification lands: a thread, or the coordinator chat when `threadId` is null. */
export interface NotificationTarget {
  projectId: string;
  threadId: string | null;
}

export interface NotificationIntent {
  kind: NotificationKind;
  title: string;
  body: string;
  target: NotificationTarget;
}

export interface PolicyContext {
  project: Pick<Project, "name" | "status" | "notificationLevel">;
  /** The thread as this client knew it before the entry, or undefined for a thread it has not seen. */
  previousThread: Thread | undefined;
  threadTitle: (threadId: string) => string | undefined;
  now: number;
  /** The person is looking at the app, so a notification would only repeat what is on screen. */
  appFocused: boolean;
}

/**
 * Entries older than this are history, not news: a laptop that slept for an hour replays what
 * it missed, and a burst of stale notifications would bury the one that matters. What it missed
 * is on the Overview when the person opens the app.
 */
export const STALE_AFTER_MS = 2 * 60 * 1000;

const BODY_LIMIT = 180;

/**
 * Decides whether one event-log entry deserves an OS notification, and what it says. The
 * project's notification level is the person's setting: `coordinator` is a coordinator post,
 * a thread that needs them or failed, and a pull request that landed or was closed; `every-turn`
 * adds each finished thread turn; `off` is silence. Only active projects notify: a paused
 * project has stopped everything, and an archived one is hidden.
 */
export const decideNotification = (
  entry: EventLogEntry,
  context: PolicyContext,
): NotificationIntent | null => {
  const { project } = context;
  if (project.notificationLevel === "off" || project.status !== "active") return null;
  if (context.appFocused) return null;

  switch (entry.type) {
    case "thread.upserted":
      return isFresh(entry.payload.thread.lastActivityAt, context.now)
        ? decideForThread(entry.payload.thread, entry.projectId, context)
        : null;
    case "message.created":
      return isFresh(entry.payload.message.createdAt, context.now)
        ? decideForMessage(entry.payload.message, entry.projectId, context)
        : null;
    default:
      return null;
  }
};

/** The address, inside the dashboard, a notification opens. Built from ids the host made, encoded. */
export const notificationPath = ({ projectId, threadId }: NotificationTarget): string => {
  const project = `/projects/${encodeURIComponent(projectId)}`;
  return threadId === null
    ? `${project}/chat`
    : `${project}/threads/${encodeURIComponent(threadId)}`;
};

const decideForThread = (
  thread: Thread,
  projectId: string,
  context: PolicyContext,
): NotificationIntent | null => {
  const target = { projectId, threadId: thread.id };
  const previous = context.previousThread;

  if (
    thread.status === "waiting-on-you" &&
    !alreadyAsked(previous, thread.blockedQuestion.question)
  ) {
    return intent(
      "needs-you",
      context,
      `${thread.title} · ${thread.blockedQuestion.question}`,
      target,
    );
  }

  const attention = decideForWorkingThread(thread, context);
  if (attention) return attention;

  const before = previous ? pullRequestOf(previous) : undefined;
  const after = pullRequestOf(thread);
  // A pull request first seen already merged is not news; only a change from open is.
  if (before?.state === "open" && after?.state === "merged") {
    return intent("pr-merged", context, `PR #${after.number} merged · ${thread.title}`, target);
  }
  if (before?.state === "open" && after?.state === "closed") {
    return intent(
      "pr-closed",
      context,
      `PR #${after.number} was closed without merging · ${thread.title}`,
      target,
    );
  }
  return null;
};

const decideForMessage = (
  message: Message,
  projectId: string,
  context: PolicyContext,
): NotificationIntent | null => {
  if (message.role === "assistant" && message.threadId === null) {
    return intent("coordinator", context, firstText(message), { projectId, threadId: null });
  }
  if (message.role !== "thread-report") return null;

  const title = context.threadTitle(message.reportedThreadId) ?? "A thread";
  const target = { projectId, threadId: message.reportedThreadId };
  if (message.outcome === "failed") {
    return intent("thread-error", context, `${title} failed: ${message.text}`, target);
  }
  // `needs-you` is announced by the thread's own change of status, so it is not announced twice.
  if (message.outcome === "finished" && context.project.notificationLevel === "every-turn") {
    return intent("turn-finished", context, `${title} finished a turn`, target);
  }
  return null;
};

/**
 * A working thread that starts waiting on the person for something outside AOP, or whose AOP tools
 * stop reaching the host. Each is announced once, when it begins; the coordinator's report about it
 * is not announced again.
 */
const decideForWorkingThread = (
  thread: Thread,
  context: PolicyContext,
): NotificationIntent | null => {
  if (thread.status !== "working") return null;
  const previous = context.previousThread?.status === "working" ? context.previousThread : null;
  const target = { projectId: thread.projectId, threadId: thread.id };
  if (thread.degraded && !previous?.degraded) {
    return intent("thread-error", context, `${thread.title} lost its AOP tools`, target);
  }
  if (thread.waitingOn && thread.waitingOn.reason !== previous?.waitingOn?.reason) {
    return intent("needs-you", context, `${thread.title} · ${thread.waitingOn.reason}`, target);
  }
  return null;
};

const alreadyAsked = (previous: Thread | undefined, question: string): boolean =>
  previous?.status === "waiting-on-you" && previous.blockedQuestion.question === question;

const pullRequestOf = (thread: Thread) =>
  thread.artifacts.find((artifact) => artifact.type === "pr");

const firstText = (message: Extract<Message, { role: "assistant" }>): string => {
  const text = message.blocks.find((block) => block.type === "text");
  return text?.type === "text" ? text.text : "The coordinator posted an update.";
};

const intent = (
  kind: NotificationKind,
  context: PolicyContext,
  body: string,
  target: NotificationTarget,
): NotificationIntent => ({ kind, title: context.project.name, body: clip(body), target });

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= BODY_LIMIT ? line : `${line.slice(0, BODY_LIMIT - 1)}…`;
};

const isFresh = (timestamp: string, now: number): boolean => {
  const at = Date.parse(timestamp);
  return Number.isNaN(at) || now - at <= STALE_AFTER_MS;
};
