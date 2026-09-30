import { describe, expect, test } from "bun:test";
import { parseDirectives } from "./directives";
import { planTurn } from "./turn";
import type { TurnContext } from "./types";

const ctx: TurnContext = {
  sessionId: "sess-9",
  cwd: "/work",
  usage: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 },
  prompt: "ship it [fake: steps=1]\nsecond line",
  turn: 3,
  resumed: true,
};

const plan = (script: string) => planTurn(parseDirectives(`x [fake: ${script}]`), ctx);

describe("planTurn", () => {
  test("adds a narration and a shell round per step", () => {
    const { beats } = plan("steps=2");

    expect(beats.map((beat) => beat.kind)).toEqual(["text", "shell", "text", "shell"]);
    expect(beats[1]).toEqual({ kind: "shell", command: "echo step 1", output: "step 1" });
  });

  test("replies with the turn, the session and the first line of the prompt sans marker", () => {
    const { ending } = plan("steps=0");

    expect(ending).toEqual({
      kind: "success",
      text: "Fake reply for turn 3 of session sess-9 (resumed). You said: ship it",
    });
  });

  test("a question comes after the steps and makes the turn wait for the answer", () => {
    const { beats, ending } = plan('steps=1 ask="Ready?"');

    expect(beats.at(-1)).toMatchObject({ kind: "ask", ask: { question: "Ready?" } });
    expect(ending).toEqual({ kind: "success", text: "Waiting on your answer." });
  });

  test("MCP calls run in order after the steps and before the question", () => {
    const script = `steps=1 ask="Ready?" calls='[{"name":"a"},{"name":"b","arguments":{"n":1}}]'`;
    const { beats } = plan(script);

    expect(beats.map((beat) => beat.kind)).toEqual(["text", "shell", "call", "call", "ask"]);
    expect(beats[3]).toEqual({ kind: "call", call: { name: "b", arguments: { n: 1 } } });
  });

  test("a call-only turn replies normally, since nothing waits on the user", () => {
    const { ending } = plan(`calls='[{"name":"a"}]'`);

    expect(ending).toMatchObject({ kind: "success" });
    expect((ending as { text: string }).text).toContain("Fake reply for turn 3");
  });

  test("an invalid calls directive plans no calls and fails the turn", () => {
    const { beats, ending } = plan("steps=1 calls='[oops'");

    expect(beats.map((beat) => beat.kind)).toEqual(["text", "shell"]);
    expect(ending).toEqual({ kind: "failure", message: "fake CLI: invalid calls directive" });
  });

  test("failure wins over exit code, and an exit code alone ends the turn silently", () => {
    expect(plan('fail="bad" exit=5').ending).toEqual({ kind: "failure", message: "bad" });
    expect(plan("exit=5").ending).toEqual({ kind: "silent" });
  });
});
