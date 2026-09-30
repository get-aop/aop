import type {
  Message,
  PullRequestRef,
  SessionDiffFile,
  SessionGitDiff,
  Thread,
  ThreadActivity,
  ThreadUsage,
} from "@aop/common";
import { request } from "./request";

const threadUrl = (threadId: string, suffix = ""): string =>
  `/threads/${encodeURIComponent(threadId)}${suffix}`;

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** The latest messages of one thread, oldest first: the brief, the agent's replies and the person's answers. */
export const listThreadMessages = async (threadId: string): Promise<Message[]> =>
  (await request<{ messages: Message[] }>(threadUrl(threadId, "/messages"))).messages;

/** Steers a thread: it is queued while the thread works, a new turn while it is idle. */
export const steerThread = async (threadId: string, text: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/messages"), { text })).thread;

/** Answers the question a waiting thread asked; the answer resumes its session. */
export const replyToThread = async (threadId: string, text: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/reply"), { text })).thread;

export const stopThread = async (threadId: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/stop"))).thread;

/** Ends a rate-limited thread's wait now instead of at its reset. */
export const resumeThread = async (threadId: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/resume"))).thread;

export const resolveThread = async (threadId: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/resolve"))).thread;

export const markThreadRead = async (threadId: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/read"))).thread;

export const deleteThread = async (threadId: string): Promise<void> => {
  await request<unknown>(threadUrl(threadId), { method: "DELETE" });
};

export interface OpenPullRequestResult {
  thread: Thread;
  pullRequest: PullRequestRef;
  /** False when the thread already had a pull request: the call only pushed what it did since. */
  created: boolean;
}

export type MergeMethod = "squash" | "merge" | "rebase";

export const openThreadPullRequest = (
  threadId: string,
  input: { draft?: boolean } = {},
): Promise<OpenPullRequestResult> =>
  post<OpenPullRequestResult>(threadUrl(threadId, "/pull-request"), input);

export const mergeThreadPullRequest = async (
  threadId: string,
  method?: MergeMethod,
): Promise<Thread> =>
  (
    await post<{ thread: Thread }>(
      threadUrl(threadId, "/pull-request/merge"),
      method ? { method } : undefined,
    )
  ).thread;

/** Brings the thread in line with the pull request as GitHub has it now. */
export const syncThreadPullRequest = async (threadId: string): Promise<Thread> =>
  (await post<{ thread: Thread }>(threadUrl(threadId, "/pull-request/sync"))).thread;

/** The files the thread changed in its worktree, with their counts and no hunks. */
export const getThreadDiff = (threadId: string): Promise<SessionGitDiff> =>
  request<SessionGitDiff>(threadUrl(threadId, "/diff"));

export const getThreadDiffFile = (threadId: string, path: string): Promise<SessionDiffFile> =>
  request<SessionDiffFile>(threadUrl(threadId, `/diff/file?path=${encodeURIComponent(path)}`));

/** The tool calls and status paragraphs of the thread's latest turns, which its messages do not carry. */
export const getThreadActivity = (threadId: string): Promise<ThreadActivity> =>
  request<ThreadActivity>(threadUrl(threadId, "/activity"));

/** Everything the thread's runs consumed. */
export const getThreadUsage = (threadId: string): Promise<ThreadUsage> =>
  request<ThreadUsage>(`/usage/threads/${encodeURIComponent(threadId)}`);
