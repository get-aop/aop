import { describe, expect, test } from "bun:test";
import { missingTerminalKind, projectRunLogLine } from "./projector.ts";

// Claude Code `--output-format stream-json` records, as a chat run's log holds them.
const claudeRunLog = [
  { type: "system", subtype: "init", session_id: "sess-1", model: "claude-opus" },
  {
    type: "assistant",
    session_id: "sess-1",
    message: { role: "assistant", content: [{ type: "text", text: "Working on step 1." }] },
  },
  { type: "tool_use", session_id: "sess-1", name: "Bash", input: { command: "echo 1" } },
  { type: "result", subtype: "success", result: "All done.", session_id: "sess-1" },
].map((record) => JSON.stringify(record));

describe("projectRunLogLine", () => {
  test("projects a Claude Code chat run log into canonical events", () => {
    const events = claudeRunLog.flatMap((line) => projectRunLogLine(line, null));

    expect(events.map((event) => event.kind)).toEqual([
      "session_started",
      "assistant_text",
      "tool_started",
      "session_completed",
    ]);
    expect(events[0]).toMatchObject({
      title: "Claude Code session started",
      sessionId: "sess-1",
      metadata: { provider: "claude-code" },
    });
    expect(events[1]?.message).toBe("Working on step 1.");
    expect(events[2]).toMatchObject({ toolName: "Bash", status: "started" });
    expect(events[3]).toMatchObject({ status: "success", message: "All done." });
  });

  test("falls back to the run's known session id when a record has none", () => {
    const line = JSON.stringify({ type: "tool_result", tool_name: "Read", content: "ok" });

    const [event] = projectRunLogLine(line, "sess-known");

    expect(event).toMatchObject({
      kind: "tool_completed",
      title: "Read completed",
      sessionId: "sess-known",
    });
  });

  test("orders events within a line and keeps the line's timestamp", () => {
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-09-29T10:00:00.000Z",
      session_id: "sess-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Reading two files." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } },
        ],
      },
    });

    const events = projectRunLogLine(line, null);

    expect(events.map((event) => event.sourceIndex)).toEqual(events.map((_, index) => index));
    expect(events.every((event) => event.occurredAt === "2026-09-29T10:00:00.000Z")).toBe(true);
  });

  test("flags a record that asks for the user's attention", () => {
    const line = JSON.stringify({ type: "requires_input", question: "Which branch?" });

    const [event] = projectRunLogLine(line, "sess-1");

    expect(event).toMatchObject({ kind: "worker_attention", message: "Which branch?" });
  });

  test("ignores lines that are not JSON", () => {
    expect(projectRunLogLine("not json at all", null)).toEqual([]);
  });
});

describe("missingTerminalKind", () => {
  test("synthesizes the terminal event from the run outcome when the log has none", () => {
    expect(missingTerminalKind("success", [{ kind: "assistant_text" }])).toBe("session_completed");
    expect(missingTerminalKind("failure", [])).toBe("session_failed");
    expect(missingTerminalKind("cancelled", [])).toBe("session_interrupted");
  });

  test("returns null when the log already ended the session or the run is still going", () => {
    expect(missingTerminalKind("success", [{ kind: "session_completed" }])).toBeNull();
    expect(missingTerminalKind(null, [])).toBeNull();
  });
});
