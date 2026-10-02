import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ClaudeCodeProvider } from "@aop/llm-provider";
import type { ChatSession } from "../db/schema.ts";
import { hasValidMcpAccess } from "../mcp/auth.ts";
import {
  COORDINATOR_TOOL_NAMES,
  claudeMcpToolName,
  THREAD_TOOL_NAMES,
} from "../mcp/availability.ts";
import { buildRunOptions, resolveAopMcpUrl } from "./run-options.ts";
import { READ_ONLY_ACCESS, READ_ONLY_COMMANDS } from "./run-profile.ts";
import { NO_PROJECT_COLUMNS } from "./test-utils.ts";

/** Claude's own question tool (AOP asks through `aop_ask_user`) and the built-ins that wake or schedule a session. */
const THREAD_DISALLOWED_TOOLS = [
  "AskUserQuestion",
  "ScheduleWakeup",
  "CronCreate",
  "CronDelete",
  "CronList",
  "Monitor",
  "RemoteTrigger",
];

/** The one value after a single-valued `flag`; undefined when the command has no such flag. */
const valueAfter = (command: string[], flag: string): string | undefined => {
  const at = command.indexOf(flag);
  return at === -1 ? undefined : command[at + 1];
};

/** The arguments after `flag` up to the next flag: one value, or the whole list of a variadic one. */
const flagValues = (command: string[], flag: string): string[] => {
  const start = command.indexOf(flag);
  if (start === -1) return [];
  const rest = command.slice(start + 1);
  const end = rest.findIndex((arg) => arg.startsWith("--"));
  return end === -1 ? rest : rest.slice(0, end);
};

const session = (overrides: Partial<ChatSession> = {}): ChatSession => ({
  id: "isess_options",
  repo_id: "repo_1",
  title: "New session",
  named: false,
  runtime: "claude-code",
  runtime_configuration_id: null,
  model: "claude-opus-4-8",
  reasoning_effort: "high",
  runtime_alias: "cpe",
  runtime_session_id: "native-1",
  workspace_path: null,
  fast_mode: true,
  runtime_access_mode: "auto-accept-edits",
  pinned: false,
  settled_override: null,
  settled_at: null,
  last_read_at: null,
  created_at: "2026-09-30T09:00:00.000Z",
  updated_at: "2026-09-30T09:00:00.000Z",
  ...NO_PROJECT_COLUMNS,
  ...overrides,
});

let previousMcpUrl: string | undefined;

beforeEach(() => {
  previousMcpUrl = process.env.AOP_MCP_URL;
  process.env.AOP_MCP_URL = "http://127.0.0.1:25150/api/mcp";
});

afterEach(() => {
  if (previousMcpUrl === undefined) delete process.env.AOP_MCP_URL;
  else process.env.AOP_MCP_URL = previousMcpUrl;
});

describe("buildRunOptions", () => {
  test("maps the session row onto the adapter's run options", () => {
    const onSession = () => undefined;
    const options = buildRunOptions(
      session(),
      "/work/repo",
      "do it",
      onSession,
      "/logs/run.jsonl",
      ["/attachments"],
    );

    expect(options).toMatchObject({
      prompt: "do it",
      cwd: "/work/repo",
      isolation: "open",
      model: "claude-opus-4-8",
      reasoningEffort: "high",
      fastMode: true,
      accessMode: "auto-accept-edits",
      runtimeAlias: "cpe",
      resumeSessionId: "native-1",
      logFilePath: "/logs/run.jsonl",
      allowedDirectories: ["/attachments"],
      env: { AOP_CHAT_SESSION_ID: "isess_options", AOP_CHAT_WORKSPACE_PATH: "/work/repo" },
    });
    expect(options.onSession).toBe(onSession);
  });

  test("hands the adapter a brief to append to the system prompt, on a resumed turn too", () => {
    const options = buildRunOptions(
      session({ runtime_session_id: "native-1" }),
      "/work/repo",
      "do it",
      () => undefined,
      "/logs/run.jsonl",
      undefined,
      undefined,
      "# AOP project brief",
    );

    expect(options.appendSystemPrompt).toBe("# AOP project brief");
    expect(options.resumeSessionId).toBe("native-1");
    const command = new ClaudeCodeProvider().buildCommand(options);
    // Each takes one value, then comes the prompt.
    expect(
      command.slice(command.indexOf("--append-system-prompt"), command.indexOf("do it") + 1),
    ).toEqual([
      "--append-system-prompt",
      "# AOP project brief",
      "--system-prompt-snapshot",
      "off",
      "do it",
    ]);
  });

  test("leaves an unbound session without a resume id or alias", () => {
    const options = buildRunOptions(
      session({ runtime_session_id: null, runtime_alias: null }),
      "/work/repo",
      "first turn",
      () => undefined,
      "/logs/run.jsonl",
    );

    expect(options.resumeSessionId).toBeUndefined();
    expect(options.runtimeAlias).toBeUndefined();
  });
});

