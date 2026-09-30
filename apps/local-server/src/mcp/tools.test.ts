import { afterEach, describe, expect, test } from "bun:test";
import type { Project, Thread } from "@aop/common";
import type { ChatSession } from "../db/schema.ts";
import {
  createProjectStack,
  type ProjectStack,
  projectSettings,
  useTempAopHome,
} from "../project/test-utils.ts";
import {
  COORDINATOR_TOOL_NAMES,
  PLAIN_TOOL_NAMES,
  THREAD_TOOL_NAMES,
  toolNamesFor,
} from "./availability.ts";
import { allMcpToolNames } from "./tools.ts";

const home = useTempAopHome();
let stack: ProjectStack | undefined;

afterEach(async () => {
  await stack?.cleanup();
  stack = undefined;
});

interface World {
  s: ProjectStack;
  project: Project;
  coordinator: ChatSession;
  thread: Thread;
}

const setup = async (): Promise<World> => {
  const s = await createProjectStack(home.path(), { repos: 2 });
  stack = s;
  const created = await s.services.projects.create(
    projectSettings({ repoIds: s.repos.map((repo) => repo.id) }),
  );
  if (!created.success) throw new Error("project not created");
  const coordinator = (await s.ctx.chatSessionRepository.getCoordinator(
    created.project.id,
  )) as ChatSession;
  const spawned = await s.services.threads.spawn(created.project.id, {
    title: "Audit retries",
    prompt: "Audit the retry code",
    repoId: s.repos[0]?.id,
  });
  if (!spawned.success) throw new Error(`thread not spawned: ${JSON.stringify(spawned.error)}`);
  await s.settle();
  return { s, project: created.project, coordinator, thread: spawned.thread };
};

const json = (result: { content: { text: string }[] }): Record<string, unknown> =>
  JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

describe("the tool registry", () => {
  test("defines exactly the tools each kind of session is meant to have", () => {
    const offered = new Set<string>([
      ...PLAIN_TOOL_NAMES,
      ...COORDINATOR_TOOL_NAMES,
      ...THREAD_TOOL_NAMES,
    ]);
    const defined = allMcpToolNames();

    expect([...offered].sort()).toEqual(defined.sort());
    for (const role of ["plain", "coordinator", "thread"] as const) {
      expect(toolNamesFor(role).every((name) => defined.includes(name))).toBe(true);
    }
  });
});

