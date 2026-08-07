import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { isDesktopApp, nativeHtmlDragEnabled } from "./desktop-runtime";

setupDashboardDom();

afterEach(() => {
  sessionStorage.clear();
  delete (window as { aopDesktop?: unknown }).aopDesktop;
  window.history.replaceState(null, "", "/");
});

describe("desktop runtime detection", () => {
  test("detects the Electron preload bridge", () => {
    (window as { aopDesktop?: unknown }).aopDesktop = {};

    expect(isDesktopApp()).toBe(true);
    expect(nativeHtmlDragEnabled()).toBe(false);
  });

  test("persists the desktop dashboard query marker across route changes", () => {
    window.history.replaceState(null, "", "/?aopDesktop=1");

    expect(isDesktopApp()).toBe(true);
    window.history.replaceState(null, "", "/metrics");

    expect(isDesktopApp()).toBe(true);
    expect(nativeHtmlDragEnabled()).toBe(false);
  });
});
