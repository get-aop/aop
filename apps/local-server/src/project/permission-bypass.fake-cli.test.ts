import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { AssistantMessage, Message, Project } from "@aop/common";
import { readLaunches } from "@aop/llm-provider/test-fixtures";
import { SettingKey } from "../settings/types.ts";
import { createProjectStack, eventually, type ProjectStack, useTempAopHome } from "./test-utils.ts";

// The host owner's "skip permission checks" setting, through the real engine, adapter, relay and
// FIFO, with the fake CLI as Claude: it records the flags every launch received. The setting is
// read at each launch, so turning it on reaches the next turn of a running host.

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

const setup = async () => {
  const s = await createProjectStack(home.path(), { mcp: true });
  stack = s;
  // Edit files: without the bypass, its threads launch with `--permission-mode acceptEdits`.
  const created = await s.api<{ project: Project }>("POST", "/api/projects", {
    name: "Checkout",
    repoIds: s.repos.map((repo) => repo.id),
    threadAccess: "auto-accept-edits",
  });
  const project = created.body.project;
  const coordinator = await s.ctx.chatSessionRepository.getCoordinator(project.id);
  if (!coordinator) throw new Error("no coordinator");
  return { s, project, coordinatorId: coordinator.id };
};

const skipPermissions = (s: ProjectStack, on: boolean) =>
  s.ctx.settingsRepository.set(SettingKey.AGENT_CLI_SKIP_PERMISSIONS, String(on));

/** The flags of every launch the fake CLI saw for the session, in order. */
const launchFlagsOf = async (s: ProjectStack, sessionId: string): Promise<string[][]> => {
  const nativeId = (await s.ctx.chatSessionRepository.getById(sessionId))?.runtime_session_id;
  const launches = await readLaunches(join(home.path(), "fake-cli"), "claude", nativeId ?? "");
  return launches.map((launch) => launch.flags);
};

const recordedBypass = async (s: ProjectStack, sessionId: string) =>
  (
    await s.db
      .selectFrom("chat_runs")
      .select("permissions_bypassed")
      .where("session_id", "=", sessionId)
      .orderBy("created_at")
      .orderBy("id")
      .execute()
  ).map((run) => run.permissions_bypassed);

const cliStarted = (s: ProjectStack, sessionId: string) =>
  eventually(
    async () =>
      (await s.ctx.chatSessionRepository.getById(sessionId))?.runtime_session_id ?? undefined,
    "the CLI to start",
  );

describe("with skip permission checks on", () => {
  test("a thread launches with --dangerously-skip-permissions and no permission mode, whatever its project chose", async () => {
    const { s, project } = await setup();
    await skipPermissions(s, true);

    const spawned = await s.services.threads.spawn(project.id, { title: "Work", prompt: "work" });
    if (!spawned.success) throw new Error("thread not spawned");
    await s.settle();

    const [flags = []] = await launchFlagsOf(s, spawned.thread.id);
    expect(flags).toContain("--dangerously-skip-permissions");
    expect(flags).not.toContain("--permission-mode");
    expect(flags).not.toContain("--permission-prompt-tool");
    expect(await recordedBypass(s, spawned.thread.id)).toEqual([1]);
  });

  test("the coordinator skips the checks too, but its command line still asks for no built-in tool and denies the ones that touch the host", async () => {
    const { s, project, coordinatorId } = await setup();
    await skipPermissions(s, true);

    await s.api("POST", `/api/projects/${project.id}/messages`, { text: "hello" });
    await s.settle();

    const [flags = []] = await launchFlagsOf(s, coordinatorId);
    expect(flags).toContain("--dangerously-skip-permissions");
    expect(flags).not.toContain("--permission-mode");
    expect(flags).toContain("--tools");
    expect(flags).toContain("--disallowedTools");
    expect(flags).toContain("--strict-mcp-config");
    const run = s.runs.find((options) => options.env?.AOP_CHAT_SESSION_ID === coordinatorId);
    expect(run?.builtInTools).toEqual([]);
    expect(run?.disallowedTools).toEqual(expect.arrayContaining(["Bash", "Read", "Edit", "Write"]));
    expect(await recordedBypass(s, coordinatorId)).toEqual([1]);
  });

  test("turning it on reaches the next turn, a resume, without a restart, and each run records what it ran with", async () => {
    const { s, project, coordinatorId } = await setup();
    const path = `/api/projects/${project.id}/messages`;

    await s.api("POST", path, { text: "first" });
    await s.settle();
    await skipPermissions(s, true);
    await s.api("POST", path, { text: "second" });
    await s.settle();
    await skipPermissions(s, false);
    await s.api("POST", path, { text: "third" });
    await s.settle();

    const [first = [], second = [], third = []] = await launchFlagsOf(s, coordinatorId);
    expect(first).not.toContain("--dangerously-skip-permissions");
    expect(second).toContain("--dangerously-skip-permissions");
    expect(second).toContain("--resume");
    expect(third).not.toContain("--dangerously-skip-permissions");
    expect(await recordedBypass(s, coordinatorId)).toEqual([0, 1, 0]);
  }, 30_000);

  test("a message sent while the turn works still reaches it through its input", async () => {
    const { s, project, coordinatorId } = await setup();
    await skipPermissions(s, true);
    const path = `/api/projects/${project.id}/messages`;

    await s.api("POST", path, { text: "Plan the release [fake: steps=3 delay=200]" });
    await cliStarted(s, coordinatorId);
    const sent = await s.api<{ message: Message }>("POST", path, { text: "Skip the beta" });
    await s.settle();

    const messages = (await s.api<{ messages: Message[] }>("GET", path)).body.messages;
    const reply = messages.find(
      (message): message is AssistantMessage => message.role === "assistant",
    );
    expect(reply?.blocks.filter((block) => block.type === "steer")).toEqual([
      expect.objectContaining({ messageId: sent.body.message.id }),
    ]);
    const [flags = []] = await launchFlagsOf(s, coordinatorId);
    expect(flags).toEqual(
      expect.arrayContaining([
        "--dangerously-skip-permissions",
        "--input-format",
        "--replay-user-messages",
      ]),
    );
  }, 30_000);
});
