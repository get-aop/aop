import { describe, expect, test } from "bun:test";
import { StepAgentSchema } from "./types.ts";

describe("workflow-engine StepAgentSchema", () => {
  test("accepts claude-code provider", () => {
    const parsed = StepAgentSchema.safeParse({
      provider: "claude-code",
      model: "claude-opus-4-7",
      reasoning: "medium",
    });

    expect(parsed.success).toBe(true);
  });
});
