import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ArtifactResultRef, formatArtifactMarker, type TurnPart } from "@aop/common";
import { generateTypeId, typeIdToUuid } from "@aop/infra";
import type { ProgressChunk } from "./stream-progress-parse.ts";
import { parseStreamProgressLines } from "./stream-progress-parse.ts";
import { createTurnAccumulator } from "./turn-accumulator.ts";

const turnOfChunks = (...chunks: ProgressChunk[]): TurnPart[] =>
  createTurnAccumulator().applyAll(chunks);

const turnOfEvents = (...events: Record<string, unknown>[]): TurnPart[] =>
  createTurnAccumulator().applyAll(
    events.flatMap((event) => parseStreamProgressLines(JSON.stringify(event))),
  );

const tool = (overrides: Partial<Extract<TurnPart, { type: "tool" }>>): TurnPart => ({
  type: "tool",
  id: "t1",
  name: "Bash",
  detail: null,
  status: "running",
  ...overrides,
});

describe("createTurnAccumulator", () => {
  test("keeps reasoning, prose and tool calls in the order the runtime produced them", () => {
    expect(
      turnOfChunks(
        { kind: "thought", data: "planning" },
        { kind: "text", data: "I'll inspect the layout…" },
        { kind: "command", phase: "start", command: "ls", itemId: "i1" },
        { kind: "command", phase: "done", command: "ls", itemId: "i1", exitCode: 0 },
        { kind: "thought", data: "write the answer" },
        { kind: "text", data: "### After\n\nDone." },
      ),
    ).toEqual([
      { type: "thinking", text: "planning" },
      { type: "text", text: "I'll inspect the layout…" },
      tool({ id: "i1", name: "Shell", detail: "ls", status: "done" }),
      { type: "thinking", text: "write the answer" },
      { type: "text", text: "### After\n\nDone." },
    ]);
  });

  test("concatenates token-sized reasoning and text into one part each", () => {
    expect(
      turnOfChunks(
        { kind: "thought", data: "Hello " },
        { kind: "thought", data: "world" },
        { kind: "text", data: "Hey" },
        { kind: "text", data: " there" },
      ),
    ).toEqual([
      { type: "thinking", text: "Hello world" },
      { type: "text", text: "Hey there" },
    ]);
  });

  test("skips a reasoning block that a later Pi lifecycle event carries again", () => {
    const thinking = "The user has 60 settled sessions from an old AOP version locally.";
    expect(
      turnOfChunks(
        { kind: "thought", data: thinking },
        { kind: "thought", data: thinking },
        { kind: "thought", data: thinking },
        { kind: "thought", data: "Then write the plan." },
      ),
    ).toEqual([{ type: "thinking", text: `${thinking}Then write the plan.` }]);
  });

  test("starts a new reasoning part after a tool call", () => {
    const parts = turnOfChunks(
      { kind: "thought", data: "Let me look at the image." },
      { kind: "tool", phase: "start", name: "read" },
      { kind: "tool", phase: "done", name: "read" },
      { kind: "thought", data: "The model doesn't support images." },
    );
    expect(parts.map((part) => part.type)).toEqual(["thinking", "tool", "thinking"]);
    expect(parts[1]).toMatchObject({ name: "read", status: "done" });
  });

  test("merges a runtime that re-sends the whole text so far", () => {
    expect(
      turnOfChunks(
        { kind: "text", data: "Looking at the" },
        { kind: "text", data: "Looking at the retry code now." },
      ),
    ).toEqual([{ type: "text", text: "Looking at the retry code now." }]);
  });

  test("does not repeat Pi status that turn_end replays after a tool call", () => {
    const status = "Tooling is ready. Now I'll inspect both images.";
    const parts = turnOfEvents(
      { type: "message_update", assistantMessageEvent: { type: "text_end", content: status } },
      {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: status }] },
      },
      { type: "tool_execution_start", toolName: "bash", args: { command: "identify a.jpg" } },
      {
        type: "tool_execution_end",
        toolName: "bash",
        args: { command: "identify a.jpg" },
        isError: false,
      },
      {
        type: "turn_end",
        message: { role: "assistant", content: [{ type: "text", text: status }] },
      },
    );
    expect(parts).toEqual([
      { type: "text", text: status },
      tool({ id: "tool_1", name: "Shell", detail: "identify a.jpg", status: "done" }),
    ]);
  });

  test("never lets Pi's prompt or tool output into the turn", () => {
    const parts = turnOfEvents(
      {
        type: "message_end",
        message: {
          role: "user",
          content: [
            { type: "text", text: "fix it\n\n## Attached Images\n\n- #image1: `/tmp/x.png`" },
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
        args: { cmd: "sed -n 1,20p x.ts" },
      },
      {
        type: "message_end",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "Command: sed\nOutput: …" }],
        },
      },
      {
        type: "tool_execution_end",
        toolName: "exec_command",
        args: { cmd: "sed -n 1,20p x.ts" },
        isError: false,
      },
      {
        type: "message_update",
        assistantMessageEvent: { type: "text_end", content: "Here is the corrected approach." },
      },
    );
    expect(parts).toEqual([
      { type: "thinking", text: "Inspecting the runtime engine." },
      tool({ id: "tool_1", name: "Shell", detail: "sed -n 1,20p x.ts", status: "done" }),
      { type: "text", text: "Here is the corrected approach." },
    ]);
  });

  test("settles a Claude tool call by its result, failed or not, keeping its detail", () => {
    const parts = turnOfEvents(
      {
        type: "assistant",
        message: {
          content: [
            { id: "toolu_1", type: "tool_use", name: "Bash", input: { command: "bun test" } },
            { id: "toolu_2", type: "tool_use", name: "Task", input: { description: "Inspect" } },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "failed", is_error: true },
            {
              type: "tool_result",
              tool_use_id: "toolu_2",
              content: [{ type: "text", text: "ok" }],
            },
          ],
        },
      },
    );
    expect(parts).toEqual([
      tool({ id: "toolu_1", name: "Bash", detail: "bun test", status: "failed" }),
      tool({ id: "toolu_2", name: "Task", detail: "Inspect", status: "done" }),
    ]);
  });

  test("an AOP artifact tool's result becomes an artifact card after its call", () => {
    const ref = {
      artifactId: "lib_1",
      version: 1,
      title: "Release plan",
      kind: "markdown",
      action: "created",
    };
    const result = (id: string, text: string, isError = false) => ({
      type: "tool_result",
      tool_use_id: id,
      content: [{ type: "text", text }],
      is_error: isError,
    });
    const marker = `Saved.\n${formatArtifactMarker(ref as ArtifactResultRef)}`;
    const parts = turnOfEvents(
      {
        type: "assistant",
        message: {
          content: [
            { id: "toolu_1", type: "tool_use", name: "mcp__aop__aop_artifact_create", input: {} },
            { id: "toolu_2", type: "tool_use", name: "Bash", input: { command: "cat x" } },
            { id: "toolu_3", type: "tool_use", name: "mcp__aop__aop_artifact_update", input: {} },
          ],
        },
      },
      {
        type: "user",
        message: {
          role: "user",
          content: [
            result("toolu_1", marker),
            // A marker another tool printed is not an artifact the turn made.
            result("toolu_2", marker),
            // Nor is a failed call's.
            result("toolu_3", marker, true),
          ],
        },
      },
      {
        type: "user",
        message: { role: "user", content: [result("toolu_1", marker)] },
      },
    );
    expect(parts).toEqual([
      tool({ id: "toolu_1", name: "mcp aop aop artifact create", detail: null, status: "done" }),
      tool({ id: "toolu_2", name: "Bash", detail: "cat x", status: "done" }),
      tool({ id: "toolu_3", name: "mcp aop aop artifact update", detail: null, status: "failed" }),
      { type: "artifact", toolId: "toolu_1", ...ref } as TurnPart,
    ]);
  });

  test("leaves out the result of a call the turn never showed, and a subagent's own messages", () => {
    const parts = turnOfEvents(
      {
        type: "user",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_x" }] },
      },
      {
        type: "assistant",
        parent_tool_use_id: "toolu_agent",
        message: { content: [{ type: "text", text: "subagent prose" }] },
      },
    );
    expect(parts).toEqual([]);
  });

  test("follows one Claude background agent through its native lifecycle", () => {
    const lifecycle = (subtype: string, extra: Record<string, unknown>) => ({
      type: "system",
      subtype,
      task_id: "agent_1",
      tool_use_id: "toolu_agent",
      ...extra,
    });
    const running = turnOfEvents(
      lifecycle("task_started", { description: "Inspect lifecycle ownership" }),
      lifecycle("task_progress", { description: "Tracing provider registration" }),
    );
    expect(running).toEqual([
      tool({ id: "toolu_agent", name: "Agent", detail: "Tracing provider registration" }),
    ]);
    const done = turnOfEvents(
      lifecycle("task_started", { description: "Inspect lifecycle ownership" }),
      lifecycle("task_notification", { status: "completed", summary: "Ownership traced" }),
    );
    expect(done).toEqual([
      tool({ id: "toolu_agent", name: "Agent", detail: "Ownership traced", status: "done" }),
    ]);
  });

  test("matches a Pi command's end to its start by call id when the end omits its args", () => {
    expect(
      turnOfEvents(
        {
          type: "tool_execution_start",
          toolCallId: "tool_42",
          toolName: "bash",
          args: { command: "git status --short" },
        },
        { type: "tool_execution_end", toolCallId: "tool_42", toolName: "bash", isError: false },
      ),
    ).toEqual([
      tool({ id: "tool_42", name: "Shell", detail: "git status --short", status: "done" }),
    ]);
  });

  test("puts a finished background command back to running when its updates resume", () => {
    const parts = turnOfChunks(
      { kind: "command", phase: "start", command: "poll server", itemId: "call-1" },
      { kind: "command", phase: "done", command: "poll server", itemId: "call-1", exitCode: 0 },
      {
        kind: "command",
        phase: "update",
        command: "poll server",
        itemId: "call-1",
        detail: "attempt 14",
      },
    );
    expect(parts).toEqual([
      tool({ id: "call-1", name: "Shell", detail: "poll server · attempt 14", status: "running" }),
    ]);
  });

  test("a command that exits non-zero failed", () => {
    expect(
      turnOfChunks(
        { kind: "command", phase: "start", command: "false", itemId: "c" },
        { kind: "command", phase: "done", command: "false", itemId: "c", exitCode: 1 },
      ),
    ).toEqual([tool({ id: "c", name: "Shell", detail: "false", status: "failed" })]);
  });

  test("hides blank prose until it says something, and returns copies", () => {
    const acc = createTurnAccumulator();
    expect(acc.applyAll([{ kind: "text", data: "\n\n" }])).toEqual([]);
    const parts = acc.applyAll([{ kind: "text", data: "Hello" }]);
    expect(parts).toEqual([{ type: "text", text: "\n\nHello" }]);
    (parts[0] as { text: string }).text = "changed";
    expect(acc.get()).toEqual([{ type: "text", text: "\n\nHello" }]);
  });

  test("cuts a long tool detail to what the wire holds", () => {
    const [part] = turnOfChunks({
      kind: "tool",
      phase: "start",
      name: "Write",
      itemId: "w",
      detail: "x".repeat(1_000),
    });
    expect(part?.type === "tool" && part.detail?.length).toBe(300);
    expect(part?.type === "tool" && part.detail?.endsWith("…")).toBe(true);
  });
});

