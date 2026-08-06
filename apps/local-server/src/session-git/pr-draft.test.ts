import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import type { ChatMessage, ChatSession } from "../db/schema.ts";
import { generatePullRequestDraft, parsePullRequestDraft } from "./pr-draft.ts";

const restoreAopHome = useTestAopHome();
afterEach(restoreAopHome);

const now = "2026-01-01T00:00:00.000Z";

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: "csess_draft_test",
  repo_id: "repo_1",
  title: "Fix checkout flow",
  named: false,
  runtime: "codex-cli",
  runtime_configuration_id: null,
  model: "gpt-5.4",
  reasoning_effort: "medium",
  runtime_alias: null,
  runtime_session_id: null,
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "full-access",
  default_worker_id: null,
  default_workflow_id: null,
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const userMessage = (content: string, index = 0): ChatMessage => ({
  id: `msg_user_${index}`,
  session_id: "csess_draft_test",
  role: "user",
  content,
  action: null,
  activity: null,
  turn_index: index,
  disposition: "immediate",
  created_at: now,
});

const assistantMessage = (content: string, index = 1): ChatMessage => ({
  id: `msg_assistant_${index}`,
  session_id: "csess_draft_test",
  role: "assistant",
  content,
  action: null,
  activity: null,
  turn_index: index,
  disposition: "immediate",
  created_at: now,
});

/** Scripted provider that writes a codex-style JSONL log with the given assistant text. */
const logWritingProvider = (assistantText: string, exitCode = 0): LLMProvider => ({
  name: "codex-cli",
  async run(options: RunOptions): Promise<RunResult> {
    if (options.logFilePath) {
      const events = [
        { type: "thread.started", thread_id: "draft-thread" },
        { type: "item.completed", item: { type: "agent_message", text: assistantText } },
        { type: "turn.completed", "last-assistant-message": assistantText },
      ];
      await mkdir(dirname(options.logFilePath), { recursive: true });
      await writeFile(
        options.logFilePath,
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
      );
    }
    return { exitCode };
  },
});

const capturingProvider = (
  onRun: (options: RunOptions) => Promise<RunResult>,
): LLMProvider & { calls: RunOptions[] } => {
  const calls: RunOptions[] = [];
  return {
    name: "codex-cli",
    calls,
    async run(options: RunOptions): Promise<RunResult> {
      calls.push(options);
      return onRun(options);
    },
  };
};

const runDraft = (
  overrides: Partial<Parameters<typeof generatePullRequestDraft>[0]> = {},
  createProviderFn?: (key: string) => LLMProvider,
) =>
  generatePullRequestDraft({
    session: session(),
    workspace: "/repo/.worktrees/feature",
    messages: [userMessage("Please fix the checkout flow."), assistantMessage("Done.")],
    changedFiles: ["src/checkout.ts", "src/checkout.test.ts"],
    fallbackTitle: "Fix checkout flow",
    ...overrides,
    createProviderFn,
  });