describe("buildRunOptions for project sessions", () => {
  const build = (overrides: Partial<ChatSession>) =>
    buildRunOptions(session(overrides), "/work/dir", "hi", () => undefined, "/logs/run.jsonl");

  test("a plain chat keeps its own settings, hooks and tools", () => {
    const options = build({});

    expect(options.isolation).toBe("open");
    expect(options.allowedTools).toBeUndefined();
    expect(options.disallowedTools).toBeUndefined();
    expect(options.builtInTools).toBeUndefined();
  });

  test("the coordinator is hermetic, holds the AOP tools only, and reads no CLAUDE.md or auto memory", () => {
    const options = build({
      kind: "coordinator",
      project_id: "proj_1",
      runtime_access_mode: "approval-required",
    });

    expect(options.isolation).toBe("hermetic");
    expect(options.accessMode).toBe("approval-required");
    expect(options.builtInTools).toEqual([]);
    expect(options.allowedTools).toContain("mcp__aop__thread_spawn");
    expect(options.allowedTools).toContain("mcp__aop__memory_write");
    expect(options.allowedTools).not.toContain("mcp__aop__aop_ask_user");
    expect(options.env).toMatchObject({
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      AOP_CHAT_SESSION_ID: "isess_options",
    });
    expect(new URL(options.mcpServerUrl ?? "").searchParams.get("sessionId")).toBe("isess_options");
  });

  test("no stored access mode can reopen the coordinator: a row saying full-access still runs approval-required", () => {
    for (const stored of ["full-access", "auto", "auto-accept-edits"] as const) {
      const options = build({
        kind: "coordinator",
        project_id: "proj_1",
        runtime_access_mode: stored,
      });

      expect(options.accessMode).toBe("approval-required");
    }
  });

  test("the coordinator's command line skips no permissions, asks for no built-in tool, and pre-approves only its own AOP tools", () => {
    const options = build({
      kind: "coordinator",
      project_id: "proj_1",
      runtime_access_mode: "full-access",
    });

    const command = new ClaudeCodeProvider().buildCommand(options);

    expect(command).not.toContain("--dangerously-skip-permissions");
    expect(command).not.toContain("--permission-mode");
    expect(command).toContain("--strict-mcp-config");
    expect(flagValues(command, "--tools")).toEqual([""]);
    expect(flagValues(command, "--allowedTools")).toEqual(
      COORDINATOR_TOOL_NAMES.map(claudeMcpToolName),
    );
  });

  test("a thread's command line carries the permission mode its project chose and its own tools", () => {
    const thread = (access: ChatSession["runtime_access_mode"]) =>
      new ClaudeCodeProvider().buildCommand(
        build({
          kind: "thread",
          project_id: "proj_1",
          state: "working",
          runtime_access_mode: access,
        }),
      );

    const accepting = thread("auto-accept-edits");
    const full = thread("full-access");

    expect(flagValues(accepting, "--permission-mode")).toEqual(["acceptEdits"]);
    expect(accepting).not.toContain("--dangerously-skip-permissions");
    expect(full).toContain("--dangerously-skip-permissions");
    expect(flagValues(accepting, "--allowedTools")).toEqual(
      THREAD_TOOL_NAMES.map(claudeMcpToolName),
    );
    expect(flagValues(accepting, "--disallowedTools")).toEqual(THREAD_DISALLOWED_TOOLS);
  });

  test("a read-only thread skips no permissions and pre-approves only its tools and commands that read history and open work", () => {
    const command = new ClaudeCodeProvider().buildCommand(
      build({
        kind: "thread",
        project_id: "proj_1",
        state: "working",
        runtime_access_mode: READ_ONLY_ACCESS,
      }),
    );

    expect(command).not.toContain("--dangerously-skip-permissions");
    expect(command).not.toContain("--permission-mode");
    expect(flagValues(command, "--allowedTools")).toEqual([
      ...THREAD_TOOL_NAMES.map(claudeMcpToolName),
      ...READ_ONLY_COMMANDS,
    ]);
    expect(READ_ONLY_COMMANDS.every((rule) => /^Bash\((git|gh) [a-z ]+:\*\)$/.test(rule))).toBe(
      true,
    );
    expect(flagValues(command, "--disallowedTools")).toEqual(THREAD_DISALLOWED_TOOLS);
  });

  test("a thread runs like the person's own Claude Code plus the thread tools, with the access its project chose", () => {
    const options = build({
      kind: "thread",
      project_id: "proj_1",
      state: "working",
      runtime_access_mode: "auto-accept-edits",
    });

    expect(options.isolation).toBe("open");
    expect(options.accessMode).toBe("auto-accept-edits");
    expect(options.builtInTools).toBeUndefined();
    expect(options.allowedTools).toEqual([
      "mcp__aop__aop_ask_user",
      "mcp__aop__aop_report_status",
      "mcp__aop__aop_open_pr",
      "mcp__aop__memory_read",
      "mcp__aop__memory_write",
      "mcp__aop__aop_library_save",
      "mcp__aop__aop_library_list",
      "mcp__aop__aop_library_read",
      "mcp__aop__aop_artifact_create",
      "mcp__aop__aop_artifact_update",
    ]);
    expect(options.disallowedTools).toEqual(THREAD_DISALLOWED_TOOLS);
    expect(options.env).not.toHaveProperty("CLAUDE_CODE_DISABLE_CLAUDE_MDS");
  });
});

