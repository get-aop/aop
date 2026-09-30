import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { setupDashboardDom } from "../../test/setup-dom";
import {
  clampPanelWidth,
  DEFAULT_PANEL_PREFS,
  layoutModeFor,
  loadPanelPrefs,
  panelWidthFor,
  savePanelPrefs,
} from "./panel-layout";

setupDashboardDom();

afterEach(() => window.localStorage.clear());

describe("layoutModeFor", () => {
  test("picks side by side, overlay or one pane by the room there is", () => {
    expect(layoutModeFor(1400)).toBe("side");
    expect(layoutModeFor(900)).toBe("side");
    expect(layoutModeFor(899)).toBe("overlay");
    expect(layoutModeFor(600)).toBe("overlay");
    expect(layoutModeFor(599)).toBe("single");
    expect(layoutModeFor(390)).toBe("single");
  });
});

describe("clampPanelWidth", () => {
  test("keeps the panel between its minimum and what leaves the chat its own", () => {
    expect(clampPanelWidth(100, 1200)).toBe(360);
    expect(clampPanelWidth(500.4, 1200)).toBe(500);
    expect(clampPanelWidth(2000, 1200)).toBe(860);
  });

  test("a screen too small for both still gives the panel its minimum", () => {
    expect(clampPanelWidth(500, 500)).toBe(360);
  });
});

describe("panelWidthFor", () => {
  test("beside the chat it leaves the chat its room; over the chat it leaves a margin", () => {
    expect(panelWidthFor("side", 900, 1200)).toBe(860);
    expect(panelWidthFor("overlay", 580, 604)).toBe(556);
    expect(panelWidthFor("overlay", 400, 700)).toBe(400);
    expect(panelWidthFor("overlay", 100, 700)).toBe(360);
  });
});

describe("the remembered panel", () => {
  test("starts open at the default width", () => {
    expect(loadPanelPrefs("p1")).toEqual(DEFAULT_PANEL_PREFS);
  });

  test("keeps what was saved", () => {
    savePanelPrefs("p1", { open: false, width: 640 });

    expect(loadPanelPrefs("p1")).toEqual({ open: false, width: 640 });
  });

  test("keeps each project's own, so closing one leaves the others open", () => {
    savePanelPrefs("p1", { open: false, width: 640 });
    savePanelPrefs("p2", { open: true, width: 400 });

    expect(loadPanelPrefs("p1")).toEqual({ open: false, width: 640 });
    expect(loadPanelPrefs("p2")).toEqual({ open: true, width: 400 });
    expect(loadPanelPrefs("p3")).toEqual(DEFAULT_PANEL_PREFS);
  });

  test("ignores garbage, a width that cannot be, and storage that throws", () => {
    window.localStorage.setItem("aop:threads-panel:v2:p1", "{nope");
    expect(loadPanelPrefs("p1")).toEqual(DEFAULT_PANEL_PREFS);

    window.localStorage.setItem(
      "aop:threads-panel:v2:p1",
      JSON.stringify({ open: "yes", width: 12 }),
    );
    expect(loadPanelPrefs("p1")).toEqual(DEFAULT_PANEL_PREFS);

    const get = spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    try {
      expect(loadPanelPrefs("p1")).toEqual(DEFAULT_PANEL_PREFS);
      expect(() => savePanelPrefs("p1", { open: false, width: 500 })).not.toThrow();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
