import { afterEach, describe, expect, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import { isTauriWebView, nativeHtmlDragEnabled } from "./desktop-runtime";

setupDashboardDom();

afterEach(() => {
  sessionStorage.clear();
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  window.history.replaceState(null, "", "/");
});

describe("desktop runtime detection", () => {
  test("detects Tauri globals", () => {
    (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};

    expect(isTauriWebView()).toBe(true);
    expect(nativeHtmlDragEnabled()).toBe(false);
  });

  test("persists the desktop dashboard query marker across route changes", () => {
    window.history.replaceState(null, "", "/?aopDesktop=1");

    expect(isTauriWebView()).toBe(true);
    window.history.replaceState(null, "", "/metrics");

    expect(isTauriWebView()).toBe(true);
    expect(nativeHtmlDragEnabled()).toBe(false);
  });
});
