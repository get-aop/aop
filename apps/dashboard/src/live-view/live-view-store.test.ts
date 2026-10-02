import { describe, expect, test } from "bun:test";
import type { LiveViewStatus } from "@aop/common";
import { followedThread } from "./live-view-store";
import { makeSession } from "./test-utils";

const status = (...sessions: ReturnType<typeof makeSession>[]): LiveViewStatus => ({
  mode: "remote",
  viewer: "device",
  shown: true,
  sessions,
  capture: { state: "live", detail: null },
});

const login = makeSession({ threadId: "thr_1", startedAt: "2026-10-02T12:00:00.000Z" });
const footer = makeSession({ threadId: "thr_2", startedAt: "2026-10-02T12:01:00.000Z" });

describe("followedThread", () => {
  test("first follows the most recently active thread", () => {
    expect(followedThread(null, status(footer, login), null)).toBe("thr_2");
  });

  test("stays on the thread it shows while two threads take turns on the screen", () => {
    const before = status(login, footer);
    expect(followedThread(before, status(footer, login), "thr_1")).toBe("thr_1");
  });

  test("a thread that starts using CUA takes the view", () => {
    expect(followedThread(status(login), status(login, footer), "thr_1")).toBe("thr_2");
  });

  test("when the thread it shows is gone, the most recently active one takes over", () => {
    const third = makeSession({ threadId: "thr_3" });
    expect(followedThread(status(login, third), status(third), "thr_1")).toBe("thr_3");
    expect(followedThread(status(login), status(), "thr_1")).toBeNull();
  });

  test("an ending session gives way to a thread still at work, but stays while none is", () => {
    const ending = { ...footer, ending: true };
    expect(followedThread(status(footer, login), status(login, ending), "thr_2")).toBe("thr_1");
    expect(followedThread(status(footer), status(ending), "thr_2")).toBe("thr_2");
  });
});