describe("a thread's tools", () => {
  test("aop_ask_user puts the thread on 'waiting on you' with the question and its options", async () => {
    const { s, thread } = await setup();

    const result = await s.callTool(thread.id, "aop_ask_user", {
      question: "Upgrade the Lambda, or pin the dependency?",
      options: ["Upgrade", "Pin"],
      recommended: "Upgrade",
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain("End your turn now");
    const after = await s.services.threads.get(thread.id);
    expect(after.success && after.thread).toMatchObject({
      status: "waiting-on-you",
      blockedQuestion: {
        question: "Upgrade the Lambda, or pin the dependency?",
        options: [
          { label: "Upgrade", recommended: true },
          { label: "Pin", recommended: false },
        ],
      },
    });
  });

  test("aop_ask_user takes object options and an open question with none", async () => {
    const { s, thread } = await setup();

    await s.callTool(thread.id, "aop_ask_user", {
      question: "Which env?",
      options: [{ label: "staging", recommended: true }, { label: "prod" }],
    });
    const withOptions = await s.services.threads.get(thread.id);
    expect(withOptions.success && withOptions.thread).toMatchObject({
      blockedQuestion: {
        options: [
          { label: "staging", recommended: true },
          { label: "prod", recommended: false },
        ],
      },
    });

    await s.callTool(thread.id, "aop_ask_user", { question: "What should I call it?" });
    const open = await s.services.threads.get(thread.id);
    expect(open.success && open.thread).toMatchObject({
      blockedQuestion: { question: "What should I call it?", options: [] },
    });
  });

  test("aop_ask_user refuses a recommendation that names no option and two recommended options", async () => {
    const { s, thread } = await setup();

    const unmatched = await s.callTool(thread.id, "aop_ask_user", {
      question: "Which?",
      options: ["a", "b"],
      recommended: "c",
    });
    const twice = await s.callTool(thread.id, "aop_ask_user", {
      question: "Which?",
      options: [
        { label: "a", recommended: true },
        { label: "b", recommended: true },
      ],
    });

    expect(unmatched.isError).toBe(true);
    expect(twice.isError).toBe(true);
    expect(twice.content[0]?.text).toContain("At most one option can be recommended");
    const after = await s.services.threads.get(thread.id);
    expect(after.success && after.thread.status).not.toBe("waiting-on-you");
  });

  test("aop_report_status replaces the checklist and sets or clears the status line", async () => {
    const { s, thread } = await setup();

    await s.callTool(thread.id, "aop_report_status", {
      line: "Bisecting · 7 commits left",
      steps: [
        { label: "Profile", state: "done" },
        { label: "Bisect", state: "active" },
        { label: "Patch", state: "pending" },
      ],
    });
    const reported = await s.services.threads.get(thread.id);
    expect(reported.success && reported.thread).toMatchObject({
      liveStatusLine: "Bisecting · 7 commits left",
      steps: [
        { label: "Profile", state: "done" },
        { label: "Bisect", state: "active" },
        { label: "Patch", state: "pending" },
      ],
    });

    await s.callTool(thread.id, "aop_report_status", { line: null });
    const cleared = await s.services.threads.get(thread.id);
    expect(cleared.success && cleared.thread.liveStatusLine).toBeNull();
    expect(cleared.success && cleared.thread.steps).toHaveLength(3);
  });

  test("aop_report_status needs something to report and refuses a malformed step", async () => {
    const { s, thread } = await setup();

    const empty = await s.callTool(thread.id, "aop_report_status", {});
    const badStep = await s.callTool(thread.id, "aop_report_status", {
      steps: [{ label: "Profile", state: "halfway" }],
    });

    expect(empty.isError).toBe(true);
    expect(badStep.isError).toBe(true);
  });
});

describe("memory tools", () => {
  test("the coordinator and every thread read and write the same project memory", async () => {
    const { s, thread, coordinator } = await setup();

    await s.callTool(coordinator.id, "memory_write", {
      name: "MEMORY.md",
      body: "- Payments: never touch the schema without asking (payments.md)",
    });
    await s.callTool(thread.id, "memory_write", {
      name: "payments.md",
      description: "Payment schema rules",
      body: "The ledger table is append-only.",
    });

    const index = json(await s.callTool(thread.id, "memory_read"));
    expect(index.index).toContain("Payments");
    expect(index.files).toMatchObject([
      { name: "MEMORY.md" },
      { name: "payments.md", description: "Payment schema rules" },
    ]);
    const topic = json(await s.callTool(coordinator.id, "memory_read", { name: "payments.md" }));
    expect(topic).toMatchObject({ body: "The ledger table is append-only." });
  });

  test("a write with a bad file name, or a read of a missing file, is an error result", async () => {
    const { s, coordinator } = await setup();

    const badName = await s.callTool(coordinator.id, "memory_write", {
      name: "../../etc/passwd",
      body: "x",
    });
    const missing = await s.callTool(coordinator.id, "memory_read", { name: "nope.md" });

    expect(badName.isError).toBe(true);
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toBe("Memory file not found");
  });
});

describe("the coordinator's tools", () => {
  test("thread_spawn starts a thread in the chosen repo and returns at once", async () => {
    const { s, coordinator, project } = await setup();

    const result = await s.callTool(coordinator.id, "thread_spawn", {
      title: "Harden checkout",
      prompt: "Harden the checkout flow",
      repoId: s.repos[1]?.id,
    });

    const started = json(result);
    expect(started).toMatchObject({ title: "Harden checkout", repoId: s.repos[1]?.id });
    const threads = await s.services.threads.list(project.id);
    expect(threads.success && threads.threads.map((thread) => thread.title).sort()).toEqual([
      "Audit retries",
      "Harden checkout",
    ]);
    await s.settle();
  });

  test("thread_spawn asks for a repository when the project has several, and refuses one it does not have", async () => {
    const { s, coordinator } = await setup();

    const ambiguous = await s.callTool(coordinator.id, "thread_spawn", { prompt: "do it" });
    const foreign = await s.callTool(coordinator.id, "thread_spawn", {
      prompt: "do it",
      repoId: "repo_elsewhere",
    });

    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]?.text).toContain("pick one of");
    expect(foreign.isError).toBe(true);
    expect(foreign.content[0]?.text).toContain("is not one of this project's repositories");
  });

  test("thread_list shows status and progress, and can filter by status", async () => {
    const { s, coordinator, thread } = await setup();
    await s.callTool(thread.id, "aop_report_status", {
      line: "Halfway",
      steps: [
        { label: "a", state: "done" },
        { label: "b", state: "pending" },
      ],
    });
    await s.callTool(thread.id, "aop_ask_user", { question: "Which?", options: ["x", "y"] });

    const all = json(await s.callTool(coordinator.id, "thread_list")) as { threads: unknown[] };
    const waiting = json(
      await s.callTool(coordinator.id, "thread_list", { status: "waiting-on-you" }),
    ) as { threads: unknown[] };
    const idle = json(await s.callTool(coordinator.id, "thread_list", { status: "idle" })) as {
      threads: unknown[];
    };

    expect(all.threads).toMatchObject([
      {
        id: thread.id,
        status: "waiting-on-you",
        progress: { done: 1, total: 2 },
        blockedQuestion: { question: "Which?" },
      },
    ]);
    expect(waiting.threads).toHaveLength(1);
    expect(idle.threads).toHaveLength(0);
  });

  test("thread_report returns the thread and the end of its transcript", async () => {
    const { s, coordinator, thread } = await setup();

    const report = json(
      await s.callTool(coordinator.id, "thread_report", { threadId: thread.id, messages: 5 }),
    ) as { thread: { id: string }; recent: { from: string; text: string }[] };

    expect(report.thread.id).toBe(thread.id);
    expect(report.recent.at(-1)?.text).toContain("Fake reply");
    expect(report.recent[0]?.text).toBe("Audit the retry code");
  });

  test("thread_steer sends to a thread and thread_stop ends its work", async () => {
    const { s, coordinator, thread } = await setup();

    const steered = json(
      await s.callTool(coordinator.id, "thread_steer", {
        threadId: thread.id,
        message: "Also check the backoff [fake: delay=30000]",
        quote: "make retries safer",
      }),
    );
    expect(steered).toMatchObject({ id: thread.id, status: "working" });
    const transcript = await s.services.threads.listMessages(thread.id);
    const relayed = transcript.success && transcript.messages.at(-1);
    expect(relayed && relayed.role === "assistant" && relayed.blocks[0]).toEqual({
      type: "quote-forwarded",
      text: "make retries safer",
    });

    const stopped = json(await s.callTool(coordinator.id, "thread_stop", { threadId: thread.id }));
    expect(stopped).toMatchObject({ id: thread.id, status: "idle" });
  }, 30_000);

  test("a coordinator only sees and steers its own project's threads", async () => {
    const { s, thread } = await setup();
    const other = await s.services.projects.create(projectSettings({ name: "Other" }));
    if (!other.success) throw new Error("project not created");
    const otherCoordinator = (await s.ctx.chatSessionRepository.getCoordinator(
      other.project.id,
    )) as ChatSession;

    const listed = json(await s.callTool(otherCoordinator.id, "thread_list")) as {
      threads: unknown[];
    };
    const steer = await s.callTool(otherCoordinator.id, "thread_steer", {
      threadId: thread.id,
      message: "take over",
    });
    const stop = await s.callTool(otherCoordinator.id, "thread_stop", { threadId: thread.id });
    const report = await s.callTool(otherCoordinator.id, "thread_report", { threadId: thread.id });

    expect(listed.threads).toEqual([]);
    for (const refused of [steer, stop, report]) {
      expect(refused.isError).toBe(true);
      expect(refused.content[0]?.text).toBe("Thread not found in this project");
    }
  });

  test("propose_threads needs a reply being written, and only names this project's repos", async () => {
    const { s, coordinator } = await setup();

    const outsideAReply = await s.callTool(coordinator.id, "propose_threads", {
      threads: [{ title: "Sketch", prompt: "Sketch it" }],
    });
    const foreignRepo = await s.callTool(coordinator.id, "propose_threads", {
      threads: [{ title: "Sketch", prompt: "Sketch it", repoId: "repo_elsewhere" }],
    });

    expect(outsideAReply.isError).toBe(true);
    expect(outsideAReply.content[0]?.text).toContain("No reply is being written");
    expect(foreignRepo.isError).toBe(true);
  });

  test("project_settings_get shows the settings and repos; project_settings_set changes only what it may", async () => {
    const { s, coordinator, project, thread } = await setup();

    const before = json(await s.callTool(coordinator.id, "project_settings_get")) as {
      goal: string;
      repos: { id: string }[];
      threadAccess: string;
    };
    expect(before.goal).toBe("Ship the new checkout");
    expect(before.repos.map((repo) => repo.id)).toEqual(s.repos.map((repo) => repo.id));

    const set = await s.callTool(coordinator.id, "project_settings_set", {
      goal: "Ship checkout v2",
      instructions: "Small PRs only.",
      threadModel: "fake-model",
      threadEffort: "low",
      notificationLevel: "off",
      // Not settings the coordinator holds: the schema drops them instead of applying them.
      threadAccess: "full-access",
      repoIds: [],
    });

    expect(set.isError).toBeUndefined();
    const after = await s.services.projects.get(project.id);
    expect(after.success && after.project).toMatchObject({
      goal: "Ship checkout v2",
      instructions: "Small PRs only.",
      thread: { provider: "claude-code", model: "fake-model", effort: "low" },
      notificationLevel: "off",
      threadAccess: "auto-accept-edits",
      repoIds: s.repos.map((repo) => repo.id),
    });
    // Nor did the attempt reach the sessions themselves: the coordinator is still
    // approval-required and the thread still auto-accepts edits only.
    const access = async (id: string) =>
      (await s.ctx.chatSessionRepository.getById(id))?.runtime_access_mode;
    expect(await access(coordinator.id)).toBe("approval-required");
    expect(await access(thread.id)).toBe("auto-accept-edits");
  });

  test("project_settings_set refuses an empty change and instructions past the limit", async () => {
    const { s, coordinator } = await setup();

    const empty = await s.callTool(coordinator.id, "project_settings_set", {});
    const tooLong = await s.callTool(coordinator.id, "project_settings_set", {
      instructions: "i".repeat(16_001),
    });

    expect(empty.isError).toBe(true);
    expect(tooLong.isError).toBe(true);
  });
});
