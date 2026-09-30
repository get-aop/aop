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
      usage: { input: 10, output: 5, cacheWrite: 200, cacheRead: 4000 },
      echoSystemPrompt: false,
      usageWarning: false,
    });
  });

  test("a bare `usagewarn` asks for the warning event a real run writes", () => {
    expect(parseDirectives("hi [fake: usagewarn]").usageWarning).toBe(true);
    expect(parseDirectives("hi [fake: steps=1]").usageWarning).toBe(false);
  });

  test("a bare `system` asks the reply to echo the appended system prompt", () => {
    expect(parseDirectives("hi [fake: system]").echoSystemPrompt).toBe(true);
    expect(parseDirectives("hi", "system steps=1").echoSystemPrompt).toBe(true);
  });

  test("reads the files to write: path, equals sign, content, entries split by a bar", () => {
    expect(
      parseDirectives('x [fake: write="a.txt=one|dir/b.txt=two=2|broken|=empty"]').writes,
    ).toEqual([
      { path: "a.txt", content: "one" },
      { path: "dir/b.txt", content: "two=2" },
    ]);
    expect(parseDirectives("hello").writes).toBeUndefined();
  });

  test("reads the four token counts in order; omitted or non-numeric ones are 0", () => {
    expect(parseDirectives("[fake: usage=1200,340,5000,61000]").usage).toEqual({
      input: 1200,
      output: 340,
      cacheWrite: 5000,
      cacheRead: 61_000,
    });
    expect(parseDirectives("[fake: usage=700,x]").usage).toEqual({
      input: 700,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
    });
    expect(parseDirectives("[fake: usage]").usage.input).toBe(10);
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
    const directives = parseDirectives("[fake: crash fail ratelimit]");

    expect(directives.crashAfter).toBe(2);
    expect(directives.failMessage).toBe("fake CLI failure");
    expect(directives.rateLimitSeconds).toBe(3600);
  });

  test("ratelimit takes the seconds until the limit resets, and is off without the key", () => {
    expect(parseDirectives("[fake: ratelimit=90]").rateLimitSeconds).toBe(90);
    expect(parseDirectives("[fake: ratelimit=0]").rateLimitSeconds).toBe(0);
    expect(parseDirectives("[fake: steps=1]").rateLimitSeconds).toBeUndefined();
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

  test("values may be single quoted, and a quoted value may hold ]", () => {
    const directives = parseDirectives(
      "x [fake: say='it\"s [done]' ask=\"Pick [a]?\" options='a|b']",
    );

    expect(directives.say).toBe('it"s [done]');
    expect(directives.ask).toEqual({
      question: "Pick [a]?",
      options: ["a", "b"],
      tool: "aop_ask_user",
    });
  });

  test("a quote with no partner is plain text", () => {
    expect(parseDirectives("x [fake: say=don't steps=2]")).toMatchObject({
      say: "don't",
      steps: 2,
    });
  });

  test("an unterminated marker is not a marker", () => {
    expect(parseDirectives("x [fake: steps=2 and no end", "steps=1").steps).toBe(1);
  });
});

describe("calls directive", () => {
  const calls = [
    { name: "thread_spawn", arguments: { title: "Fix login", repoIds: ["a", "b"] } },
    { name: "thread_list" },
  ];

  test("reads a JSON array of MCP calls, defaulting missing arguments to {}", () => {
    const directives = parseDirectives(`x [fake: calls='${JSON.stringify(calls)}']`);

    expect(directives.callsError).toBeUndefined();
    expect(directives.calls).toEqual([
      { name: "thread_spawn", arguments: { title: "Fix login", repoIds: ["a", "b"] } },
      { name: "thread_list", arguments: {} },
    ]);
  });

  test("keeps the rest of the marker around the JSON", () => {
    const directives = parseDirectives(`x [fake: steps=1 calls='[{"name":"t"}]' say="ok"]`);

    expect(directives).toMatchObject({
      steps: 1,
      say: "ok",
      calls: [{ name: "t", arguments: {} }],
    });
  });

  test.each([
    ["malformed JSON", "[{"],
    ["not an array", '{"name":"t"}'],
    ["an entry without a name", '[{"arguments":{}}]'],
    ["an empty name", '[{"name":""}]'],
    ["arguments that are not an object", '[{"name":"t","arguments":[1]}]'],
    ["an entry that is not an object", '["t"]'],
  ])("%s is reported, not guessed at", (_label, raw) => {
    const directives = parseDirectives(`x [fake: calls='${raw}']`);

    expect(directives.calls).toBeUndefined();
    expect(directives.callsError).toBe("fake CLI: invalid calls directive");
  });

  test("is absent when the marker does not ask for calls", () => {
    const directives = parseDirectives("x [fake: steps=1]");

    expect(directives).not.toHaveProperty("calls");
    expect(directives).not.toHaveProperty("callsError");
  });
});

describe("stripDirectives", () => {
  test("removes every marker and trims", () => {
    expect(stripDirectives("  hello [fake: steps=2] world [fake: crash]  ")).toBe("hello  world");
  });

  test("removes a marker whose quoted value holds ]", () => {
    const prompt = `do it [fake: calls='[{"name":"t"}]' say="a]b"] please`;

    expect(stripDirectives(prompt)).toBe("do it  please");
  });

  test("leaves an unterminated marker in place", () => {
    expect(stripDirectives("hello [fake: steps=2")).toBe("hello [fake: steps=2");
  });
});
