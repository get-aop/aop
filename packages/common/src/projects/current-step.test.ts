import { describe, expect, test } from "bun:test";
import type { TurnPart } from "./blocks.ts";
import { currentStepOf, describeStep, formatElapsed } from "./current-step.ts";

const tool = (id: string, status: "running" | "done", detail: string | null = null): TurnPart => ({
  type: "tool",
  id,
  name: "Bash",
  detail,
  status,
});

describe("currentStepOf", () => {
  test("is the first call still running, with how many more run beside it", () => {
    const parts: TurnPart[] = [
      tool("a", "done", "ls"),
      { type: "text", text: "Running the suite." },
      tool("b", "running", "bun test"),
      tool("c", "running", "bun run lint"),
    ];
    expect(currentStepOf(parts)).toEqual({ tool: parts[2] as never, others: 1 });
  });

  test("is null while the model writes and no call runs", () => {
    expect(currentStepOf([tool("a", "done"), { type: "thinking", text: "Next…" }])).toBeNull();
  });
});

describe("describeStep", () => {
  test("names the tool and what it was asked, on one line", () => {
    const step = { tool: tool("a", "running", "bun   test\n apps") as never, others: 0 };
    expect(describeStep(step)).toBe("Bash `bun test apps`");
  });

  test("shortens a long detail and counts the calls alongside", () => {
    const step = { tool: tool("a", "running", "x".repeat(100)) as never, others: 2 };
    expect(describeStep(step)).toBe(`Bash \`${"x".repeat(59)}…\` and 2 more`);
  });

  test("is the tool's name alone when it has no detail", () => {
    expect(describeStep({ tool: tool("a", "running") as never, others: 0 })).toBe("Bash");
  });
});

describe("formatElapsed", () => {
  const since = "2026-10-03T10:00:00.000Z";
  const at = (seconds: number) => Date.parse(since) + seconds * 1000;

  test("reads in seconds, then minutes, then hours", () => {
    expect(formatElapsed(since, at(12))).toBe("12s");
    expect(formatElapsed(since, at(192))).toBe("3m 12s");
    expect(formatElapsed(since, at(3720))).toBe("1h 02m");
  });

  test("is empty for a time it cannot read, and never negative", () => {
    expect(formatElapsed("not a time", at(5))).toBe("");
    expect(formatElapsed(since, at(-5))).toBe("0s");
  });
});
