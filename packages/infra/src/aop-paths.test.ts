import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { aopPaths } from "./aop-paths.ts";

const DEFAULT_AOP_HOME = join(homedir(), ".aop");

describe("aopPaths", () => {
  let originalAopHome: string | undefined;

  beforeEach(() => {
    originalAopHome = process.env.AOP_HOME;
    delete process.env.AOP_HOME;
  });

  afterEach(() => {
    if (originalAopHome !== undefined) {
      process.env.AOP_HOME = originalAopHome;
    } else {
      delete process.env.AOP_HOME;
    }
  });

  test("home returns ~/.aop by default", () => {
    expect(aopPaths.home()).toBe(DEFAULT_AOP_HOME);
  });

  test("home respects AOP_HOME env var", () => {
    process.env.AOP_HOME = "/tmp/custom-aop";
    expect(aopPaths.home()).toBe("/tmp/custom-aop");
  });

  test("db returns <home>/aop.sqlite", () => {
    expect(aopPaths.db()).toBe(join(DEFAULT_AOP_HOME, "aop.sqlite"));
  });

  test("logs returns <home>/logs", () => {
    expect(aopPaths.logs()).toBe(join(DEFAULT_AOP_HOME, "logs"));
  });

  test("generalChatWorkspace returns <home>/chats/general", () => {
    expect(aopPaths.generalChatWorkspace()).toBe(join(DEFAULT_AOP_HOME, "chats", "general"));
  });

  test("agents returns <home>/agents", () => {
    expect(aopPaths.agents()).toBe(join(DEFAULT_AOP_HOME, "agents"));
  });

  test("agent returns <home>/agents/<agentId>", () => {
    expect(aopPaths.agent("agent_abc123")).toBe(join(DEFAULT_AOP_HOME, "agents", "agent_abc123"));
  });

  test("repoDir returns <home>/repos/<repoId>", () => {
    expect(aopPaths.repoDir("repo_abc123")).toBe(join(DEFAULT_AOP_HOME, "repos", "repo_abc123"));
  });

  test("repoRoot aliases <home>/repos/<repoId>", () => {
    expect(aopPaths.repoRoot("repo_abc123")).toBe(join(DEFAULT_AOP_HOME, "repos", "repo_abc123"));
  });

  test("repoTasks returns <home>/repos/<repoId>/tasks", () => {
    expect(aopPaths.repoTasks("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "tasks"),
    );
  });

  test("repoTask returns <home>/repos/<repoId>/tasks/<taskId>", () => {
    expect(aopPaths.repoTask("repo_abc123", "task_xyz789")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "tasks", "task_xyz789"),
    );
  });

  test("repoGroupChat returns <home>/repos/<repoId>/chats/group", () => {
    expect(aopPaths.repoGroupChat("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "repos", "repo_abc123", "chats", "group"),
    );
  });

  test("agents returns <home>/agents", () => {
    expect(aopPaths.agents()).toBe(join(DEFAULT_AOP_HOME, "agents"));
  });

  test("agent returns <home>/agents/<agentId>", () => {
    expect(aopPaths.agent("agent_abc123")).toBe(join(DEFAULT_AOP_HOME, "agents", "agent_abc123"));
  });

  test("agentPrivateChats returns <home>/agents/<agentId>/chats/private", () => {
    expect(aopPaths.agentPrivateChats("agent_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "agents", "agent_abc123", "chats", "private"),
    );
  });

  test("agentPrivateChat returns <home>/agents/<agentId>/chats/private/<channelId>", () => {
    expect(aopPaths.agentPrivateChat("agent_abc123", "chan_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "agents", "agent_abc123", "chats", "private", "chan_abc123"),
    );
  });

  test("agentRuntime returns <home>/agents/<agentId>/runtime/<provider>", () => {
    expect(aopPaths.agentRuntime("agent_abc123", "hermes")).toBe(
      join(DEFAULT_AOP_HOME, "agents", "agent_abc123", "runtime", "hermes"),
    );
  });

  test("relativeTaskDocs returns docs/tasks", () => {
    expect(aopPaths.relativeTaskDocs()).toBe(join("docs", "tasks"));
  });

  test("worktrees returns <home>/worktrees/<repoId>", () => {
    expect(aopPaths.worktrees("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123"),
    );
  });

  test("worktree returns <home>/worktrees/<repoId>/<taskId>", () => {
    expect(aopPaths.worktree("repo_abc123", "task_xyz789")).toBe(
      join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123", "task_xyz789"),
    );
  });

  test("worktreeMetadata returns <home>/worktrees/<repoId>/.metadata", () => {
    expect(aopPaths.worktreeMetadata("repo_abc123")).toBe(
      join(DEFAULT_AOP_HOME, "worktrees", "repo_abc123", ".metadata"),
    );
  });

  test("all paths use AOP_HOME when set", () => {
    process.env.AOP_HOME = "/tmp/test-aop";
    expect(aopPaths.agents()).toBe("/tmp/test-aop/agents");
    expect(aopPaths.agent("a1")).toBe("/tmp/test-aop/agents/a1");
    expect(aopPaths.repoDir("r1")).toBe("/tmp/test-aop/repos/r1");
    expect(aopPaths.repoRoot("r1")).toBe("/tmp/test-aop/repos/r1");
    expect(aopPaths.repoTasks("r1")).toBe("/tmp/test-aop/repos/r1/tasks");
    expect(aopPaths.repoTask("r1", "task-1")).toBe("/tmp/test-aop/repos/r1/tasks/task-1");
    expect(aopPaths.repoGroupChat("r1")).toBe("/tmp/test-aop/repos/r1/chats/group");
    expect(aopPaths.worktrees("r1")).toBe("/tmp/test-aop/worktrees/r1");
  });
});
