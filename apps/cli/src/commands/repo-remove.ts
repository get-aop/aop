import { resolve } from "node:path";
import type { RemoveRepoOptions } from "@aop/common";
import { getLogger } from "@aop/infra";
import { fetchServer } from "./client.ts";

const logger = getLogger("cli", "repo-remove");

interface RepoStatus {
  id: string;
  path: string;
}

interface StatusResponse {
  repos: RepoStatus[];
}

interface RepoRemoveResponse {
  ok: boolean;
  repoId: string;
  abortedTasks: number;
  factoryReset?: boolean;
}

interface RepoRemoveCommandOptions extends RemoveRepoOptions {
  yes?: boolean;
}

export const repoRemoveCommand = async (
  repoPath?: string,
  options: RepoRemoveCommandOptions = {},
): Promise<void> => {
  const path = resolve(repoPath ?? process.cwd());
  const repo = await findRegisteredRepo(path);
  const repoName = path.split(/[\\/]/).pop() ?? path;
  confirmRepoRemoval(repoName, options);

  const forceParam = options.force ? "?force=true" : "";
  const result = await fetchServer<RepoRemoveResponse>(`/api/repos/${repo.id}${forceParam}`, {
    method: "DELETE",
  });

  if (!result.ok) {
    handleRemoveError(result);
    return;
  }

  if (result.data.abortedTasks > 0) {
    logger.info("Aborted {count} working tasks", { count: result.data.abortedTasks });
  }
  if (result.data.factoryReset) {
    logger.info("AOP data factory-reset after removing the last repository");
  }
  logger.info("Repository removed: {id}", { id: result.data.repoId, path });
};

const findRegisteredRepo = async (path: string): Promise<RepoStatus> => {
  const statusResult = await fetchServer<StatusResponse>("/api/status");
  if (!statusResult.ok) {
    logger.error("Error: Failed to fetch status from server");
    process.exit(1);
  }

  const repo = statusResult.data.repos.find((r) => r.path === path);
  if (!repo) {
    logger.error("Error: Repository not registered: {path}", { path });
    process.exit(1);
  }
  return repo;
};

const confirmRepoRemoval = (repoName: string, options: RepoRemoveCommandOptions): void => {
  if (options.yes) {
    return;
  }

  const typed = globalThis.prompt(
    `This permanently deletes all AOP data for ${repoName}. Type ${repoName} to continue:`,
  );
  if (typed !== repoName) {
    logger.error("Error: Repository removal cancelled");
    process.exit(1);
  }
};

const handleRemoveError = (
  result: Awaited<ReturnType<typeof fetchServer<RepoRemoveResponse>>>,
): void => {
  if (result.ok) {
    return;
  }

  if (result.error.error === "Cannot remove repo with working tasks") {
    logger.error(
      "Error: Cannot remove repository with {count} working tasks. Use --force to abort them.",
      { count: (result.error as { count?: number }).count ?? 0 },
    );
  } else {
    logger.error("Error: {error}", { error: result.error.error });
  }
  process.exit(1);
};
