import { describe, expect, test } from "bun:test";
import {
  ACTIVITY_DETAIL_MAX_LENGTH,
  ACTIVITY_NARRATION_MAX_LENGTH,
  ACTIVITY_ROWS_PER_TURN_MAX,
  ACTIVITY_TURNS_MAX,
  ThreadActivitySchema,
} from "./activity.ts";
import { parsed, rejectedPaths } from "./test-utils.ts";

const row = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  label: "Bash",
  detail: "ls -la",
  status: "done",
  ...overrides,
});
const turn = (overrides: Record<string, unknown> = {}) => ({
  messageId: "msg_1",
  running: false,
  narration: "Looking at the tests.",
  groups: [{ id: "cg_1", rows: [row("t1")] }],
  ...overrides,
});

describe("ThreadActivitySchema", () => {
  test("accepts turns with tool rows, a null detail and a running turn", () => {
    const activity = {
      turns: [
        turn(),
        turn({
          messageId: "msg_2",
          running: true,
          narration: "",
          groups: [{ id: "cg_1", rows: [row("t2", { detail: null, status: "running" })] }],
        }),
      ],
    };
    expect(parsed(ThreadActivitySchema, activity)).toEqual(activity);
  });

  test("rejects an unknown status, an empty group, an over-long detail or narration", () => {
    const groupOf = (rows: unknown[]) => [{ id: "cg_1", rows }];
    expect(
      rejectedPaths(ThreadActivitySchema, {
        turns: [turn({ groups: groupOf([row("t1", { status: "paused" })]) })],
      }),
    ).toEqual(["turns.0.groups.0.rows.0.status"]);
    expect(rejectedPaths(ThreadActivitySchema, { turns: [turn({ groups: groupOf([]) })] })).toEqual(
      ["turns.0.groups.0.rows"],
    );
    expect(
      rejectedPaths(ThreadActivitySchema, {
        turns: [
          turn({
            groups: groupOf([row("t1", { detail: "x".repeat(ACTIVITY_DETAIL_MAX_LENGTH + 1) })]),
          }),
        ],
      }),
    ).toEqual(["turns.0.groups.0.rows.0.detail"]);
    expect(
      rejectedPaths(ThreadActivitySchema, {
        turns: [turn({ narration: "x".repeat(ACTIVITY_NARRATION_MAX_LENGTH + 1) })],
      }),
    ).toEqual(["turns.0.narration"]);
  });

  test("bounds the rows of a turn and the turns of a thread", () => {
    const rows = Array.from({ length: ACTIVITY_ROWS_PER_TURN_MAX + 1 }, (_, index) =>
      row(`t${index}`),
    );
    expect(
      rejectedPaths(ThreadActivitySchema, { turns: [turn({ groups: [{ id: "cg_1", rows }] })] }),
    ).toEqual(["turns.0"]);
    const turns = Array.from({ length: ACTIVITY_TURNS_MAX + 1 }, (_, index) =>
      turn({ messageId: `msg_${index}` }),
    );
    expect(rejectedPaths(ThreadActivitySchema, { turns })).toEqual(["turns"]);
  });
});
