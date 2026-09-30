import { describe, expect, test } from "bun:test";
import { parseDirectives } from "./directives";
import { planTurn } from "./turn";
import type { TurnContext } from "./types";

const ctx: TurnContext = {
  sessionId: "sess-9",
  cwd: "/work",
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

  test("failure wins over exit code, and an exit code alone ends the turn silently", () => {
    expect(plan('fail="bad" exit=5').ending).toEqual({ kind: "failure", message: "bad" });
    expect(plan("exit=5").ending).toEqual({ kind: "silent" });
  });
});
