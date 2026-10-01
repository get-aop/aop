import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { useTestAopHome } from "@aop/infra";
import type { LLMProvider, RunOptions, RunResult } from "@aop/llm-provider";
import { NO_PROJECT_COLUMNS } from "../chat-session/test-utils.ts";
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
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: "claude-opus-5",
  reasoning_effort: "medium",
  runtime_alias: null,
  runtime_session_id: null,
  workspace_path: null,
  fast_mode: false,
  runtime_access_mode: "full-access",
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: now,
  updated_at: now,
  ...NO_PROJECT_COLUMNS,
  ...overrides,
});

const userMessage = (content: string, index = 0): ChatMessage => ({
  id: `msg_user_${index}`,
  session_id: "csess_draft_test",
  role: "user",
  content,
  action: null,
  activity: null,
  parts: null,
  steered_run_id: null,
  origin_json: null,
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
  parts: null,
  steered_run_id: null,
  origin_json: null,
  turn_index: index,
  disposition: "immediate",
  created_at: now,
});

/** Scripted provider that writes a Claude-style JSONL log with the given assistant text. */
const logWritingProvider = (assistantText: string, exitCode = 0): LLMProvider => ({
  name: "claude-code",
  async run(options: RunOptions): Promise<RunResult> {
    if (options.logFilePath) await writeResultLog(options.logFilePath, assistantText);
    return { exitCode };
  },
});

const capturingProvider = (
  onRun: (options: RunOptions) => Promise<RunResult>,
): LLMProvider & { calls: RunOptions[] } => {
  const calls: RunOptions[] = [];
  return {
    name: "claude-code",
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
    expect(provider.calls[0]?.model).toBe("claude-opus-5");
    expect(provider.calls[0]?.reasoningEffort).toBe("medium");
    expect(provider.calls[0]?.isolation).toBe("hermetic");
  });

  test("asks the provider factory for the session runtime", async () => {
    const provider = capturingProvider(async (options) => {
      await writeFixtureLog(options.logFilePath ?? "");
      return { exitCode: 0 };
    });
    const keys: string[] = [];
    await runDraft({}, (key) => {
      keys.push(key);
      return provider;
    });

    expect(keys).toEqual(["claude-code"]);
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
      throw new Error("claude not installed");
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

const writeResultLog = async (logFilePath: string, text: string): Promise<void> => {
  const events = [
    { type: "system", subtype: "init", session_id: "draft-session" },
    { type: "assistant", message: { content: [{ type: "text", text }] } },
    { type: "result", subtype: "success", result: text },
  ];
  await mkdir(dirname(logFilePath), { recursive: true });
  await writeFile(logFilePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
};

const writeFixtureLog = (logFilePath: string): Promise<void> =>
  writeResultLog(logFilePath, '{"title": "Fix checkout race", "body": "- Fixed the race"}');
