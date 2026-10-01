import { describe, expect, test } from "bun:test";
import { parseStreamProgressLine, parseStreamProgressLines } from "./stream-progress-parse.ts";

describe("parseStreamProgressLine", () => {
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
    ).toEqual({ kind: "thought", data: "User asked a simple sum.", whole: true });

    expect(
      parseStreamProgressLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "text", text: "7 + 5 = 12." }],
          },
        }),
      ),
    ).toEqual({ kind: "text", data: "7 + 5 = 12.", whole: true });
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
      { kind: "thought", data: "Inspect first.", whole: true },
      { kind: "tool", phase: "start", name: "Read", itemId: "toolu_read", detail: "/a.ts" },
      {
        kind: "tool",
        phase: "start",
        name: "Bash",
        itemId: "toolu_bash",
        detail: "bun test",
      },
      { kind: "text", data: "Verification started.", whole: true },
    ]);
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

  test("parses Claude partial messages: a message, its blocks opening, growing and closing", () => {
    const stream = (event: Record<string, unknown>, parent: string | null = null) =>
      parseStreamProgressLines(
        JSON.stringify({
          type: "stream_event",
          event,
          parent_tool_use_id: parent,
          session_id: "s",
        }),
      );

    expect(stream({ type: "message_start", message: { id: "msg_1" } })).toEqual([
      { kind: "stream-message" },
    ]);
    expect(
      stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } }),
    ).toEqual([{ kind: "stream-start", index: 0, block: "thinking" }]);
    expect(
      stream({
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking: "Hm" },
      }),
    ).toEqual([{ kind: "stream-delta", index: 0, block: "thinking", data: "Hm" }]);
    expect(
      stream({
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text: "Café" },
      }),
    ).toEqual([{ kind: "stream-delta", index: 1, block: "text", data: "Café" }]);
    expect(
      stream({
        type: "content_block_start",
        index: 2,
        content_block: { type: "tool_use", id: "toolu_1", name: "mcp__aop__thread_spawn" },
      }),
    ).toEqual([
      {
        kind: "stream-start",
        index: 2,
        block: "tool",
        toolId: "toolu_1",
        toolName: "mcp aop thread spawn",
      },
    ]);
    expect(stream({ type: "content_block_stop", index: 2 })).toEqual([
      { kind: "stream-stop", index: 2 },
    ]);
  });

  test("leaves out what a person does not read: tool input, signatures, empty reasoning, a subagent's stream", () => {
    const stream = (event: Record<string, unknown>, parent: string | null = null) =>
      parseStreamProgressLines(
        JSON.stringify({ type: "stream_event", event, parent_tool_use_id: parent }),
      );

    for (const delta of [
      { type: "input_json_delta", partial_json: '{"command": "ls' },
      { type: "signature_delta", signature: "EvoD" },
      { type: "thinking_delta", thinking: "" },
    ]) {
      expect(stream({ type: "content_block_delta", index: 0, delta })).toEqual([]);
    }
    expect(stream({ type: "message_stop" })).toEqual([]);
    expect(
      stream(
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "sub" } },
        "toolu_agent",
      ),
    ).toEqual([]);
  });

  test("marks the run's closing result text as final", () => {
    expect(
      parseStreamProgressLines(
        JSON.stringify({ type: "result", subtype: "success", result: "Done." }),
      ),
    ).toEqual([{ kind: "text", data: "Done.", final: true }]);
  });
});
