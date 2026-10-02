import { describe, expect, test } from "bun:test";
import {
  activeTab,
  type BrowserTabsState,
  browserTabsReducer,
  emptyTabs,
  parseSavedTabs,
} from "./tabs";

const run = (state: BrowserTabsState, ...actions: Parameters<typeof browserTabsReducer>[1][]) =>
  actions.reduce(browserTabsReducer, state);

const urls = (state: BrowserTabsState) => state.tabs.map((tab) => tab.url);

describe("browser tabs", () => {
  test("start with one start page in front", () => {
    const state = emptyTabs();
    expect(urls(state)).toEqual([null]);
    expect(activeTab(state).url).toBeNull();
  });

  test("an address opened over the start page in front takes its place", () => {
    const state = run(emptyTabs(), { type: "open", url: "https://a.example/" });
    expect(urls(state)).toEqual(["https://a.example/"]);
  });

  test("a new tab opens right after the one in front, or the one that opened it, and comes forward", () => {
    let state = run(emptyTabs(), { type: "open", url: "https://a.example/" });
    const first = state.tabs[0]?.id as string;
    state = run(state, { type: "open", url: "https://b.example/" });
    state = run(state, { type: "open", url: "https://c.example/", afterId: first });
    expect(urls(state)).toEqual(["https://a.example/", "https://c.example/", "https://b.example/"]);
    expect(activeTab(state).url).toBe("https://c.example/");
  });

  test("closing the tab in front brings the one to its right, or its left at the end", () => {
    let state = run(
      emptyTabs(),
      { type: "open", url: "https://a.example/" },
      { type: "open", url: "https://b.example/" },
      { type: "open", url: "https://c.example/" },
    );
    const [a, b, c] = state.tabs.map((tab) => tab.id) as [string, string, string];
    state = run(state, { type: "activate", id: b }, { type: "close", id: b });
    expect(state.activeId).toBe(c);
    state = run(state, { type: "close", id: c });
    expect(state.activeId).toBe(a);
  });

  test("closing the last tab leaves a start page", () => {
    const state = emptyTabs();
    const next = run(state, { type: "close", id: state.activeId });
    expect(urls(next)).toEqual([null]);
    expect(next.activeId).not.toBe(state.activeId);
  });

  test("⌃Tab and ⌃⇧Tab go round the tabs", () => {
    let state = run(
      emptyTabs(),
      { type: "open", url: "https://a.example/" },
      { type: "open", url: "https://b.example/" },
    );
    state = run(state, { type: "activate-step", step: 1 });
    expect(activeTab(state).url).toBe("https://a.example/");
    state = run(state, { type: "activate-step", step: -1 });
    expect(activeTab(state).url).toBe("https://b.example/");
  });

  test("a navigation and a title are remembered, most recent first, without repeats", () => {
    let state = run(emptyTabs(), { type: "open", url: "https://a.example/" });
    const id = state.activeId;
    state = run(
      state,
      { type: "titled", id, title: "A" },
      { type: "navigated", id, url: "https://b.example/" },
      { type: "titled", id, title: "B" },
      { type: "navigated", id, url: "https://a.example/" },
    );
    expect(activeTab(state)).toMatchObject({ url: "https://a.example/" });
    expect(state.recent).toEqual([
      { url: "https://a.example/", title: "A" },
      { url: "https://b.example/", title: "B" },
    ]);
  });

  test("ignores tabs that are gone", () => {
    const state = emptyTabs();
    expect(run(state, { type: "activate", id: "nope" })).toBe(state);
    expect(run(state, { type: "close", id: "nope" })).toBe(state);
    expect(run(state, { type: "navigated", id: "nope", url: "https://a.example/" })).toBe(state);
  });

  test("open no more than twenty", () => {
    let state = emptyTabs();
    for (let index = 0; index < 25; index += 1) {
      state = run(state, { type: "open", url: null });
    }
    expect(state.tabs).toHaveLength(20);
  });
});

describe("saved tabs", () => {
  test("round-trip through JSON", () => {
    const state = run(emptyTabs(), { type: "open", url: "https://a.example/" });
    expect(parseSavedTabs(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  test("drop anything that is not a web address, or not a tab", () => {
    const parsed = parseSavedTabs({
      tabs: [
        { id: "t1", url: "javascript:alert(1)", title: "x" },
        { id: "t2", url: "https://a.example/", title: 7 },
        { url: "https://no-id.example/" },
        null,
      ],
      activeId: "gone",
      recent: [{ url: "file:///etc/passwd" }, { url: "http://localhost:3000/", title: "dev" }],
    });
    expect(parsed).toEqual({
      tabs: [
        { id: "t1", url: null, title: "x" },
        { id: "t2", url: "https://a.example/", title: "" },
      ],
      activeId: "t1",
      recent: [{ url: "http://localhost:3000/", title: "dev" }],
    });
  });

  test("are nothing when malformed", () => {
    for (const bad of [null, "text", {}, { tabs: [] }, { tabs: "x" }]) {
      expect(parseSavedTabs(bad)).toBeNull();
    }
  });
});
