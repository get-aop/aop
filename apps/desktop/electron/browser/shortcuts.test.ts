import { describe, expect, test } from "bun:test";
import { browserShortcutFor, type KeyInput, stepZoom, WINDOW_BROWSER_SHORTCUTS } from "./shortcuts";

const key = (code: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({
  type: "keyDown",
  code,
  key: code,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...modifiers,
});

describe("browser shortcuts on a Mac", () => {
  const on = (input: KeyInput) => browserShortcutFor(input, "darwin");

  test("⌘ with the keys Chrome uses", () => {
    expect(on(key("KeyL", { meta: true }))).toBe("focus-address");
    expect(on(key("KeyR", { meta: true }))).toBe("reload");
    expect(on(key("KeyR", { meta: true, shift: true }))).toBe("hard-reload");
    expect(on(key("BracketLeft", { meta: true }))).toBe("back");
    expect(on(key("BracketRight", { meta: true }))).toBe("forward");
    expect(on(key("KeyI", { meta: true, alt: true }))).toBe("devtools");
    expect(on(key("F12"))).toBe("devtools");
    expect(on(key("KeyT", { meta: true }))).toBe("new-tab");
    expect(on(key("KeyW", { meta: true }))).toBe("close-tab");
    expect(on(key("BracketRight", { meta: true, shift: true }))).toBe("next-tab");
    expect(on(key("BracketLeft", { meta: true, shift: true }))).toBe("previous-tab");
    expect(on(key("Tab", { control: true }))).toBe("next-tab");
    expect(on(key("Tab", { control: true, shift: true }))).toBe("previous-tab");
    expect(on(key("KeyB", { meta: true, shift: true }))).toBe("toggle-browser");
    expect(on(key("Equal", { meta: true }))).toBe("zoom-in");
    expect(on(key("Equal", { meta: true, shift: true }))).toBe("zoom-in");
    expect(on(key("Minus", { meta: true }))).toBe("zoom-out");
    expect(on(key("Digit0", { meta: true }))).toBe("zoom-reset");
  });

  test("leaves everything else to the page", () => {
    expect(on(key("KeyL"))).toBeNull();
    expect(on(key("KeyR", { control: true }))).toBeNull();
    expect(on(key("KeyC", { meta: true }))).toBeNull();
    expect(on(key("KeyB", { meta: true }))).toBeNull();
    expect(on(key("KeyL", { meta: true, alt: true }))).toBeNull();
    expect(on(key("F12", { shift: true }))).toBeNull();
    expect(on(key("ArrowLeft", { alt: true }))).toBeNull();
  });

  test("only on the key going down, once", () => {
    expect(on({ ...key("KeyR", { meta: true }), type: "keyUp" })).toBeNull();
    expect(on({ ...key("KeyR", { meta: true }), isAutoRepeat: true })).toBeNull();
  });
});

describe("browser shortcuts elsewhere", () => {
  const on = (input: KeyInput) => browserShortcutFor(input, "win32");

  test("Ctrl stands for ⌘, and Alt+arrows go back and forward", () => {
    expect(on(key("KeyL", { control: true }))).toBe("focus-address");
    expect(on(key("KeyR", { control: true }))).toBe("reload");
    expect(on(key("KeyI", { control: true, shift: true }))).toBe("devtools");
    expect(on(key("ArrowLeft", { alt: true }))).toBe("back");
    expect(on(key("ArrowRight", { alt: true }))).toBe("forward");
    expect(on(key("KeyR", { meta: true }))).toBeNull();
  });
});

describe("the app's window", () => {
  test("hands the browser its navigation keys, never zoom, which is the app's own", () => {
    expect(WINDOW_BROWSER_SHORTCUTS.has("reload")).toBe(true);
    expect(WINDOW_BROWSER_SHORTCUTS.has("focus-address")).toBe(true);
    expect(WINDOW_BROWSER_SHORTCUTS.has("zoom-in")).toBe(false);
    expect(WINDOW_BROWSER_SHORTCUTS.has("toggle-browser")).toBe(false);
  });
});

describe("page zoom", () => {
  test("steps through Chrome's levels from wherever it is", () => {
    expect(stepZoom(1, "zoom-in")).toBe(1.1);
    expect(stepZoom(1, "zoom-out")).toBe(0.9);
    expect(stepZoom(1.17, "zoom-in")).toBe(1.25);
    expect(stepZoom(1.17, "zoom-out")).toBe(1.1);
    expect(stepZoom(2.5, "zoom-reset")).toBe(1);
  });

  test("stops at either end", () => {
    expect(stepZoom(5, "zoom-in")).toBe(5);
    expect(stepZoom(0.25, "zoom-out")).toBe(0.25);
  });
});
