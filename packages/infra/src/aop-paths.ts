import { homedir } from "node:os";
import { join } from "node:path";

const getAopHome = (): string => process.env.AOP_HOME ?? join(homedir(), ".aop");

export const aopPaths = {
  home: () => getAopHome(),
  /** Database file for the Projects product; the legacy aop.sqlite next to it is never opened. */
  db: () => join(getAopHome(), "projects.sqlite"),
  logs: () => join(getAopHome(), "logs"),
  generalChatWorkspace: () => join(getAopHome(), "chats", "general"),
  /** A project's own directory: its coordinator's workspace and the scratch space of repo-less threads. */
  projectDir: (projectId: string) => join(getAopHome(), "projects", projectId),
  repoDir: (repoId: string) => join(getAopHome(), "repos", repoId),
  relativeTaskDocs: () => join("docs", "tasks"),
  worktrees: (repoId: string) => join(getAopHome(), "worktrees", repoId),
  worktree: (repoId: string, taskId: string) => join(getAopHome(), "worktrees", repoId, taskId),
  worktreeMetadata: (repoId: string) => join(getAopHome(), "worktrees", repoId, ".metadata"),
};
