import { describe, expect, test } from "bun:test";
import {
  clearSessionStreamProgress,
  getSessionStreamProgressSnapshot,
  resetSessionStreamProgressStore,
  setSessionStreamProgress,
  subscribeSessionStreamProgress,
} from "./session-stream-progress";

describe("session-stream-progress store", () => {
  test("stores progress for the active session and clears it", () => {
    resetSessionStreamProgressStore();
    setSessionStreamProgress("s1", {
      thinking: "hmm",
      content: "hello",
      commandGroups: [],
    });
    expect(getSessionStreamProgressSnapshot()).toEqual({
      sessionId: "s1",
      progress: { thinking: "hmm", content: "hello", commandGroups: [] },
    });

    clearSessionStreamProgress("s1");
    expect(getSessionStreamProgressSnapshot()).toEqual({
      sessionId: null,
      progress: null,
    });
  });

  test("ignores clear for a different session", () => {
    resetSessionStreamProgressStore();
    setSessionStreamProgress("s1", {
      thinking: "",
      content: "active",
      commandGroups: [],
    });
    clearSessionStreamProgress("s2");
    expect(getSessionStreamProgressSnapshot().sessionId).toBe("s1");
    expect(getSessionStreamProgressSnapshot().progress?.content).toBe("active");
  });

  test("notifies subscribers on change", () => {
    resetSessionStreamProgressStore();
    let ticks = 0;
    const unsubscribe = subscribeSessionStreamProgress(() => {
      ticks += 1;
    });
    setSessionStreamProgress("s1", { thinking: "", content: "a", commandGroups: [] });
    setSessionStreamProgress("s1", { thinking: "", content: "b", commandGroups: [] });
    expect(ticks).toBe(2);
    unsubscribe();
    setSessionStreamProgress("s1", { thinking: "", content: "c", commandGroups: [] });
    expect(ticks).toBe(2);
  });
});
