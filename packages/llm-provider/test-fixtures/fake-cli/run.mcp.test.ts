import { afterEach, describe, expect, test } from "bun:test";
import { ClaudeCodeProvider } from "../../src/providers/claude-code";
import { play, removeHomes, stubMcp, types } from "./test-utils";

afterEach(removeHomes);

const AOP_URL = "http://127.0.0.1:25150/api/mcp?sessionId=isess_1&accessToken=tok";

/** The argv the real adapter builds for a run that has the AOP MCP server. */
const withAop = (prompt: string, isolation: "hermetic" | "open" = "hermetic"): string[] =>
  new ClaudeCodeProvider()
    .buildCommand({ prompt, isolation, mcpServerUrl: AOP_URL, model: "m", reasoningEffort: "low" })
    .slice(1);

const withoutAop = (prompt: string): string[] =>
  new ClaudeCodeProvider().buildCommand({ prompt, model: "m", reasoningEffort: "low" }).slice(1);

const block = (event: Record<string, unknown> | undefined): Record<string, unknown> => {
  const message = event?.message as { content: Array<Record<string, unknown>> } | undefined;
  return message?.content[0] ?? {};
};

const CALLS = `calls='[{"name":"thread_spawn","arguments":{"title":"Fix login","repoId":"repo_1"}},{"name":"thread_list"}]'`;

describe("MCP calls through the fake", () => {
  test.each(["hermetic", "open"] as const)(
    "makes each scripted call against the aop server the %s adapter configured, in order",
    async (isolation) => {
      const mcp = stubMcp('{"threadId":"t1"}');

      const run = await play(withAop(`go [fake: ${CALLS}]`, isolation), {}, undefined, mcp.connect);

      expect(run.exitCode).toBe(0);
      expect(mcp.urls).toEqual([AOP_URL]);
      expect(mcp.calls).toEqual([
        { name: "thread_spawn", args: { title: "Fix login", repoId: "repo_1" } },
        { name: "thread_list", args: {} },
      ]);
      expect(types(run.events)).toEqual([
        "system",
        "assistant",
        "user",
        "assistant",
        "user",
        "assistant",
        "result",
      ]);
      expect(block(run.events[1])).toMatchObject({
        type: "tool_use",
        name: "mcp__aop__thread_spawn",
        input: { title: "Fix login", repoId: "repo_1" },
      });
      expect(block(run.events[2])).toMatchObject({
        type: "tool_result",
        content: '{"threadId":"t1"}',
        is_error: false,
      });
    },
  );

  test("a tool error reaches the model as an error result and the turn still ends normally", async () => {
    const mcp = stubMcp("Repository is not part of this project", true);

    const run = await play(withAop(`go [fake: ${CALLS}]`), {}, undefined, mcp.connect);

    expect(run.exitCode).toBe(0);
    expect(block(run.events[2])).toMatchObject({
      content: "Repository is not part of this project",
      is_error: true,
    });
    expect(run.events.at(-1)).toMatchObject({ subtype: "success" });
  });

  test("calls run after the steps", async () => {
    const mcp = stubMcp();

    const run = await play(withAop(`go [fake: steps=1 ${CALLS}]`), {}, undefined, mcp.connect);

    const names = run.events.map((event) => block(event).name).filter(Boolean);
    expect(names).toEqual(["Bash", "mcp__aop__thread_spawn", "mcp__aop__thread_list"]);
  });

  test("a run without the aop server sees the call fail as not connected", async () => {
    const mcp = stubMcp();

    const run = await play(withoutAop(`go [fake: ${CALLS}]`), {}, undefined, mcp.connect);

    expect(run.exitCode).toBe(0);
    expect(mcp.urls).toEqual([]);
    expect(block(run.events[2])).toMatchObject({
      content: "MCP server aop is not connected",
      is_error: true,
    });
  });

  test("an invalid calls directive fails the turn loudly", async () => {
    const mcp = stubMcp();

    const run = await play(withAop("go [fake: calls='[oops']"), {}, undefined, mcp.connect);

    expect(run.exitCode).toBe(1);
    expect(mcp.calls).toEqual([]);
    expect(run.warnings).toEqual(["fake-cli: fake CLI: invalid calls directive"]);
    expect(run.events.at(-1)).toMatchObject({
      subtype: "error_during_execution",
      errors: ["fake CLI: invalid calls directive"],
    });
  });
});

describe("questions through the fake", () => {
  const ASK = `ask="Which one?" options="a|b"`;

  test("with the aop server the question is a real aop_ask_user call and the turn waits", async () => {
    const mcp = stubMcp("Question sent. End your turn.");

    const run = await play(withAop(`go [fake: ${ASK}]`), {}, undefined, mcp.connect);

    expect(mcp.calls).toEqual([
      { name: "aop_ask_user", args: { question: "Which one?", options: ["a", "b"] } },
    ]);
    expect(block(run.events[1])).toMatchObject({ name: "mcp__aop__aop_ask_user" });
    expect(block(run.events[2])).toMatchObject({ content: "Question sent. End your turn." });
    expect(run.events.at(-1)).toMatchObject({ result: "Waiting on your answer." });
  });

  test("without the aop server the question is only scripted, exactly as before", async () => {
    const mcp = stubMcp();

    const run = await play(withoutAop(`go [fake: ${ASK}]`), {}, undefined, mcp.connect);

    expect(mcp.urls).toEqual([]);
    expect(block(run.events[2])).toMatchObject({
      content: "Question sent. Wait for the user's answer.",
      is_error: false,
    });
  });

  test("the native question tool is never sent to the server", async () => {
    const mcp = stubMcp();

    const run = await play(
      withAop(`go [fake: ask="Sure?" tool=AskUserQuestion]`),
      {},
      undefined,
      mcp.connect,
    );

    expect(mcp.calls).toEqual([]);
    expect(block(run.events[1])).toMatchObject({ name: "AskUserQuestion" });
  });
});
