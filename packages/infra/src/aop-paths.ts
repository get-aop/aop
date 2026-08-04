import { homedir } from "node:os";
import { join } from "node:path";

const getAopHome = (): string => process.env.AOP_HOME ?? join(homedir(), ".aop");

export const aopPaths = {
  home: () => getAopHome(),
  db: () => join(getAopHome(), "aop.sqlite"),
  logs: () => join(getAopHome(), "logs"),
  generalChatWorkspace: () => join(getAopHome(), "chats", "general"),
  agents: () => join(getAopHome(), "agents"),
  agent: (agentId: string) => join(getAopHome(), "agents", agentId),
  repoDir: (repoId: string) => join(getAopHome(), "repos", repoId),
  repoRoot: (repoId: string) => join(getAopHome(), "repos", repoId),
  repoTasks: (repoId: string) => join(getAopHome(), "repos", repoId, "tasks"),
  repoTask: (repoId: string, taskId: string) =>
    join(getAopHome(), "repos", repoId, "tasks", taskId),
  repoGroupChat: (repoId: string) => join(getAopHome(), "repos", repoId, "chats", "group"),
  agentPrivateChats: (agentId: string) => join(getAopHome(), "agents", agentId, "chats", "private"),
  agentPrivateChat: (agentId: string, channelId: string) =>
    join(getAopHome(), "agents", agentId, "chats", "private", channelId),
  agentRuntime: (agentId: string, provider: string) =>
    join(getAopHome(), "agents", agentId, "runtime", provider),
  relativeTaskDocs: () => join("docs", "tasks"),
  worktrees: (repoId: string) => join(getAopHome(), "worktrees", repoId),
  worktree: (repoId: string, taskId: string) => join(getAopHome(), "worktrees", repoId, taskId),
  worktreeMetadata: (repoId: string) => join(getAopHome(), "worktrees", repoId, ".metadata"),
};