describe("generatePullRequestDraft", () => {
  test("returns the parsed title and body from the runtime output", async () => {
    const provider = logWritingProvider(
      'Here is the draft:\n```json\n{"title": "Fix checkout race", "body": "- Fixed the race\\n- Added tests"}\n```',
    );
    const draft = await runDraft({}, () => provider);

    expect(draft).toEqual({
      title: "Fix checkout race",
      body: "- Fixed the race\n- Added tests",
    });
  });

  test("includes the session title, changed files, and conversation in the prompt", async () => {
    const provider = capturingProvider(async (options) => {
      await writeFixtureLog(options.logFilePath ?? "");
      return { exitCode: 0 };
    });
    await runDraft({}, () => provider);

    const prompt = provider.calls[0]?.prompt ?? "";
    expect(prompt).toContain("Fix checkout flow");
    expect(prompt).toContain("src/checkout.ts");
    expect(prompt).toContain("src/checkout.test.ts");
    expect(prompt).toContain("Please fix the checkout flow.");
  });

  test("runs in read-only plan mode on the session runtime", async () => {
    const provider = capturingProvider(async (options) => {
      await writeFixtureLog(options.logFilePath ?? "");
      return { exitCode: 0 };
    });
    await runDraft({}, () => provider);

    expect(provider.calls[0]?.mode).toBe("plan");
    expect(provider.calls[0]?.model).toBe("gpt-5.4");
    expect(provider.calls[0]?.reasoningEffort).toBe("medium");
    expect(provider.calls[0]?.isolation).toBe("hermetic");
  });

  test("maps the opencode runtime to a prefixed provider key", async () => {
    const provider = capturingProvider(async (options) => {
      await writeFixtureLog(options.logFilePath ?? "");
      return { exitCode: 0 };
    });
    const keys: string[] = [];
    await runDraft(
      { session: session({ runtime: "opencode", model: "openai/gpt-5.6" }) },
      (key) => {
        keys.push(key);
        return provider;
      },
    );

    expect(keys).toEqual(["opencode:openai/gpt-5.6"]);
  });

  test("returns null without calling the runtime when there are no user messages", async () => {
    let called = false;
    const draft = await runDraft({ messages: [assistantMessage("Let me do this.")] }, () => {
      called = true;
      return logWritingProvider("");
    });

    expect(draft).toBeNull();
    expect(called).toBe(false);
  });

  test("returns null when the runtime exits non-zero", async () => {
    const draft = await runDraft({}, () => logWritingProvider("", 1));
    expect(draft).toBeNull();
  });

  test("returns null when the runtime output is not JSON", async () => {
    const draft = await runDraft({}, () => logWritingProvider("I summarized it for you."));
    expect(draft).toBeNull();
  });

  test("returns null when the runtime throws", async () => {
    const throwing = capturingProvider(async () => {
      throw new Error("codex not installed");
    });
    const draft = await runDraft({}, () => throwing);
    expect(draft).toBeNull();
  });
});

describe("parsePullRequestDraft", () => {
  test("parses a bare JSON object", () => {
    expect(parsePullRequestDraft('{"title": "Fix bug", "body": "- Fixed the bug"}')).toEqual({
      title: "Fix bug",
      body: "- Fixed the bug",
    });
  });

  test("parses JSON inside markdown fences", () => {
    expect(parsePullRequestDraft('```json\n{"title": "Fix bug", "body": "- Fixed"}\n```')).toEqual({
      title: "Fix bug",
      body: "- Fixed",
    });
  });

  test("parses JSON embedded in prose", () => {
    expect(
      parsePullRequestDraft('Draft:\n{"title": "Fix bug", "body": "- Fixed"}\nHope this helps.'),
    ).toEqual({ title: "Fix bug", body: "- Fixed" });
  });

  test("returns null for non-JSON output", () => {
    expect(parsePullRequestDraft("No JSON here.")).toBeNull();
    expect(parsePullRequestDraft("")).toBeNull();
  });

  test("returns null when title or body is missing", () => {
    expect(parsePullRequestDraft('{"title": "Fix bug"}')).toBeNull();
    expect(parsePullRequestDraft('{"body": "- Fixed"}')).toBeNull();
  });

  test("truncates overly long titles", () => {
    const draft = parsePullRequestDraft(`{"title": "${"x".repeat(300)}", "body": "- Fixed"}`);
    expect(draft?.title.length).toBe(120);
    expect(draft?.body).toBe("- Fixed");
  });
});

const writeFixtureLog = async (logFilePath: string): Promise<void> => {
  const text = '{"title": "Fix checkout race", "body": "- Fixed the race"}';
  const events = [
    { type: "thread.started", thread_id: "draft-thread" },
    { type: "item.completed", item: { type: "agent_message", text } },
    { type: "turn.completed", "last-assistant-message": text },
  ];
  await mkdir(dirname(logFilePath), { recursive: true });
  await writeFile(logFilePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
};
