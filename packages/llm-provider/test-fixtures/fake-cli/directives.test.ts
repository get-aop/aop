import { describe, expect, test } from "bun:test";
import { parseDirectives, stripDirectives } from "./directives";

describe("parseDirectives", () => {
  test("defaults to a plain, instant, successful turn", () => {
    expect(parseDirectives("hello")).toEqual({
      startupMs: 0,
      delayMs: 0,
      steps: 0,
      say: undefined,
      ask: undefined,
      failMessage: undefined,
      exitCode: undefined,
      crashAfter: undefined,
    });
  });

  test("reads timing, steps and the reply from a marker", () => {
    const directives = parseDirectives('hi [fake: startup=5 delay=250 steps=3 say="all done"]');

    expect(directives).toMatchObject({ startupMs: 5, delayMs: 250, steps: 3, say: "all done" });
  });

  test("reads a question with options and an optional tool name", () => {
    const asked = parseDirectives('[fake: ask="Which db?" options="pg|sqlite"]');
    const native = parseDirectives("[fake: ask=Sure? tool=AskUserQuestion]");

    expect(asked.ask).toEqual({
      question: "Which db?",
      options: ["pg", "sqlite"],
      tool: "aop_ask_user",
    });
    expect(native.ask).toEqual({ question: "Sure?", options: [], tool: "AskUserQuestion" });
  });

  test("bare flags take their documented defaults", () => {
    const directives = parseDirectives("[fake: crash fail]");

    expect(directives.crashAfter).toBe(2);
    expect(directives.failMessage).toBe("fake CLI failure");
  });

  test("keeps explicit values, including zero", () => {
    const directives = parseDirectives('[fake: crash=0 fail="boom" exit=7]');

    expect(directives).toMatchObject({ crashAfter: 0, failMessage: "boom", exitCode: 7 });
  });

  test("ignores non-numeric values instead of failing the turn", () => {
    const directives = parseDirectives("[fake: delay=soon steps=many exit=later]");

    expect(directives).toMatchObject({ delayMs: 0, steps: 0, exitCode: undefined });
  });

  test("the last marker wins so replayed history cannot override the newest message", () => {
    const prompt = "first [fake: steps=5]\nsecond [fake: steps=1]";

    expect(parseDirectives(prompt).steps).toBe(1);
  });

  test("falls back to the environment script, and a marker overrides it", () => {
    expect(parseDirectives("hello", "steps=2 delay=10")).toMatchObject({ steps: 2, delayMs: 10 });
    expect(parseDirectives("hello [fake: steps=0]", "steps=2").steps).toBe(0);
  });
});

describe("stripDirectives", () => {
  test("removes every marker and trims", () => {
    expect(stripDirectives("  hello [fake: steps=2] world [fake: crash]  ")).toBe("hello  world");
  });
});
