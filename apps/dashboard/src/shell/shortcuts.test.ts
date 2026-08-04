import { afterEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { handleGlobalShortcut, type ShortcutActions } from "./shortcuts";

setupDashboardDom();
afterEach(() => {
  document.body.innerHTML = "";
});

const actions = (): ShortcutActions => ({
  toggleCommandPalette: mock(() => {}),
  newSession: mock(() => {}),
  openSettings: mock(() => {}),
});

const keyEvent = (
  key: string,
  target: EventTarget | null = document.body,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = {},
): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
  });
  Object.defineProperty(event, "target", { value: target, configurable: true });
  return event;
};

const textarea = (): HTMLTextAreaElement => {
  const el = document.createElement("textarea");
  document.body.appendChild(el);
  return el;
};

const cleanup = () => {
  document.body.innerHTML = "";
};

describe("handleGlobalShortcut", () => {
  test("⌘K opens the command palette", () => {
    const a = actions();
    expect(handleGlobalShortcut(keyEvent("k", document.body, { metaKey: true }), a)).toBe(true);
    expect(a.toggleCommandPalette).toHaveBeenCalled();
  });

  test("⌘, opens settings", () => {
    const a = actions();
    expect(handleGlobalShortcut(keyEvent(",", document.body, { metaKey: true }), a)).toBe(true);
    expect(a.openSettings).toHaveBeenCalled();
  });

  test("⌘N starts a new session", () => {
    const a = actions();
    expect(handleGlobalShortcut(keyEvent("n", document.body, { metaKey: true }), a)).toBe(true);
    expect(a.newSession).toHaveBeenCalled();
  });

  test("ctrl variants work on Windows-style keyboards", () => {
    const a = actions();
    expect(handleGlobalShortcut(keyEvent("k", document.body, { ctrlKey: true }), a)).toBe(true);
    expect(handleGlobalShortcut(keyEvent("n", document.body, { ctrlKey: true }), a)).toBe(true);
  });

  test("editable targets only yield to ⌘K and ⌘,", () => {
    const el = textarea();
    const a = actions();
    expect(handleGlobalShortcut(keyEvent("n", el, { metaKey: true }), a)).toBe(false);
    expect(a.newSession).not.toHaveBeenCalled();
    expect(handleGlobalShortcut(keyEvent("k", el, { metaKey: true }), a)).toBe(true);
    expect(handleGlobalShortcut(keyEvent(",", el, { metaKey: true }), a)).toBe(true);
    cleanup();
  });

  test("ignores unmodified keys", () => {
    const a = actions();
    expect(handleGlobalShortcut(keyEvent("k"), a)).toBe(false);
    expect(handleGlobalShortcut(keyEvent("n"), a)).toBe(false);
    expect(a.toggleCommandPalette).not.toHaveBeenCalled();
    expect(a.newSession).not.toHaveBeenCalled();
  });
});