describe("buildRunOptions for a session on Claude Code's own default", () => {
  const BRIEF = "# AOP project brief";
  const roles = {
    coordinator: { kind: "coordinator", runtime_access_mode: "approval-required" },
    thread: { kind: "thread", state: "working", runtime_access_mode: "auto-accept-edits" },
  } as const;
  const build = (overrides: Partial<ChatSession>, appendSystemPrompt?: string) =>
    buildRunOptions(
      session({ project_id: "proj_1", ...overrides }),
      "/work/dir",
      "the prompt",
      () => undefined,
      "/logs/run.jsonl",
      undefined,
      undefined,
      appendSystemPrompt,
    );

  test.each(["coordinator", "thread"] as const)(
    "%s: no model and no effort on the row name none, so the command line passes no flag, fresh or resumed",
    (role) => {
      for (const runtime_session_id of [null, "native-1"]) {
        const options = build({
          ...roles[role],
          model: null,
          reasoning_effort: null,
          runtime_session_id,
        });
        const command = new ClaudeCodeProvider().buildCommand(options);

        expect(options.model).toBeUndefined();
        expect(options.reasoningEffort).toBeUndefined();
        expect(command).not.toContain("--model");
        expect(command).not.toContain("--effort");
        expect(command.includes("--resume")).toBe(runtime_session_id !== null);
        expect(command).toContain("the prompt");
      }
    },
  );

  test.each(["coordinator", "thread"] as const)(
    "%s: a model and effort on the row still reach the command line, fresh or resumed",
    (role) => {
      for (const runtime_session_id of [null, "native-1"]) {
        const command = new ClaudeCodeProvider().buildCommand(
          build({
            ...roles[role],
            model: "claude-opus-4-8",
            reasoning_effort: "extra-high",
            runtime_session_id,
          }),
        );

        expect(valueAfter(command, "--model")).toBe("claude-opus-4-8");
        expect(valueAfter(command, "--effort")).toBe("xhigh");
        expect(valueAfter(command, "--resume")).toBe(runtime_session_id ?? undefined);
      }
    },
  );

  test("only the one the row names is passed", () => {
    const modelOnly = new ClaudeCodeProvider().buildCommand(
      build({ ...roles.thread, model: "claude-sonnet-4-6", reasoning_effort: null }),
    );
    const effortOnly = new ClaudeCodeProvider().buildCommand(
      build({ ...roles.thread, model: null, reasoning_effort: "high" }),
    );

    expect(valueAfter(modelOnly, "--model")).toBe("claude-sonnet-4-6");
    expect(modelOnly).not.toContain("--effort");
    expect(valueAfter(effortOnly, "--effort")).toBe("high");
    expect(effortOnly).not.toContain("--model");
  });

  test.each(["coordinator", "thread"] as const)(
    "%s: its brief and its prompt both survive the missing model flags",
    (role) => {
      const command = new ClaudeCodeProvider().buildCommand(
        build({ ...roles[role], model: null, reasoning_effort: null }, BRIEF),
      );

      expect(valueAfter(command, "--append-system-prompt")).toBe(BRIEF);
      expect(command).toContain("the prompt");
      // The prompt is a positional, so no variadic flag before it may have taken it as a value.
      const beforePrompt = command.slice(0, command.indexOf("the prompt"));
      const lastFlag = beforePrompt.filter((arg) => arg.startsWith("--")).at(-1);
      expect(["--mcp-config", "--disallowedTools", "--allowedTools", "--tools"]).not.toContain(
        lastFlag as string,
      );
    },
  );
});

