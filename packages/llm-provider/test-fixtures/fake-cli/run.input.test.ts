import { afterEach, describe, expect, test } from "bun:test";
import { CLAUDE_ARGS, play, removeHomes, stubMcp, userLine } from "./test-utils";

afterEach(removeHomes);

const STREAMED = [...CLAUDE_ARGS, "--input-format", "stream-json", "--replay-user-messages"];

type Event = Record<string, unknown>;

const replays = (events: Event[]): unknown[] =>
  events.filter((event) => event.isReplay === true).map((event) => event.uuid);
const results = (events: Event[]): Event[] => events.filter((event) => event.type === "result");
const indexOfUuid = (events: Event[], uuid: string): number =>
  events.findIndex((event) => event.uuid === uuid);

const playStreamed = (input: Parameters<typeof play>[5], args = STREAMED) =>
  play(args, {}, undefined, stubMcp().connect, "/work", input);

describe("a prompt read from stdin a line at a time", () => {
  test("echoes the prompt it took, and ends with its input", async () => {
    const run = await playStreamed({ lines: [userLine("hello", "p1")] });

    expect(run.exitCode).toBe(0);
    expect(replays(run.events)).toEqual(["p1"]);
    expect(results(run.events)).toHaveLength(1);
  });

  test("a message that arrives while the turn works reaches it after the step it is on", async () => {
    const run = await playStreamed({
      lines: [userLine("build it [fake: steps=2]", "p1")],
      // Arrives as the first tool call starts (init, replay, then the step's narration).
      later: [{ afterEvents: 3, line: userLine('use arm64 [fake: say="built for arm64"]', "s1") }],
    });

    expect(run.exitCode).toBe(0);
    expect(replays(run.events)).toEqual(["p1", "s1"]);
    const steeredAt = indexOfUuid(run.events, "s1");
    const toolResults = run.events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => JSON.stringify(event).includes('"tool_result"'));
    expect(toolResults[0]?.index).toBeLessThan(steeredAt);
    expect(toolResults[1]?.index).toBeGreaterThan(steeredAt);
    expect(results(run.events)).toHaveLength(1);
    expect(results(run.events)[0]?.result).toBe("built for arm64");
  });

  test("the default reply names what reached the turn", async () => {
    const run = await playStreamed({
      lines: [userLine("build it [fake: steps=1]", "p1")],
      later: [{ afterEvents: 3, line: userLine("use arm64", "s1") }],
    });

    expect(String(results(run.events)[0]?.result)).toEndWith("Then you said: use arm64");
  });

  test("a message that arrives as the turn answers starts another turn after it", async () => {
    const run = await playStreamed({
      lines: [userLine("first", "p1")],
      // Arrives once the answer is being written (init, replay, then the answer).
      later: [{ afterEvents: 3, line: userLine("second", "p2") }],
    });

    expect(run.exitCode).toBe(0);
    expect(replays(run.events)).toEqual(["p1", "p2"]);
    const [first, second] = results(run.events);
    expect(String(first?.result)).toContain("turn 1");
    expect(String(second?.result)).toContain("turn 2");
    expect(String(second?.result)).toContain("(resumed). You said: second");
    expect(first?.session_id).toBe(second?.session_id);
  });

  test("echoes nothing without --replay-user-messages", async () => {
    const run = await playStreamed({ lines: [userLine("hello", "p1")] }, [
      ...CLAUDE_ARGS,
      "--input-format",
      "stream-json",
    ]);

    expect(replays(run.events)).toEqual([]);
    expect(results(run.events)).toHaveLength(1);
  });

  test("a turn that fails ends the launch with its exit code", async () => {
    const run = await playStreamed({
      lines: [userLine("x [fake: fail]", "p1")],
      later: [{ afterEvents: 3, line: userLine("never played", "p2") }],
    });

    expect(run.exitCode).toBe(1);
    expect(replays(run.events)).toEqual(["p1"]);
  });
});

const interrupt = (requestId: string): string =>
  JSON.stringify({
    type: "control_request",
    request_id: requestId,
    request: { subtype: "interrupt" },
  });

describe("a long step and an interrupt", () => {
  test("a message waits behind a long step and is taken once it ends", async () => {
    const run = await playStreamed({
      lines: [userLine("run the suite [fake: hold=1000]", "p1")],
      // Arrives as the long call starts (init, replay, then the call).
      later: [{ afterEvents: 3, line: userLine("use arm64", "s1") }],
    });

    expect(run.exitCode).toBe(0);
    expect(run.sleeps.reduce((sum, ms) => sum + ms, 0)).toBe(1000);
    const toolResultAt = run.events.findIndex((event) =>
      JSON.stringify(event).includes('"tool_result"'),
    );
    expect(toolResultAt).toBeLessThan(indexOfUuid(run.events, "s1"));
    expect(results(run.events)).toHaveLength(1);
  });

  test("an interrupt stops the long step, and the message waiting starts the next turn at once", async () => {
    const run = await playStreamed({
      lines: [userLine("run the suite [fake: hold=60000]", "p1")],
      later: [
        { afterEvents: 3, line: userLine('stop [fake: say="stopped"]', "s1") },
        { afterEvents: 3, line: interrupt("req-1") },
      ],
    });

    expect(run.exitCode).toBe(0);
    // It never waited the step out.
    expect(run.sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(60_000);
    expect(run.events.find((event) => event.type === "control_response")).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "req-1",
        response: { still_queued: ["s1"] },
      },
    });
    const [cut, next] = results(run.events);
    expect(cut).toMatchObject({ subtype: "error_during_execution", is_error: true });
    expect(next).toMatchObject({ subtype: "success", result: "stopped" });
    expect(replays(run.events)).toEqual(["p1", "s1"]);
    expect(JSON.stringify(run.events)).toContain("[Request interrupted by user for tool use]");
    const refused = run.events.find((event) => JSON.stringify(event).includes('"tool_result"'));
    expect(JSON.stringify(refused)).toContain('"is_error":true');
  });

  test("an interrupt with no message waiting ends the turn, and the launch with its input", async () => {
    const run = await playStreamed({
      lines: [userLine("run the suite [fake: hold=60000]", "p1")],
      later: [{ afterEvents: 3, line: interrupt("req-2") }],
    });

    expect(run.exitCode).toBe(0);
    expect(results(run.events).map((result) => result.subtype)).toEqual(["error_during_execution"]);
  });
});
