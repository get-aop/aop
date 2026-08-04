import { describe, expect, test } from "bun:test";
import { buildConversationContext } from "./conversation-context.ts";

describe("buildConversationContext", () => {
  test("keeps failed user requests and only completed assistant answers", () => {
    const context = buildConversationContext([
      { role: "user", content: "Implement the second task", outcome: "failed" },
      { role: "assistant", content: "Timeout boilerplate", outcome: "failed" },
      { role: "user", content: "Create a PR after it is done", outcome: "interrupted" },
      { role: "assistant", content: "I changed src/runtime.ts", outcome: "interrupted" },
      { role: "assistant", content: "Finished the work", outcome: "completed" },
    ]);

    expect(context).toContain("[user]\nImplement the second task");
    expect(context).not.toContain("Timeout boilerplate");
    expect(context).toContain("[assistant interrupted partial]\nI changed src/runtime.ts");
    expect(context).toContain("[assistant completed]\nFinished the work");
  });

  test("selects newest whole messages within deterministic limits", () => {
    const context = buildConversationContext(
      Array.from({ length: 14 }, (_, index) => ({
        role: "user" as const,
        content: `message-${index}`,
        outcome: "completed" as const,
      })),
      { maxMessages: 12, maxCharacters: 12_000 },
    );

    expect(context).not.toContain("message-0\n");
    expect(context).not.toContain("message-1\n");
    expect(context.indexOf("message-2")).toBeLessThan(context.indexOf("message-13"));
  });

  test("keeps the tail of an oversized user task with an explicit truncation marker", () => {
    const taskTail = "Preserve branch feat/runtime-continuity and PR #204";
    const context = buildConversationContext(
      [{ role: "user", content: `${"origin ".repeat(40)}${taskTail}`, outcome: "failed" }],
      { maxMessages: 12, maxCharacters: 120 },
    );

    expect(context).toContain("[user truncated; tail preserved]");
    expect(context).toContain(taskTail);
    expect(context.length).toBeLessThanOrEqual(120);
  });
});
