import { describe, expect, test } from "bun:test";
import {
  extractAssistantSignalTextFromRawJsonl,
  extractFinalAssistantTextFromRawJsonl,
  extractLastGrokTextRunFromRawJsonl,
  extractPlanMarkdownFromRawJsonl,
  inferRunOutcomeFromRawJsonl,
  parseRawJsonlContent,
  renderCompactLogLines,
} from "./index";

describe("logs parser", () => {
  test("parses multiline json and ignores non-json lines", () => {
    const content = [
      "not-json",
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}]}}',
      "{",
      '  "type": "result",',
      '  "subtype": "success",',
      '  "result": "done"',
      "}",
    ].join("\n");

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.ignoredLineCount).toBe(1);
    expect(parsed.hasTrailingPartial).toBe(false);
  });

  test("flags trailing partial json entry", () => {
    const parsed = parseRawJsonlContent('{"type":"assistant"\n');
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.hasTrailingPartial).toBe(true);
  });

  test("detects codex json events", () => {
    const content = JSON.stringify({
      type: "turn.completed",
      "turn-id": "turn_123",
      "last-assistant-message": "done",
    });

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.provider).toBe("codex");
  });

  test("detects synthetic openclaw json events", () => {
    const content = JSON.stringify({
      provider: "openclaw",
      type: "result",
      subtype: "success",
      result: "done",
    });

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.provider).toBe("openclaw");
  });

  test("detects Pi runtime json events", () => {
    const content = JSON.stringify({
      provider: "pi",
      type: "result",
      subtype: "success",
      result: "done",
    });

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.provider).toBe("pi");
  });

  test("detects provider-less Pi runtime events", () => {
    const content = JSON.stringify({
      type: "tool_execution_start",
      toolName: "read",
      args: { path: "apps/dashboard/src/App.tsx" },
    });

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.provider).toBe("pi");
  });

  test("detects provider-less Grok streaming token events", () => {
    const content = JSON.stringify({ type: "text", data: "Finished" });

    const parsed = parseRawJsonlContent(content);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.provider).toBe("grok-build");
  });
});

