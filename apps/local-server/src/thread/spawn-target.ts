import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { ChatImageAttachment, Project } from "@aop/common";
import { aopPaths } from "@aop/infra";
import { readStagedImages } from "../attachment/service.ts";
import { resolveChatWorkspace, WorkspaceBindingError } from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { Repo } from "../db/schema.ts";
import { THREAD_MESSAGE_MAX, THREAD_TITLE_MAX, type ThreadError } from "./types.ts";

/**
 * Which repo a new thread works in. The database cannot say that a thread's repo belongs to
 * its project's repos (that is a rule about two tables and a list), so it is checked here.
 * A project with one repo needs no choice, one with none gets repo-less threads, and one
 * with several makes the coordinator pick.
 */
export const pickRepo = async (
  ctx: LocalServerContext,
  project: Project,
  requested: string | null,
): Promise<{ repo: Repo | null } | { error: ThreadError }> => {
  const { repoIds } = project;
  const repoId = requested ?? (repoIds.length === 1 ? (repoIds[0] ?? null) : null);
  if (repoId === null) {
    return repoIds.length === 0 ? { repo: null } : { error: { code: "REPO_REQUIRED", repoIds } };
  }
  if (!repoIds.includes(repoId)) {
    return { error: { code: "REPO_NOT_IN_PROJECT", repoId, repoIds } };
  }
  const repo = await ctx.repoRepository.getById(repoId);
  return repo
    ? { repo }
    : { error: { code: "REPO_UNAVAILABLE", message: `Repository ${repoId} no longer exists` } };
};

/**
 * Where a new thread works: its own worktree of the repo, which the caller creates, or a
 * scratch directory for a thread that has no repo. The repo must still be there to branch from.
 */
export const threadWorkspace = async (
  projectId: string,
  threadId: string,
  repo: Repo | null,
): Promise<string | { error: ThreadError }> => {
  if (!repo) {
    const scratch = join(aopPaths.projectDir(projectId), "threads", threadId);
    await mkdir(scratch, { recursive: true });
    return realpath(scratch);
  }
  try {
    await resolveChatWorkspace(repo.path, null);
    return aopPaths.worktree(repo.id, threadId);
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { error: { code: "REPO_UNAVAILABLE", message: error.message } };
    }
    throw error;
  }
};

/** The repo, workspace and branch a new thread gets, or why it cannot have them. */
export const planTarget = async (
  ctx: LocalServerContext,
  chooseBranch: (repoPath: string, threadId: string, title: string) => Promise<string>,
  project: Project,
  thread: { threadId: string; title: string },
  requestedRepoId: string | null,
): Promise<
  { repo: Repo | null; workspace: string; branch: string | null } | { error: ThreadError }
> => {
  const target = await pickRepo(ctx, project, requestedRepoId);
  if ("error" in target) return target;
  const workspace = await threadWorkspace(project.id, thread.threadId, target.repo);
  if (typeof workspace !== "string") return workspace;
  const branch = target.repo
    ? await chooseBranch(target.repo.path, thread.threadId, thread.title)
    : null;
  return { repo: target.repo, workspace, branch };
};

type InvalidMessage = Extract<ThreadError, { code: "INVALID_MESSAGE" }>;

/**
 * A message to the coordinator or a thread, checked: its text, and the images it names (ids of
 * uploads to the project) read in order for the chat engine.
 */
export const readMessageInput = async (
  projectId: string,
  text: string,
  imageIds: readonly string[],
): Promise<{ images: ChatImageAttachment[] } | { error: InvalidMessage }> => {
  const invalid = invalidMessage(text, { withImages: imageIds.length > 0 });
  if (invalid) return { error: invalid };
  const staged = await readStagedImages(projectId, imageIds);
  return "error" in staged ? { error: { code: "INVALID_MESSAGE", message: staged.error } } : staged;
};

/** A message of images alone (`withImages`) may have no text. */
export const invalidMessage = (
  text: string,
  { withImages = false }: { withImages?: boolean } = {},
): InvalidMessage | null => {
  if (!text.trim() && !withImages) {
    return { code: "INVALID_MESSAGE", message: "Message text is required" };
  }
  if (text.length > THREAD_MESSAGE_MAX) {
    return {
      code: "INVALID_MESSAGE",
      message: `Message text is over ${THREAD_MESSAGE_MAX} characters`,
    };
  }
  return null;
};

export const threadTitle = (title: string | undefined, prompt: string): string => {
  const chosen = title?.trim() || prompt.split("\n").find((line) => line.trim()) || "New thread";
  const trimmed = chosen.trim();
  return trimmed.length <= THREAD_TITLE_MAX
    ? trimmed
    : `${trimmed.slice(0, THREAD_TITLE_MAX - 1)}…`;
};
