import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyZoomShortcut } from "./app-zoom";

describe("app zoom", () => {
  test("root coverage styles fill the webview without uncovered bars", () => {
    const css = readFileSync(join(import.meta.dir, "index.css"), "utf8");
    expect(css).toContain("min-width: 100%");
    expect(css).toContain("min-height: 100%");
    expect(css).toMatch(/\.aop-studio-root\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.aop-studio-root\s*\{[^}]*height:\s*100%/s);
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/html,\s*body,\s*#root\s*\{[^}]*background:\s*var\(--color-canvas\)/s);
    // Page-local zoom on the app root would leave native webview bars; keep zoom app-wide.
    const rootBlock = css.match(/\.aop-studio-root\s*\{[^}]*\}/s)?.[0] ?? "";
    expect(rootBlock).not.toMatch(/zoom\s*:/);
    expect(rootBlock).not.toMatch(/transform\s*:\s*scale\(/);
  });

  test("zooms in for Command or Control plus", () => {
    expect(applyZoomShortcut(1, keyboardEvent("=", { ctrlKey: true }))).toBe(1.1);
    expect(applyZoomShortcut(1.1, keyboardEvent("+", { metaKey: true }))).toBe(1.2);
  });

  test("zooms out for Command or Control minus", () => {
    expect(applyZoomShortcut(1.1, keyboardEvent("-", { metaKey: true }))).toBe(1);
  });

  test("ignores plus and minus without a platform modifier", () => {
    expect(applyZoomShortcut(1, keyboardEvent("+"))).toBeNull();
    expect(applyZoomShortcut(1, keyboardEvent("-"))).toBeNull();
  });

  test("keeps zoom within readable bounds", () => {
    expect(applyZoomShortcut(1.5, keyboardEvent("+", { ctrlKey: true }))).toBe(1.5);
    expect(applyZoomShortcut(0.7, keyboardEvent("-", { ctrlKey: true }))).toBe(0.7);
  });

  test("walks the Issue 5 matrix ladder: zoom out, default, and three zoom-in steps", () => {
    // Matrix levels: ~0.8 (zoom out), 1.0, 1.1, ~1.2–1.3, ~1.4–1.5 (max).
    let zoom = 1;
    zoom = applyZoomShortcut(zoom, keyboardEvent("-", { metaKey: true })) ?? zoom;
    zoom = applyZoomShortcut(zoom, keyboardEvent("-", { metaKey: true })) ?? zoom;
    expect(zoom).toBe(0.8);

    zoom = 1;
    expect(zoom).toBe(1);

    zoom = applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true })) ?? zoom;
    expect(zoom).toBe(1.1);

    zoom = applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true })) ?? zoom;
    expect(zoom).toBe(1.2);

    zoom = applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true })) ?? zoom;
    zoom = applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true })) ?? zoom;
    zoom = applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true })) ?? zoom;
    expect(zoom).toBe(1.5);
    expect(applyZoomShortcut(zoom, keyboardEvent("=", { metaKey: true }))).toBe(1.5);
  });
});

const keyboardEvent = (
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "metaKey">> = {},
): KeyboardEvent =>
  ({
    key,
    ctrlKey: modifiers.ctrlKey ?? false,
    metaKey: modifiers.metaKey ?? false,
  }) as KeyboardEvent;
