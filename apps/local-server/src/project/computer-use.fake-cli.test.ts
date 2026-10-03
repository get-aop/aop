import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "@aop/common";
import { ClaudeCodeProvider } from "@aop/llm-provider";
import { computerUse } from "../computer-use/service.ts";
import { createProjectStack, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// A project on CUA gives its threads CUA Driver's MCP server, read when each run is launched, and
// the command line the thread's Claude CLI is launched with carries it. Everything from the chat
// engine down to the spawn is real; the CLI and `cua-driver` are fakes.

const home = useTempAopHome();
let stack: ProjectStack | undefined;
const previousDriver = process.env.AOP_CUA_DRIVER;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
  if (previousDriver === undefined) delete process.env.AOP_CUA_DRIVER;
  else process.env.AOP_CUA_DRIVER = previousDriver;
  await computerUse.cuaStatus({ fresh: true });
});

/**
 * A `cua-driver` on the host. Ready, it answers the probe with both grants; not ready, it answers
 * nothing, which leaves the host not ready on any platform.
 */
const installFakeDriver = async (ready: boolean): Promise<string> => {
  const path = join(home.path(), `cua-driver-${crypto.randomUUID()}`);
  const permissions = JSON.stringify({ accessibility: true, screen_recording: true });
  writeFileSync(
    path,
    ready
      ? `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "cua-driver 0.32.0"; else echo '${permissions}'; fi\n`
      : "#!/bin/sh\nexit 1\n",
  );
  chmodSync(path, 0o755);
  process.env.AOP_CUA_DRIVER = path;
  expect((await computerUse.cuaStatus({ fresh: true })).status).toBe(ready ? "ready" : "not-ready");
  return path;
};

const setup = async () => {
  const s = await createProjectStack(home.path(), { mcp: true });
  stack = s;
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
  });
  expect(created.status).toBe(201);
  return { s, project: created.body.project };
};

const spawnThread = async (s: ProjectStack, project: Project): Promise<string> => {
  const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "work" });
  if (!spawned.success) throw new Error("thread not spawned");
  await s.settle();
  return spawned.thread.id;
};

const runsOf = (s: ProjectStack, sessionId: string) =>
  s.runs.filter((run) => run.env?.AOP_CHAT_SESSION_ID === sessionId);

/** The MCP servers on the command line of each launch for the session, by name. */
const launchedServersOf = (s: ProjectStack, sessionId: string): string[][] =>
  runsOf(s, sessionId).map((run) => {
    const cmd = new ClaudeCodeProvider().buildCommand(run);
    const config = JSON.parse(cmd[cmd.indexOf("--mcp-config") + 1] ?? "{}");
    return Object.keys(config.mcpServers ?? {}).sort();
  });

describe("computer use for a project's threads", () => {
  test("a project on the model's default adds no server to its threads", async () => {
    await installFakeDriver(true);
    const { s, project } = await setup();

    const threadId = await spawnThread(s, project);

    expect(runsOf(s, threadId)[0]?.extraMcpServers).toBeUndefined();
    expect(launchedServersOf(s, threadId)).toEqual([["aop"]]);
  });

  test("CUA reaches a thread from its next turn, and the coordinator never", async () => {
    const driver = await installFakeDriver(true);
    const { s, project } = await setup();
    const threadId = await spawnThread(s, project);

    const chosen = await s.api("PUT", `/api/projects/${project.id}/computer-use`, {
      computerUse: "cua",
    });
    expect(chosen.status).toBe(200);
    await s.services.threads.send(threadId, "check the page");
    await s.settle();
    await s.api("POST", `/api/projects/${project.id}/messages`, { text: "how is it going?" });
    await s.settle();

    // The thread reaches the driver through the host's gate, on its own session's token.
    const [first, second] = runsOf(s, threadId).map((run) => run.extraMcpServers);
    expect(first).toBeUndefined();
    const gate = second?.["cua-driver"];
    expect(gate?.type).toBe("http");
    const url = new URL(gate?.type === "http" ? gate.url : "http://none");
    expect(url.pathname).toBe("/api/mcp/cua");
    expect(url.searchParams.get("sessionId")).toBe(threadId);
    expect(url.searchParams.get("accessToken")).toBeTruthy();
    expect(driver).toBeTruthy();
    expect(launchedServersOf(s, threadId)).toEqual([["aop"], ["aop", "cua-driver"]]);
    const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
    const coordinatorRuns = runsOf(s, coordinator?.id ?? "");
    expect(coordinatorRuns.length).toBeGreaterThan(0);
    expect(coordinatorRuns.every((run) => run.extraMcpServers === undefined)).toBe(true);
  });

  test("a thread still runs when CUA Driver is not ready, without its tools", async () => {
    await installFakeDriver(false);
    const { s, project } = await setup();
    await s.api("PUT", `/api/projects/${project.id}/computer-use`, { computerUse: "cua" });

    const threadId = await spawnThread(s, project);

    const [run] = runsOf(s, threadId);
    expect(run).toBeDefined();
    expect(run?.extraMcpServers).toBeUndefined();
    expect(launchedServersOf(s, threadId)).toEqual([["aop"]]);
    const thread = await s.ctx.threadRepository.getById(threadId);
    expect(thread?.status).not.toBe("error");
  });
});