describe("resolveAopMcpUrl", () => {
  test("hands an MCP-capable runtime an endpoint that only its own session can use", () => {
    const url = new URL(resolveAopMcpUrl("claude-code", "isess_a") ?? "");

    expect(url.origin + url.pathname).toBe("http://127.0.0.1:25150/api/mcp");
    expect(url.searchParams.get("sessionId")).toBe("isess_a");
    const token = url.searchParams.get("accessToken") ?? undefined;
    expect(hasValidMcpAccess("isess_a", token)).toBe(true);
    expect(hasValidMcpAccess("isess_b", token)).toBe(false);
  });

  test("hands a runtime without MCP support nothing", () => {
    expect(resolveAopMcpUrl("pi", "isess_a")).toBeUndefined();
  });
});

describe("buildRunOptions with the host's permission bypass", () => {
  const ON = { skipPermissions: true };
  const OFF = { skipPermissions: false };
  const command = (overrides: Partial<ChatSession>, host = ON) =>
    new ClaudeCodeProvider().buildCommand(
      buildRunOptions(
        session(overrides),
        "/work/dir",
        "hi",
        () => undefined,
        "/logs/run.jsonl",
        undefined,
        undefined,
        undefined,
        host,
      ),
    );
  const COORDINATOR = { kind: "coordinator", project_id: "proj_1" } as const;
  const THREAD = { kind: "thread", project_id: "proj_1", state: "working" } as const;

  test("off, every session keeps the access it had", () => {
    expect(
      flagValues(
        command({ ...THREAD, runtime_access_mode: "auto-accept-edits" }, OFF),
        "--permission-mode",
      ),
    ).toEqual(["acceptEdits"]);
    expect(command({ runtime_access_mode: "auto" }, OFF)).not.toContain(
      "--dangerously-skip-permissions",
    );
    expect(command(COORDINATOR, OFF)).not.toContain("--dangerously-skip-permissions");
  });

  test("on, a plain chat and a thread skip permission checks with the one flag and no permission mode", () => {
    // A thread on approval-required is a read-only one, which the last test covers.
    const sessions = [
      ...(["approval-required", "auto-accept-edits", "auto"] as const).map((access) => ({
        runtime_access_mode: access,
      })),
      ...(["auto-accept-edits", "full-access"] as const).map((access) => ({
        ...THREAD,
        runtime_access_mode: access,
      })),
    ];
    for (const overrides of sessions) {
      const cmd = command(overrides);
      expect(cmd.filter((arg) => arg === "--dangerously-skip-permissions")).toHaveLength(1);
      expect(cmd).not.toContain("--permission-mode");
      expect(cmd).not.toContain("--permission-prompt-tool");
    }
  });

  test("on, a thread keeps its own tools and still has no question or scheduling tools", () => {
    const cmd = command({ ...THREAD, runtime_access_mode: "auto-accept-edits" });

    expect(flagValues(cmd, "--allowedTools")).toEqual(THREAD_TOOL_NAMES.map(claudeMcpToolName));
    expect(flagValues(cmd, "--disallowedTools")).toEqual(THREAD_DISALLOWED_TOOLS);
  });

  test("on, the coordinator skips the checks but its tool set does not grow: no built-ins, and the ones that touch the host denied by name", () => {
    const on = command({ ...COORDINATOR, runtime_access_mode: "approval-required" });
    const off = command({ ...COORDINATOR, runtime_access_mode: "approval-required" }, OFF);

    expect(on).toContain("--dangerously-skip-permissions");
    expect(on).not.toContain("--permission-mode");
    for (const cmd of [on, off]) {
      expect(flagValues(cmd, "--tools")).toEqual([""]);
      expect(flagValues(cmd, "--disallowedTools")).toEqual(
        expect.arrayContaining(["Bash", "Read", "Edit", "Write", "NotebookEdit", "WebFetch"]),
      );
      expect(flagValues(cmd, "--allowedTools")).toEqual(
        COORDINATOR_TOOL_NAMES.map(claudeMcpToolName),
      );
      expect(cmd).toContain("--strict-mcp-config");
    }
  });

  test("on, a read-only thread stays read-only: its allow-list is what holds it, and a bypassed run would ignore it", () => {
    const cmd = command({ ...THREAD, runtime_access_mode: READ_ONLY_ACCESS });

    expect(cmd).not.toContain("--dangerously-skip-permissions");
    expect(cmd).not.toContain("--permission-mode");
    expect(flagValues(cmd, "--allowedTools")).toEqual([
      ...THREAD_TOOL_NAMES.map(claudeMcpToolName),
      ...READ_ONLY_COMMANDS,
    ]);
  });
});