describe("createTurnAccumulator with Claude partial messages", () => {
  // Recorded from Claude Code 2.1.286 with --include-partial-messages (ids and signatures blanked):
  // reasoning (empty, as Claude leaves it out), text, a Bash call, then a reply after the result.
  const recorded = readFileSync(
    join(import.meta.dir, "test-fixtures", "claude-partial-messages.jsonl"),
    "utf8",
  )
    .split("\n")
    .filter(Boolean);
  const replyOf = (line: string) =>
    (
      JSON.parse(line) as { message: { content: { type: string; text?: string }[] } }
    ).message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "");

  test("grows the text token by token, and the finished blocks add nothing", () => {
    const acc = createTurnAccumulator();
    const snapshots = recorded.map((line) => acc.applyAll(parseStreamProgressLines(line)));
    const parts = snapshots.at(-1) ?? [];
    const finished = recorded
      .filter((line) => line.includes('"type":"assistant"'))
      .flatMap(replyOf);

    expect(parts.map((part) => part.type)).toEqual(["text", "tool", "text"]);
    expect(parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual(finished);
    expect(parts[1]).toMatchObject({ name: "Bash", detail: "echo hi", status: "done" });
    // Every snapshot of the first paragraph extends the one before: it was typed, not dropped in.
    const first = snapshots.map((snapshot) =>
      snapshot[0]?.type === "text" ? snapshot[0].text : "",
    );
    const growing = first.filter((text, at) => text !== "" && text !== first[at - 1]);
    expect(growing.length).toBeGreaterThan(10);
    growing.forEach((text, at) => {
      if (at > 0) expect(text.startsWith(growing[at - 1] as string)).toBe(true);
    });
  });

  const event = (inner: Record<string, unknown>) => ({ type: "stream_event", event: inner });
  const start = (index: number, block: Record<string, unknown>) =>
    event({ type: "content_block_start", index, content_block: block });
  const delta = (index: number, value: Record<string, unknown>) =>
    event({ type: "content_block_delta", index, delta: value });
  const stop = (index: number) => event({ type: "content_block_stop", index });
  const finished = (block: Record<string, unknown>) => ({
    type: "assistant",
    message: { id: "msg_1", content: [block] },
  });

  test("streams reasoning as it is written, and its finished block settles it", () => {
    const acc = createTurnAccumulator();
    const apply = (...events: Record<string, unknown>[]) =>
      acc.applyAll(events.flatMap((e) => parseStreamProgressLines(JSON.stringify(e))));

    apply(
      event({ type: "message_start", message: { id: "msg_1" } }),
      start(0, { type: "thinking" }),
    );
    expect(apply(delta(0, { type: "thinking_delta", thinking: "The retry " }))).toEqual([
      { type: "thinking", text: "The retry " },
    ]);
    apply(delta(0, { type: "thinking_delta", thinking: "fires twice." }));
    expect(
      apply(finished({ type: "thinking", thinking: "The retry fires twice." }), stop(0)),
    ).toEqual([{ type: "thinking", text: "The retry fires twice." }]);
  });

  test("a tool call shows as soon as it starts, running, and its finished block adds its detail", () => {
    const acc = createTurnAccumulator();
    const apply = (...events: Record<string, unknown>[]) =>
      acc.applyAll(events.flatMap((e) => parseStreamProgressLines(JSON.stringify(e))));

    expect(apply(start(0, { type: "tool_use", id: "toolu_1", name: "Bash" }))).toEqual([
      tool({ id: "toolu_1", name: "Bash" }),
    ]);
    expect(
      apply(
        delta(0, { type: "input_json_delta", partial_json: '{"command":"ls"}' }),
        finished({ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }),
        stop(0),
      ),
    ).toEqual([tool({ id: "toolu_1", name: "Bash", detail: "ls" })]);
  });

  test("empty reasoning that closes unsettled does not take the next message's reasoning", () => {
    const acc = createTurnAccumulator();
    const apply = (...events: Record<string, unknown>[]) =>
      acc.applyAll(events.flatMap((e) => parseStreamProgressLines(JSON.stringify(e))));

    apply(start(0, { type: "thinking" }), stop(0));
    apply(start(1, { type: "text" }), delta(1, { type: "text_delta", text: "Hi." }));
    apply(finished({ type: "text", text: "Hi." }), stop(1));
    apply(
      event({ type: "message_start", message: { id: "msg_2" } }),
      start(0, { type: "thinking" }),
    );
    apply(delta(0, { type: "thinking_delta", thinking: "Next." }));
    expect(apply(finished({ type: "thinking", thinking: "Next." }), stop(0))).toEqual([
      { type: "text", text: "Hi." },
      { type: "thinking", text: "Next." },
    ]);
  });

  test("the closing result does not repeat the answer the turn already wrote", () => {
    const acc = createTurnAccumulator();
    const apply = (...events: Record<string, unknown>[]) =>
      acc.applyAll(events.flatMap((e) => parseStreamProgressLines(JSON.stringify(e))));

    apply(start(0, { type: "text" }), delta(0, { type: "text_delta", text: "Done." }));
    expect(apply(stop(0), { type: "result", subtype: "success", result: "Done." })).toEqual([
      { type: "text", text: "Done." },
    ]);
  });
});