describe("logs renderer", () => {
  test("renders compact tool lines from real task workflow logs", () => {
    const content = [
      JSON.stringify({
        type: "tool_use",
        part: {
          tool: "bash",
          state: {
            input: {
              command: "cat docs/tasks/cli-greeting-command/task.md",
              description: "Read task document",
            },
          },
        },
      }),
      JSON.stringify({
        type: "tool_use",
        part: {
          tool: "bash",
          state: {
            input: {
              command: "ls docs/tasks/cli-greeting-command",
              description: "List task folder files",
            },
          },
        },
      }),
    ].join("\n");
    const parsed = parseRawJsonlContent(content);
    const lines = renderCompactLogLines(parsed, { timestamp: "2026-01-01T00:00:00.000Z" });
    expect(lines.map((line) => line.content)).toEqual([
      "[Bash] cat docs/tasks/cli-greeting-command/task.md - Read task document",
      "[Bash] ls docs/tasks/cli-greeting-command - List task folder files",
    ]);
  });

  test("suppresses token/cost noise from assistant text", () => {
    const content = JSON.stringify({
      type: "text",
      part: { text: "Working\nTokens: 210\nCost: 0.01\nDone" },
    });
    const lines = renderCompactLogLines(parseRawJsonlContent(content), {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual(["Working", "Done"]);
  });

  test("renders provider-less Pi tool execution and assistant message events", () => {
    const content = [
      JSON.stringify({
        type: "tool_execution_start",
        toolName: "read",
        args: { path: "apps/dashboard/src/App.tsx" },
      }),
      JSON.stringify({
        type: "tool_execution_end",
        toolName: "read",
        result: { isError: false },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "Updated the dashboard nav" },
          ],
        },
      }),
    ].join("\n");

    const lines = renderCompactLogLines(parseRawJsonlContent(content), {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines).toEqual([
      {
        stream: "stdout",
        content: "[Read] apps/dashboard/src/App.tsx",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        stream: "stdout",
        content: "[Read] completed",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      {
        stream: "stdout",
        content: "Updated the dashboard nav",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("renders Grok streaming text chunks instead of an empty log view", () => {
    const content = [
      JSON.stringify({ type: "thought", data: "private reasoning" }),
      JSON.stringify({ type: "text", data: "Running" }),
      JSON.stringify({ type: "text", data: " checks" }),
    ].join("\n");

    const lines = renderCompactLogLines(parseRawJsonlContent(content), {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual(["Running checks"]);
    expect(lines.map((line) => line.content)).not.toContain("private reasoning");
  });
});

describe("logs extraction and inference", () => {
  test("extracts signal text from opencode text events", () => {
    const content = JSON.stringify({
      type: "text",
      part: { text: "Finished <aop>ALL_TASKS_DONE</aop>" },
    });

    const extracted = extractAssistantSignalTextFromRawJsonl(content, {
      requireCompleteLine: true,
    });
    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toContain("<aop>ALL_TASKS_DONE</aop>");
  });

  test("extracts signal text from Pi final assistant events", () => {
    const content = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private reasoning" },
            { type: "text", text: "<aop>ALL_TASKS_DONE</aop>" },
          ],
        },
      }),
      JSON.stringify({
        type: "agent_end",
        messages: [
          { role: "user", content: [{ type: "text", text: "do it" }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "<aop>ALL_TASKS_DONE</aop>" },
            ],
          },
        ],
      }),
    ].join("\n");

    const extracted = extractAssistantSignalTextFromRawJsonl(content, {
      requireCompleteLine: true,
    });
    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toContain("<aop>ALL_TASKS_DONE</aop>");
    expect(extracted.text).not.toContain("private reasoning");
  });

  test("extracts workflow signals from Grok streaming text chunks", () => {
    const content = [
      JSON.stringify({ type: "thought", data: "I should report the result" }),
      JSON.stringify({ type: "text", data: "All checks passed. " }),
      JSON.stringify({ type: "text", data: "<aop>" }),
      JSON.stringify({ type: "text", data: "TESTS_PASS" }),
      JSON.stringify({ type: "text", data: "</aop>" }),
      JSON.stringify({ type: "end" }),
    ].join("\n");

    const extracted = extractAssistantSignalTextFromRawJsonl(content, {
      requireCompleteLine: true,
    });

    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toContain("<aop>TESTS_PASS</aop>");
    expect(extracted.text).not.toContain("I should report");
  });

  test("last Grok text run drops intermediate status narration", () => {
    const content = [
      JSON.stringify({ type: "thought", data: "planning" }),
      JSON.stringify({ type: "text", data: "I'll inspect the layout first." }),
      JSON.stringify({ type: "thought", data: "now write the answer" }),
      JSON.stringify({ type: "text", data: "### After\n\nUse **plus** on the folder." }),
      JSON.stringify({ type: "end" }),
    ].join("\n");

    const extracted = extractLastGrokTextRunFromRawJsonl(content, {
      requireCompleteLine: true,
    });

    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toBe("### After\n\nUse **plus** on the folder.");
    expect(extracted.text).not.toContain("I'll inspect");
  });

  test("final-message extraction keeps only the last opencode text message", () => {
    const content = [
      JSON.stringify({ type: "text", part: { text: "I'll inspect the dashboard shell first." } }),
      JSON.stringify({ type: "text", part: { text: "The sidebar is a single component." } }),
      JSON.stringify({
        type: "text",
        part: { text: "**Recommended Plan**\n\n1. Add helpers.\n2. Update shell." },
      }),
    ].join("\n");

    const extracted = extractFinalAssistantTextFromRawJsonl(content);
    expect(extracted.isComplete).toBe(true);
    expect(extracted.text).toBe("**Recommended Plan**\n\n1. Add helpers.\n2. Update shell.");
    expect(extracted.text).not.toContain("I'll inspect");
    expect(extracted.text).not.toContain("single component");
  });

  test("renders AOP CLI prompt capture events", () => {
    const content = JSON.stringify({
      type: "aop_cli_prompt",
      provider: "opencode",
      prompt: "Let's make a plan for the task below\n\nCreate a sidebar button",
    });

    const lines = renderCompactLogLines(parseRawJsonlContent(content), {
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(lines.map((line) => line.content)).toEqual([
      "[AOP -> CLI prompt]",
      "Let's make a plan for the task below",
      "Create a sidebar button",
    ]);
  });

  test("final-message extraction reads codex turn.completed last-assistant-message", () => {
    const content = [
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "Exploring." },
      }),
      JSON.stringify({
        type: "turn.completed",
        "turn-id": "turn_1",
        "last-assistant-message": "## Plan\n\nImplement the feature.",
      }),
    ].join("\n");

    const extracted = extractFinalAssistantTextFromRawJsonl(content);
    expect(extracted.text).toBe("## Plan\n\nImplement the feature.");
    expect(extracted.text).not.toContain("Exploring");
  });

  test("final-message extraction reads claude-code result over earlier narration", () => {
    const content = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "Let me look around the repo." }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "## Plan\n\nDo the work." }),
    ].join("\n");

    const extracted = extractFinalAssistantTextFromRawJsonl(content);
    expect(extracted.text).toBe("## Plan\n\nDo the work.");
    expect(extracted.text).not.toContain("look around");
  });

  test("final-message extraction reads the final Pi message and drops thinking", () => {
    const content = [
      JSON.stringify({
        provider: "pi",
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "Scanning files." }] },
      }),
      JSON.stringify({
        provider: "pi",
        type: "agent_end",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "private reasoning" },
              { type: "text", text: "## Plan\n\nShip it." },
            ],
          },
        ],
      }),
    ].join("\n");

    const extracted = extractFinalAssistantTextFromRawJsonl(content);
    expect(extracted.text).toBe("## Plan\n\nShip it.");
    expect(extracted.text).not.toContain("Scanning files");
    expect(extracted.text).not.toContain("private reasoning");
  });

  test("final-message extraction blocks on a trailing partial line", () => {
    const extracted = extractFinalAssistantTextFromRawJsonl(
      '{"type":"text","part":{"text":"## Plan"}}\n{"type":"text","part":',
      { requireCompleteLine: true },
    );

    expect(extracted.isComplete).toBe(false);
    expect(extracted.text).toBe("");
  });

  test("plan extraction prefers the ExitPlanMode artifact over the claude hand-off message", () => {
    const plan = `## Plan\n\n${"1. Implement the fix in the dashboard merge logic.\n".repeat(12)}`;
    const handOff = "The plan is written and ready for your review.";
    const content = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "ExitPlanMode", input: { plan } }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: handOff }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: handOff }),
    ].join("\n");

    const extracted = extractPlanMarkdownFromRawJsonl(content);
    expect(extracted.source).toBe("plan-artifact");
    expect(extracted.text).toBe(plan.trim());
  });

  test("plan extraction prefers a longer plans-directory Write over a condensed ExitPlanMode", () => {
    const fullPlan = `# Plan\n\n${"- Detailed step with file references.\n".repeat(20)}`;
    const condensed = "# Plan\n\n- Short summary of the steps.";
    const content = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/home/user/.claude/plans/lucky-quokka.md", content: fullPlan },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", name: "ExitPlanMode", input: { plan: condensed } }],
        },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: "Plan submitted." }),
    ].join("\n");

    const extracted = extractPlanMarkdownFromRawJsonl(content);
    expect(extracted.source).toBe("plan-artifact");
    expect(extracted.text).toBe(fullPlan.trim());
  });

  test("plan extraction ignores ordinary repo Writes when picking artifacts", () => {
    const plan = `## Plan\n\n${"1. Apply the change and verify with tests.\n".repeat(12)}`;
    const content = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Write",
              input: { file_path: "/repo/src/feature.ts", content: "export const x = 1;" },
            },
          ],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: plan }] },
      }),
      JSON.stringify({ type: "result", subtype: "success", result: plan }),
    ].join("\n");

    const extracted = extractPlanMarkdownFromRawJsonl(content);
    expect(extracted.source).toBe("final-message");
    expect(extracted.text).toBe(plan.trim());
  });

  test("plan extraction keeps the final opencode message as the plan", () => {
    const plan = `**Recommended Plan**\n\n${"1. Add helpers and update the shell with tests.\n".repeat(10)}`;
    const content = [
      JSON.stringify({ type: "text", part: { text: "Inspecting the dashboard first." } }),
      JSON.stringify({ type: "text", part: { text: plan } }),
    ].join("\n");

    const extracted = extractPlanMarkdownFromRawJsonl(content);
    expect(extracted.source).toBe("final-message");
    expect(extracted.text).toBe(plan.trim());
  });

  test("plan extraction salvages a mid-turn plan when the final message is a short hand-off", () => {
    const plan = `# Plan\n\n${"- Verified root cause and the fix for the flip.\n".repeat(12)}`;
    const content = [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: plan }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "The markdown document above is the final deliverable.",
      }),
    ].join("\n");

    const extracted = extractPlanMarkdownFromRawJsonl(content);
    expect(extracted.source).toBe("longest-message");
    expect(extracted.text).toBe(plan.trim());
  });

  test("plan extraction blocks on a trailing partial line", () => {
    const extracted = extractPlanMarkdownFromRawJsonl(
      '{"type":"text","part":{"text":"## Plan"}}\n{"type":"text","part":',
      { requireCompleteLine: true },
    );

    expect(extracted.isComplete).toBe(false);
    expect(extracted.text).toBe("");
  });

  test("blocks signal extraction when trailing line is partial", () => {
    const extracted = extractAssistantSignalTextFromRawJsonl(
      '{"type":"text","part":{"text":"<aop>ALL_TASKS_DONE</aop>"',
      { requireCompleteLine: true },
    );

    expect(extracted.isComplete).toBe(false);
    expect(extracted.text).toBe("");
  });

  test("infers explicit success/failure outcomes", () => {
    const success = inferRunOutcomeFromRawJsonl(
      JSON.stringify({ type: "result", subtype: "success", result: "ok" }),
    );
    const failure = inferRunOutcomeFromRawJsonl(
      JSON.stringify({ type: "result", subtype: "error", result: "bad" }),
    );

    expect(success.outcome).toBe("success");
    expect(failure.outcome).toBe("failure");
  });

  test("infers implicit success for parsable stream without result", () => {
    const content = [
      JSON.stringify({
        type: "tool_use",
        part: { tool: "bash", state: { input: { command: "ls" } } },
      }),
      JSON.stringify({ type: "text", part: { text: "done" } }),
    ].join("\n");

    const inferred = inferRunOutcomeFromRawJsonl(content);
    expect(inferred.outcome).toBe("success");
    expect(inferred.reason).toBe("implicit-success-stream");
  });

  test("infers failure from explicit error marker", () => {
    const content = JSON.stringify({ type: "event", level: "error", error: "boom" });
    const inferred = inferRunOutcomeFromRawJsonl(content);
    expect(inferred.outcome).toBe("failure");
  });

  test("returns unknown when trailing partial line exists", () => {
    const content = [
      JSON.stringify({ type: "text", part: { text: "ok" } }),
      '{"type":"text","part":',
    ].join("\n");

    const inferred = inferRunOutcomeFromRawJsonl(content, { requireCompleteLine: true });
    expect(inferred.outcome).toBe("unknown");
    expect(inferred.reason).toBe("trailing-partial-json-line");
  });
});
