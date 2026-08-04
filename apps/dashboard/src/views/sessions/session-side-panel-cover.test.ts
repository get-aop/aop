import { afterEach, describe, expect, test } from "bun:test";
import {
  isSessionSidePanelCovered,
  resetSessionSidePanelCovered,
  setSessionSidePanelCovered,
} from "./session-side-panel-cover";

afterEach(() => {
  resetSessionSidePanelCovered();
});

describe("session-side-panel-cover", () => {
  test("starts uncovered and toggles", () => {
    expect(isSessionSidePanelCovered()).toBe(false);
    setSessionSidePanelCovered(true);
    expect(isSessionSidePanelCovered()).toBe(true);
    setSessionSidePanelCovered(false);
    expect(isSessionSidePanelCovered()).toBe(false);
  });

  test("reset clears cover", () => {
    setSessionSidePanelCovered(true);
    resetSessionSidePanelCovered();
    expect(isSessionSidePanelCovered()).toBe(false);
  });
});