describe("messages a turn took in while it worked", () => {
  const replay = (uuid: string) => ({
    type: "user",
    isReplay: true,
    uuid,
    message: { role: "user", content: [{ type: "text", text: "a message" }] },
  });
  const said = (text: string) => ({
    type: "assistant",
    message: { content: [{ type: "text", text }] },
  });

  test("are steer parts where Claude echoed them, and the turn's own prompt is not", () => {
    const prompt = generateTypeId("smsg");
    const steer = generateTypeId("smsg");
    const events = [
      replay(typeIdToUuid(prompt) ?? ""),
      said("Building for x86"),
      replay(typeIdToUuid(steer) ?? ""),
      said("Switched to arm64"),
    ];

    const parts = createTurnAccumulator({ promptUuid: typeIdToUuid(prompt) ?? "" }).applyAll(
      events.flatMap((event) => parseStreamProgressLines(JSON.stringify(event))),
    );

    expect(parts).toEqual([
      { type: "text", text: "Building for x86" },
      { type: "steer", messageId: steer },
      { type: "text", text: "Switched to arm64" },
    ]);
  });

  test("an echo that names no message of ours, or one already shown, adds nothing", () => {
    const steer = typeIdToUuid(generateTypeId("smsg")) ?? "";
    expect(turnOfEvents(replay("not-a-uuid"), replay(steer), replay(steer))).toHaveLength(1);
  });
});
