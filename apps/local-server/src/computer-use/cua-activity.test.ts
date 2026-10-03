import { describe, expect, test } from "bun:test";
import { createCuaActivity, cuaToolCalls, IDLE_MS, LINGER_MS } from "./cua-activity.ts";

const THREAD = { id: "thr_1", projectId: "prj_1", title: "Check the login page" };
const OTHER = { id: "thr_2", projectId: "prj_1", title: "Fix the footer" };

/** A Claude Code stream-json assistant line calling `tools`. */
const callLine = (...tools: string[]): string =>
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Looking." },
        ...tools.map((name, i) => ({ type: "tool_use", id: `toolu_${i}`, name, input: {} })),
      ],
    },
  });

const clock = () => {
  let at = Date.parse("2026-10-02T12:00:00.000Z");
  return { now: () => at, advance: (ms: number) => (at += ms) };
};

describe("cuaToolCalls", () => {
  test("names the CUA tools an assistant line calls, and nothing else", () => {
    expect(
      cuaToolCalls(callLine("mcp__cua-driver__click", "Bash", "mcp__aop__aop_ask_user")),
    ).toEqual(["mcp__cua-driver__click"]);
  });

  test("ignores partial-message events, results and lines that are not JSON", () => {
    const partial = JSON.stringify({
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: { type: "tool_use", name: "mcp__cua-driver__click" },
      },
    });
    expect(cuaToolCalls(partial)).toEqual([]);
    expect(cuaToolCalls('{"type":"result","result":"mcp__cua-driver__click"}')).toEqual([]);
    expect(cuaToolCalls("mcp__cua-driver__click {")).toEqual([]);
  });
});

describe("CUA activity", () => {
  test("a thread is active from its first CUA call", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("Bash"));
    expect(activity.anyActive()).toBe(false);

    activity.observeLine(THREAD, callLine("mcp__cua-driver__browser_prepare"));

    expect(activity.anyActive()).toBe(true);
    expect(activity.sessions()).toEqual([
      {
        threadId: "thr_1",
        projectId: "prj_1",
        title: "Check the login page",
        startedAt: "2026-10-02T12:00:00.000Z",
        lastActivityAt: "2026-10-02T12:00:00.000Z",
        ending: false,
      },
    ]);
  });

  test("lists the most recently active thread first", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__click"));
    time.advance(1_000);
    activity.observeLine(OTHER, callLine("mcp__cua-driver__click"));
    expect(activity.sessions().map((s) => s.threadId)).toEqual(["thr_2", "thr_1"]);

    time.advance(1_000);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__type_text"));
    expect(activity.sessions().map((s) => s.threadId)).toEqual(["thr_1", "thr_2"]);
  });

  test("a thread still using CUA comes before one whose session just ended", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__click"));
    time.advance(1_000);
    activity.observeLine(OTHER, callLine("mcp__cua-driver__end_session"));

    expect(activity.sessions().map((s) => [s.threadId, s.ending])).toEqual([
      ["thr_1", false],
      ["thr_2", true],
    ]);
  });

  test("end_session ends it, it lingers a few seconds, then it is gone", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__click"));
    activity.observeLine(THREAD, callLine("mcp__cua-driver__end_session"));

    expect(activity.anyActive()).toBe(false);
    expect(activity.sessions()[0]?.ending).toBe(true);

    time.advance(LINGER_MS + 1);
    expect(activity.sessions()).toEqual([]);
  });

  test("the end of the thread's turn ends its CUA session", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__click"));
    activity.runEnded(THREAD.id);
    activity.runEnded("thr_never_used_cua");

    expect(activity.anyActive()).toBe(false);
    expect(activity.sessions().map((s) => s.ending)).toEqual([true]);
  });

  test("a thread that went quiet for IDLE_MS is no longer active", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__click"));
    time.advance(IDLE_MS - 1);
    expect(activity.anyActive()).toBe(true);

    time.advance(2);
    expect(activity.anyActive()).toBe(false);
    expect(activity.sessions()[0]?.ending).toBe(true);
    time.advance(LINGER_MS);
    expect(activity.sessions()).toEqual([]);
  });

  test("a call after the session ended starts a new one", () => {
    const time = clock();
    const activity = createCuaActivity(time.now);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__end_session"));
    time.advance(5_000);
    activity.observeLine(THREAD, callLine("mcp__cua-driver__start_session"));

    const [session] = activity.sessions();
    expect(session?.ending).toBe(false);
    expect(session?.startedAt).toBe("2026-10-02T12:00:05.000Z");
  });
});
