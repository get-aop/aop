import { describe, expect, test } from "bun:test";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStreamProgressAccumulator,
  finalizeActivityContent,
  parseStreamProgressLine,
  parseStreamProgressLines,
  startLogProgressTail,
} from "./stream-progress.ts";

describe("parseStreamProgressLine", () => {
  test("parses Grok thought and text tokens", () => {
    expect(parseStreamProgressLine(JSON.stringify({ type: "thought", data: "The" }))).toEqual({
      kind: "thought",
      data: "The",
    });
    expect(parseStreamProgressLine(JSON.stringify({ type: "text", data: "Hey" }))).toEqual({
      kind: "text",
      data: "Hey",
    });
  });

  test("parses Codex agent_message items as text", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "item.completed",
          item: { type: "agent_message", text: "Hello from Codex" },
        }),
      ),
    ).toEqual({ kind: "text", data: "Hello from Codex" });
  });

  test("parses Codex command_execution as structured command events", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "item.started",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            status: "in_progress",
          },
        }),
      ),
    ).toEqual({
      kind: "command",
      phase: "start",
      command: "ls",
      itemId: "item_1",
    });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            exit_code: 0,
            status: "completed",
          },
        }),
      ),
    ).toEqual({
      kind: "command",
      phase: "done",
      command: "ls",
      itemId: "item_1",
      exitCode: 0,
    });
  });

  test("parses Claude thinking and text content blocks", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "thinking", thinking: "User asked a simple sum." }],
          },
        }),
      ),
    ).toEqual({ kind: "thought", data: "User asked a simple sum." });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "7 + 5 = 12." }],
          },
        }),
      ),
    ).toEqual({ kind: "text", data: "7 + 5 = 12." });
  });

  test("parses Claude tool_use with readable context", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { id: "toolu_1", type: "tool_use", name: "Bash", input: { command: "ls -la" } },
            ],
          },
        }),
      ),
    ).toEqual({
      kind: "tool",
      phase: "start",
      name: "Bash",
      itemId: "toolu_1",
      detail: "ls -la",
    });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Agent",
                input: {
                  description: "Inspect the session activity renderer",
                  prompt: "Long prompt",
                },
              },
            ],
          },
        }),
      ),
    ).toEqual({
      kind: "tool",
      phase: "start",
      name: "Agent",
      detail: "Inspect the session activity renderer",
    });
  });

  test("parses every Claude content block in provider order", () => {
    expect(
      parseStreamProgressLines(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "thinking", thinking: "Inspect first." },
              { id: "toolu_read", type: "tool_use", name: "Read", input: { file_path: "/a.ts" } },
              { id: "toolu_bash", type: "tool_use", name: "Bash", input: { command: "bun test" } },
              { type: "text", text: "Verification started." },
            ],
          },
        }),
      ),
    ).toEqual([
      { kind: "thought", data: "Inspect first." },
      { kind: "tool", phase: "start", name: "Read", itemId: "toolu_read", detail: "/a.ts" },
      {
        kind: "tool",
        phase: "start",
        name: "Bash",
        itemId: "toolu_bash",
        detail: "bun test",
      },
      { kind: "text", data: "Verification started." },
    ]);
  });

  test("matches Claude tool results and preserves failures", () => {
    const acc = createStreamProgressAccumulator();
    for (const event of [
      {
        type: "assistant",
        message: {
          content: [
            { id: "toolu_1", type: "tool_use", name: "Bash", input: { command: "bun test" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "failed", is_error: true },
          ],
        },
      },
    ]) {
      for (const chunk of parseStreamProgressLines(JSON.stringify(event))) acc.apply(chunk);
    }

    expect(acc.get().commandGroups[0]?.commands[0]).toMatchObject({
      id: "toolu_1",
      command: "Bash",
      detail: "bun test",
      result: "failed",
      status: "failed",
      exitCode: 1,
    });
  });

  test("captures Claude Task tool_result text without clobbering the start detail", () => {
    const acc = createStreamProgressAccumulator();
    for (const event of [
      {
        type: "assistant",
        message: {
          content: [
            {
              id: "toolu_task",
              type: "tool_use",
              name: "Task",
              input: { description: "Inspect cards" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_task",
              content: [{ type: "text", text: "Found three cards." }],
            },
          ],
        },
      },
    ]) {
      for (const chunk of parseStreamProgressLines(JSON.stringify(event))) acc.apply(chunk);
    }

    expect(acc.get().commandGroups[0]?.commands[0]).toMatchObject({
      id: "toolu_task",
      command: "Task",
      detail: "Inspect cards",
      result: "Found three cards.",
      status: "done",
    });
  });

  test("updates one Claude background-agent row through its native lifecycle", () => {
    const acc = createStreamProgressAccumulator();
    const apply = (event: Record<string, unknown>) => {
      for (const chunk of parseStreamProgressLines(JSON.stringify(event))) acc.apply(chunk);
    };

    apply({
      type: "system",
      subtype: "task_started",
      task_id: "agent_1",
      tool_use_id: "toolu_agent",
      description: "Inspect lifecycle ownership",
    });
    apply({
      type: "system",
      subtype: "task_progress",
      task_id: "agent_1",
      tool_use_id: "toolu_agent",
      description: "Tracing provider registration",
    });

    expect(acc.get().commandGroups[0]?.commands).toEqual([
      {
        id: "toolu_agent",
        command: "Agent",
        detail: "Tracing provider registration",
        status: "running",
        exitCode: null,
      },
    ]);

    apply({
      type: "system",
      subtype: "task_notification",
      task_id: "agent_1",
      tool_use_id: "toolu_agent",
      status: "completed",
      summary: "Lifecycle ownership traced",
    });

    expect(acc.get().commandGroups[0]?.commands[0]).toMatchObject({
      id: "toolu_agent",
      command: "Agent",
      detail: "Lifecycle ownership traced",
      status: "done",
      exitCode: 0,
    });
  });

  test("parses OpenCode text parts", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({ type: "text", part: { text: "Looking at the shell." } }),
      ),
    ).toEqual({ kind: "text", data: "Looking at the shell." });
  });

  test("parses OpenCode bash tool_use as command rows", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "tool_use",
          part: {
            type: "tool",
            tool: "bash",
            callID: "call_7cb4",
            state: {
              status: "completed",
              input: { command: "echo hello-from-opencode" },
              metadata: { exit: 0 },
              title: "echo hello-from-opencode",
            },
          },
        }),
      ),
    ).toEqual({
      kind: "command",
      phase: "done",
      command: "echo hello-from-opencode",
      itemId: "call_7cb4",
      exitCode: 0,
    });
  });

  test("parses Pi tool_execution_start/end", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "tool_execution_start",
          toolName: "bash",
          args: { command: "ls -la" },
        }),
      ),
    ).toEqual({ kind: "command", phase: "start", command: "ls -la" });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "tool_execution_end",
          toolName: "bash",
          args: { command: "ls -la" },
          isError: false,
        }),
      ),
    ).toEqual({ kind: "command", phase: "done", command: "ls -la", exitCode: 0 });
  });

  test("matches Pi command completion by tool call id when end args are omitted", () => {
    const acc = createStreamProgressAccumulator();
    const events = [
      {
        type: "tool_execution_start",
        toolCallId: "tool_42",
        toolName: "bash",
        args: { command: "git status --short" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "tool_42",
        toolName: "bash",
        isError: false,
      },
    ];

    let snapshot = acc.get();
    for (const event of events) {
      const chunk = parseStreamProgressLine(JSON.stringify(event));
      if (chunk) snapshot = acc.apply(chunk);
    }

    expect(snapshot.commandGroups).toHaveLength(1);
    expect(snapshot.commandGroups[0]?.commands).toEqual([
      {
        id: "tool_42",
        command: "git status --short",
        status: "done",
        exitCode: 0,
      },
    ]);
  });

  test("parses Pi exec_command with cmd args as shell command rows", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "tool_execution_start",
          toolName: "exec_command",
          args: { cmd: "sed -n '115,275p' apps/local-server/src/chat-session/runtime-engine.ts" },
        }),
      ),
    ).toEqual({
      kind: "command",
      phase: "start",
      command: "sed -n '115,275p' apps/local-server/src/chat-session/runtime-engine.ts",
    });
  });

  test("parses Pi thinking_end / text_end message updates", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "thinking_end", content: "Need to inspect files." },
        }),
      ),
    ).toEqual({ kind: "thought", data: "Need to inspect files." });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_update",
          assistantMessageEvent: { type: "text_end", content: "Here is the listing." },
        }),
      ),
    ).toEqual({ kind: "text", data: "Here is the listing." });
  });

  test("Pi message_end with thinking+text streams only text (thinking comes from thinking_end)", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "The user has 60 settled sessions from an old AOP version.",
              },
              { type: "text", text: "Here is the plan." },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "text", data: "Here is the plan." });
  });

  test("Pi turn_end does not re-stream the thinking block", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "turn_end",
          message: {
            role: "assistant",
            content: [
              {
                type: "thinking",
                thinking: "The user has 60 settled sessions from an old AOP version.",
              },
              { type: "text", text: "Let me check." },
            ],
          },
          toolResults: [],
        }),
      ),
    ).toEqual({ kind: "text", data: "Let me check." });
  });

  test("Pi agent_end messages array does not re-stream thinking blocks", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "agent_end",
          willRetry: false,
          messages: [
            { role: "user", content: [{ type: "text", text: "hi" }] },
            {
              role: "assistant",
              content: [
                {
                  type: "thinking",
                  thinking: "The user has 60 settled sessions from an old AOP version.",
                },
                { type: "text", text: "Let me check." },
              ],
            },
          ],
        }),
      ),
    ).toEqual({ kind: "text", data: "Let me check." });
  });

  test("ignores Pi non-assistant message_end blobs (runtime prompt + tool dumps)", () => {
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "user",
            content: [
              {
                type: "text",
                text: "ok cool\n\nFor AOP platform actions (tasks, workflows, workers), prefer the `aop` MCP tools.\n\n## Attached Images\n\n- #image1: `/tmp/x.png`",
              },
            ],
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "toolResult",
            content: [
              {
                type: "text",
                text: "Command: sed -n '115,275p' apps/local-server/src/chat-session/runtime-engine.ts\nOutput:\nconst executeProviderRun = async () => { ... }",
              },
            ],
          },
        }),
      ),
    ).toBeNull();

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "I recommend a vertical-slice correction." }],
          },
        }),
      ),
    ).toEqual({ kind: "text", data: "I recommend a vertical-slice correction." });
  });

  test("Pi mid-run stream never promotes prompt or tool dumps into answer content", () => {
    const acc = createStreamProgressAccumulator();
    const events = [
      {
        type: "message_end",
        message: {
          role: "user",
          content: [
            {
              type: "text",
              text: "fix it\n\nFor AOP platform actions...\n\n## Attached Images\n\n- #image1: `/tmp/x.png`",
            },
          ],
        },
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "thinking_end", content: "Inspecting the runtime engine." },
      },
      {
        type: "tool_execution_start",
        toolName: "exec_command",
        args: { cmd: "sed -n '1,20p' runtime-engine.ts" },
      },
      {
        type: "message_end",
        message: {
          role: "toolResult",
          content: [
            {
              type: "text",
              text: "Command: sed -n '1,20p' runtime-engine.ts\nOutput:\nexport const runSessionPrompt = ...",
            },
          ],
        },
      },
      {
        type: "tool_execution_end",
        toolName: "exec_command",
        args: { cmd: "sed -n '1,20p' runtime-engine.ts" },
        isError: false,
      },
      {
        type: "message_update",
        assistantMessageEvent: {
          type: "text_end",
          content: "Here is the corrected approach.",
        },
      },
    ];

    let snap = acc.get();
    for (const event of events) {
      const chunk = parseStreamProgressLine(JSON.stringify(event));
      if (chunk) snap = acc.apply(chunk);
    }

    expect(snap.thinking).toBe("Inspecting the runtime engine.");
    expect(snap.content).toBe("Here is the corrected approach.");
    expect(snap.content).not.toContain("For AOP platform actions");
    expect(snap.content).not.toContain("## Attached Images");
    expect(snap.content).not.toContain("Command: sed");
    expect(snap.commandGroups[0]?.commands.map((row) => row.command)).toEqual([
      "sed -n '1,20p' runtime-engine.ts",
    ]);
  });

  test("does not duplicate Pi status replayed by turn_end after tool execution", () => {
    const acc = createStreamProgressAccumulator();
    const status = "Tooling is ready. Now I'll inspect both images.";
    const events = [
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: status },
      },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: status }] },
      },
      {
        type: "tool_execution_start",
        toolName: "bash",
        args: { command: "identify son.jpg card.jpg" },
      },
      {
        type: "tool_execution_end",
        toolName: "bash",
        args: { command: "identify son.jpg card.jpg" },
        isError: false,
      },
      {
        type: "turn_end",
        message: { role: "assistant", content: [{ type: "text", text: status }] },
      },
    ];

    let snap = acc.get();
    for (const event of events) {
      const chunk = parseStreamProgressLine(JSON.stringify(event));
      if (chunk) snap = acc.apply(chunk);
    }

    expect(snap.content).toBe(status);
  });

  test("ignores noise and invalid lines", () => {
    expect(parseStreamProgressLine("not-json")).toBeNull();
    expect(parseStreamProgressLine(JSON.stringify({ type: "end" }))).toBeNull();
    expect(parseStreamProgressLine(JSON.stringify({ type: "thought" }))).toBeNull();
    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "error",
            message: "Under-development features enabled: chronicle.",
          },
        }),
      ),
    ).toBeNull();
  });
});

