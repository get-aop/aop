import type {
  MessagePage,
  PullRequestRef,
  SessionDiffFile,
  SessionDiffHunk,
  SessionGitDiff,
  Thread,
  ThreadUsage,
} from "@aop/common";
import { messageBody, type SendOptions } from "./project-chat";
import { beforeQuery, request } from "./request";

const threadUrl = (threadId: string, suffix = ""): string =>
  `/threads/${encodeURIComponent(threadId)}${suffix}`;

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

/** A page of one thread's messages, oldest first: the latest, or the one before message `before`. */
export const listThreadMessages = (threadId: string, before?: string): Promise<MessagePage> =>
  request<MessagePage>(threadUrl(threadId, `/messages${beforeQuery(before)}`));

/**
 * Steers a thread: while it works, the message reaches its running turn after the step it is on
 * (with `afterTurn`, once the turn has ended); while it is idle, it starts a new turn. `images`
 * are ids of images uploaded to the thread's project, in order.
 */
export const steerThread = async (
  threadId: string,
  text: string,
  images: readonly string[] = [],
  { afterTurn = false }: SendOptions = {},
): Promise<Thread> =>
  (
    await post<{ thread: Thread }>(
      threadUrl(threadId, "/messages"),
      messageBody(text, images, afterTurn),
    )
  ).thread;

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
export const getThreadDiff = async (threadId: string): Promise<SessionGitDiff> => {
  const diff = await request<WireDiff>(threadUrl(threadId, "/diff"));
  return { ...diff, files: diff.files.map(withHunks) };
};

export const getThreadDiffFile = async (threadId: string, path: string): Promise<SessionDiffFile> =>
  withHunks(
    await request<WireDiffFile>(threadUrl(threadId, `/diff/file?path=${encodeURIComponent(path)}`)),
  );

/** Everything the thread's runs consumed. */
export const getThreadUsage = (threadId: string): Promise<ThreadUsage> =>
  request<ThreadUsage>(`/usage/threads/${encodeURIComponent(threadId)}`);

// A host may leave `hunks` out of a file it lists without its lines (see
// `SessionDiffFile.detailsPending`); every caller here gets the declared shape.
type WireDiffFile = Omit<SessionDiffFile, "hunks"> & { hunks?: SessionDiffHunk[] };
type WireDiff = Omit<SessionGitDiff, "files"> & { files: WireDiffFile[] };

const withHunks = (file: WireDiffFile): SessionDiffFile => ({ ...file, hunks: file.hunks ?? [] });
