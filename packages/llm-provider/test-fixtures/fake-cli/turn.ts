import { type Directives, stripDirectives } from "./directives";
import type { Ending, PlannedBeat, TurnContext } from "./types";

export interface TurnPlan {
  beats: PlannedBeat[];
  ending: Ending;
}

const ASK_WAIT_TEXT = "Waiting on your answer.";
const MAX_ECHO_LENGTH = 200;

/** Turns the script into CLI-neutral beats: N tool rounds, MCP calls, an optional question, then how the turn ends. */
export const planTurn = (directives: Directives, ctx: TurnContext): TurnPlan => {
  const beats: PlannedBeat[] = [];
  for (let step = 1; step <= directives.steps; step += 1) {
    beats.push(
      { kind: "text", text: `Working on step ${step} of ${directives.steps}.` },
      { kind: "shell", command: `echo step ${step}`, output: `step ${step}` },
    );
  }
  for (const call of directives.calls ?? []) beats.push({ kind: "call", call });
  if (directives.ask) beats.push({ kind: "ask", ask: directives.ask });
  return { beats, ending: chooseEnding(directives, ctx) };
};

const chooseEnding = (directives: Directives, ctx: TurnContext): Ending => {
  if (directives.callsError !== undefined) {
    return { kind: "failure", message: directives.callsError };
  }
  if (directives.failMessage !== undefined) {
    return { kind: "failure", message: directives.failMessage };
  }
  if (directives.exitCode !== undefined) return { kind: "silent" };
  const fallback = directives.ask ? ASK_WAIT_TEXT : defaultReply(ctx);
  return { kind: "success", text: directives.say ?? fallback };
};

// The reply names the turn and session so a test or a screenshot can tell a
// resumed conversation from a fresh one without reading logs.
const defaultReply = (ctx: TurnContext): string => {
  const resumed = ctx.resumed ? " (resumed)" : "";
  const firstLine = stripDirectives(ctx.prompt).split("\n")[0] ?? "";
  const echo = firstLine.trim().slice(0, MAX_ECHO_LENGTH);
  return `Fake reply for turn ${ctx.turn} of session ${ctx.sessionId}${resumed}. You said: ${echo}`;
};