describe("createStreamProgressAccumulator", () => {
  test("skips full thinking blocks re-emitted by later Pi lifecycle events", () => {
    const acc = createStreamProgressAccumulator();
    const thinking = "The user has 60 settled sessions from an old AOP version locally.";

    acc.apply({ kind: "thought", data: thinking });
    const afterReplay = acc.apply({ kind: "thought", data: thinking });
    expect(afterReplay.thinking).toBe(thinking);
    const afterThirdReplay = acc.apply({ kind: "thought", data: thinking });
    expect(afterThirdReplay.thinking).toBe(thinking);
  });

  test("still appends a distinct thinking block after a re-emitted one", () => {
    const acc = createStreamProgressAccumulator();
    const first = "Inspect the repo first.";
    const second = "Then write the plan.";

    acc.apply({ kind: "thought", data: first });
    acc.apply({ kind: "thought", data: first });
    const snap = acc.apply({ kind: "thought", data: second });
    expect(snap.thinking).toBe(`${first}${second}`);
  });

  test("concatenates Grok-style thought then text tokens", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "thought", data: "Hello " });
    acc.apply({ kind: "thought", data: "world" });
    const mid = acc.apply({ kind: "text", data: "Hey" });
    expect(mid.thinking).toBe("Hello world");
    expect(mid.content).toBe("Hey");
    const end = acc.apply({ kind: "text", data: " there" });
    expect(end.content).toBe("Hey there");
  });

  test("stacks intermediate status text when a new Grok text run starts after tools/thinking", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "thought", data: "planning" });
    acc.apply({ kind: "text", data: "I'll inspect the layout…" });
    acc.apply({ kind: "command", phase: "start", command: "ls", itemId: "i1" });
    acc.apply({ kind: "command", phase: "done", command: "ls", itemId: "i1", exitCode: 0 });
    acc.apply({ kind: "thought", data: "write the answer" });
    const snap = acc.apply({ kind: "text", data: "### After\n\nDone." });
    expect(snap.thinking).toContain("planning");
    expect(snap.thinking).toContain("write the answer");
    // Live UI keeps prior status paragraphs so the user can follow agent progress.
    expect(snap.content).toContain("I'll inspect the layout…");
    expect(snap.content).toContain("### After\n\nDone.");
    expect(snap.content).toBe("I'll inspect the layout…\n\n### After\n\nDone.");
  });

  test("restores a completed background command to running when updates resume", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "command", phase: "start", command: "poll server", itemId: "call-1" });
    acc.apply({
      kind: "command",
      phase: "done",
      command: "poll server",
      itemId: "call-1",
      exitCode: 0,
    });

    const snapshot = acc.apply({
      kind: "command",
      phase: "update",
      command: "poll server",
      itemId: "call-1",
      detail: "attempt 14",
    });

    expect(snapshot.commandGroups[0]?.commands[0]).toMatchObject({
      status: "running",
      detail: "attempt 14",
      exitCode: null,
    });
  });

  test("keeps multiple Codex-style agent messages as stacked history", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "text", data: "Looking at create-task first." });
    acc.apply({ kind: "command", phase: "start", command: "rg create-task", itemId: "a" });
    acc.apply({
      kind: "command",
      phase: "done",
      command: "rg create-task",
      itemId: "a",
      exitCode: 0,
    });
    acc.apply({ kind: "text", data: "This is very informative. Digging into the flow next." });
    acc.apply({ kind: "command", phase: "start", command: "rg grill", itemId: "b" });
    const snap = acc.apply({
      kind: "command",
      phase: "done",
      command: "rg grill",
      itemId: "b",
      exitCode: 0,
    });
    expect(snap.content).toBe(
      "Looking at create-task first.\n\nThis is very informative. Digging into the flow next.",
    );
    expect(snap.commandGroups).toHaveLength(2);
  });

  test("groups sequential commands into a Codex-style Ran N batch", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "command", phase: "start", command: "ls", itemId: "i1" });
    acc.apply({ kind: "command", phase: "done", command: "ls", itemId: "i1", exitCode: 0 });
    acc.apply({ kind: "command", phase: "start", command: "pwd", itemId: "i2" });
    const snap = acc.apply({
      kind: "command",
      phase: "done",
      command: "pwd",
      itemId: "i2",
      exitCode: 0,
    });
    expect(snap.commandGroups).toHaveLength(1);
    expect(snap.commandGroups[0]?.commands).toHaveLength(2);
    expect(snap.commandGroups[0]?.commands.map((c) => c.command)).toEqual(["ls", "pwd"]);
    expect(snap.commandGroups[0]?.commands.every((c) => c.status === "done")).toBe(true);
  });

  test("preserves Claude tool ids and summaries in activity rows", () => {
    const acc = createStreamProgressAccumulator();
    const snap = acc.apply({
      kind: "tool",
      phase: "start",
      name: "Read",
      itemId: "toolu_read",
      detail: "/workspace/apps/dashboard/src/App.tsx",
    });

    expect(snap.commandGroups[0]?.commands[0]).toEqual({
      id: "toolu_read",
      command: "Read",
      detail: "/workspace/apps/dashboard/src/App.tsx",
      status: "running",
      exitCode: null,
    });
  });

  test("updates the visible detail for a running native tool", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({
      kind: "command",
      phase: "start",
      command: "Poll API readiness",
      itemId: "call-42",
    });
    const snap = acc.apply({
      kind: "command",
      phase: "update",
      command: "Poll API readiness",
      itemId: "call-42",
      detail: "attempt 4: api=000 ui=307",
    });

    expect(snap.commandGroups[0]?.commands[0]).toMatchObject({
      command: "Poll API readiness",
      detail: "attempt 4: api=000 ui=307",
      status: "running",
    });
  });

  test("starts a new command group after assistant text (Codex interleaving)", () => {
    const acc = createStreamProgressAccumulator();
    acc.apply({ kind: "command", phase: "start", command: "ls", itemId: "a" });
    acc.apply({ kind: "command", phase: "done", command: "ls", itemId: "a", exitCode: 0 });
    acc.apply({ kind: "text", data: "Looking around." });
    acc.apply({ kind: "command", phase: "start", command: "cat x", itemId: "b" });
    const snap = acc.apply({
      kind: "command",
      phase: "done",
      command: "cat x",
      itemId: "b",
      exitCode: 0,
    });
    expect(snap.content).toBe("Looking around.");
    expect(snap.commandGroups).toHaveLength(2);
    expect(snap.commandGroups[0]?.commands[0]?.command).toBe("ls");
    expect(snap.commandGroups[1]?.commands[0]?.command).toBe("cat x");
  });
});

