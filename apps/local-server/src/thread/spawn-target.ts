import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Project } from "@aop/common";
import { aopPaths } from "@aop/infra";
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

/** The repo's checkout, or a scratch directory for a thread that has no repo. */
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
    return await resolveChatWorkspace(repo.path, null);
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return { error: { code: "REPO_UNAVAILABLE", message: error.message } };
    }
    throw error;
  }
};

export const invalidMessage = (text: string): ThreadError | null => {
  if (!text.trim()) return { code: "INVALID_MESSAGE", message: "Message text is required" };
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
