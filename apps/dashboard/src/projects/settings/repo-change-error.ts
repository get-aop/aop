import type { Thread } from "@aop/common";
import { ApiError } from "../../api/request";

/** A repository as the Environment list shows it; name and path are null once it is unregistered. */
export interface ProjectRepoRef {
  id: string;
  name: string | null;
  path: string | null;
}

/**
 * Why adding or removing `repo` failed, as a sentence for its row. The host refuses to remove a
 * repository any thread of the project has (409 REPO_IN_USE), whatever its status; its message
 * names only the repository's id, so this says which threads hold it. Only an unresolved thread
 * "still works" in it: a resolved one has given up its checkout, but it still belongs to the
 * repository and blocks the removal until it is deleted, and the row says so.
 */
export const explainRepoChange = (
  cause: unknown,
  repo: ProjectRepoRef,
  threads: readonly Thread[],
): string => {
  if (!(cause instanceof ApiError)) return "Could not change the repositories";
  if (cause.code !== "REPO_IN_USE") return cause.message;
  const holders = threads.filter((thread) => thread.repoId === repo.id);
  if (holders.length === 0) return cause.message;
  const live = holders.filter((thread) => thread.status !== "resolved");
  return explainHolders(repo.name ?? repo.path ?? repo.id, live, holders.length - live.length);
};

const explainHolders = (where: string, live: readonly Thread[], resolved: number): string => {
  const working =
    live.length === 1 ? `“${live[0]?.title}” still works` : `${live.length} threads still work`;
  const done = resolved === 1 ? "1 resolved thread belongs" : `${resolved} resolved threads belong`;
  if (resolved === 0) {
    return `${working} in ${where}. Stop and delete ${live.length === 1 ? "it" : "them"} first, then remove the repository.`;
  }
  if (live.length === 0) {
    return `${done} to ${where}. Delete ${resolved === 1 ? "it" : "them"}, then remove the repository.`;
  }
  return `${working} in ${where}, and ${done} to it. Stop and delete them, then remove the repository.`;
};