describe("finalizeActivityContent", () => {
  test("keeps intermediate status history and appends the final answer", () => {
    expect(
      finalizeActivityContent(
        "Looking at create-task first.\n\nThis is very informative.",
        "Here is the plan.",
      ),
    ).toBe("Looking at create-task first.\n\nThis is very informative.\n\nHere is the plan.");
  });

  test("replaces a partial last run with the full final answer", () => {
    expect(finalizeActivityContent("Status update.\n\nHere is the", "Here is the plan.")).toBe(
      "Status update.\n\nHere is the plan.",
    );
  });

  test("splices multi-paragraph partial finals without duplication", () => {
    expect(finalizeActivityContent("Status\n\n### After\n\nDon", "### After\n\nDone.")).toBe(
      "Status\n\n### After\n\nDone.",
    );
  });

  test("matches finals despite trailing whitespace on the stream", () => {
    expect(finalizeActivityContent("Status\n\nFinal answer\n", "Final answer")).toBe(
      "Status\n\nFinal answer",
    );
  });

  test("does not clobber longer status when the final is a short prefix word", () => {
    expect(finalizeActivityContent("OK, I'll inspect the layout next.", "OK")).toBe(
      "OK, I'll inspect the layout next.\n\nOK",
    );
  });

  test("keeps a complete multi-paragraph final already present via endsWith", () => {
    const final = "### After\n\nDone.";
    expect(finalizeActivityContent(`Status update.\n\n${final}`, final)).toBe(
      `Status update.\n\n${final}`,
    );
  });

  test("interrupted runs keep streamed content", () => {
    expect(finalizeActivityContent("Partial status", "", true)).toBe("Partial status");
  });
});

describe("startLogProgressTail", () => {
  test("emits cumulative progress as the log grows", async () => {
    const dir = join(tmpdir(), `aop-stream-tail-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ thinking: string; content: string }> = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (s) => snapshots.push({ thinking: s.thinking, content: s.content }),
      minEmitIntervalMs: 0,
      pollIntervalMs: 15,
    });

    await appendFile(logFilePath, `${JSON.stringify({ type: "thought", data: "Think" })}\n`);
    await waitFor(() => snapshots.some((s) => s.thinking === "Think"), 2000);

    await appendFile(logFilePath, `${JSON.stringify({ type: "text", data: "Hi" })}\n`);
    await waitFor(() => snapshots.some((s) => s.content === "Hi"), 2000);

    await stop();
    expect(snapshots.at(-1)?.thinking).toBe("Think");
    expect(snapshots.at(-1)?.content).toBe("Hi");
  });

  test("batches multiple complete JSONL events from one write into one snapshot", async () => {
    const dir = join(tmpdir(), `aop-stream-batch-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ thinking: string; content: string; commands: number }> = [];
    const rawLines: string[] = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (s) =>
        snapshots.push({
          thinking: s.thinking,
          content: s.content,
          commands: s.commandGroups.reduce((n, group) => n + group.commands.length, 0),
        }),
      onLine: (line) => {
        rawLines.push(line);
      },
      minEmitIntervalMs: 0,
      pollIntervalMs: 5,
    });

    await appendFile(
      logFilePath,
      `${[
        JSON.stringify({ type: "thought", data: "Plan" }),
        JSON.stringify({ type: "text", data: "Answer" }),
        JSON.stringify({
          type: "item.started",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            status: "in_progress",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "cmd-1",
            type: "command_execution",
            command: "/bin/zsh -lc ls",
            exit_code: 0,
            status: "completed",
          },
        }),
        "not-json-noise",
      ].join("\n")}\n`,
    );

    await waitFor(() => snapshots.some((s) => s.content === "Answer"), 2000);
    await stop();

    // One batched snapshot for the multi-event write (plus nothing extra for noise).
    expect(snapshots.filter((s) => s.content === "Answer")).toHaveLength(1);
    expect(snapshots.at(-1)).toMatchObject({
      thinking: "Plan",
      content: "Answer",
      commands: 1,
    });
    expect(rawLines).toContain("not-json-noise");
    expect(rawLines.length).toBeGreaterThanOrEqual(5);
  });

  test("observes unterminated final lines and force-flushes a pending throttled snapshot once", async () => {
    const dir = join(tmpdir(), `aop-stream-flush-${crypto.randomUUID()}`);
    await mkdir(dir, { recursive: true });
    const logFilePath = join(dir, "run.jsonl");
    await writeFile(logFilePath, "");

    const snapshots: Array<{ content: string }> = [];
    const rawLines: string[] = [];
    const stop = startLogProgressTail({
      logFilePath,
      onProgress: (s) => snapshots.push({ content: s.content }),
      onLine: (line) => {
        rawLines.push(line);
      },
      // Throttle so the incomplete write stays pending until stop force-flushes.
      minEmitIntervalMs: 60_000,
      pollIntervalMs: 5,
    });

    await appendFile(logFilePath, `${JSON.stringify({ type: "text", data: "Partial" })}`);
    await Bun.sleep(20);
    expect(snapshots).toHaveLength(0);

    await stop();
    expect(rawLines).toEqual([JSON.stringify({ type: "text", data: "Partial" })]);
    expect(snapshots).toEqual([{ content: "Partial" }]);
  });
});

const waitFor = async (predicate: () => boolean, timeoutMs: number): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await Bun.sleep(20);
  }
  throw new Error("waitFor timed out");
};
