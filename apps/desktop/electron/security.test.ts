import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isAllowedDesktopSender, isAllowedNavigation, isSafeExternalUrl } from "./security";
import { buildWindowOptions } from "./window-options";

describe("Electron renderer security", () => {
  test("enables isolation and sandboxing without Node in the renderer", () => {
    const options = buildWindowOptions("/app/preload.cjs");

    expect(options).toMatchObject({
      width: 1280,
      height: 860,
      minWidth: 960,
      minHeight: 640,
      webPreferences: {
        preload: "/app/preload.cjs",
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });
  });

  test("limits privileged setup IPC to the packaged UI and its dev server", () => {
    expect(isAllowedDesktopSender("app://aop/index.html", false)).toBe(true);
    expect(isAllowedDesktopSender("http://127.0.0.1:25170/", true)).toBe(true);
    expect(isAllowedDesktopSender("http://127.0.0.1:25150/?aopDesktop=1", false)).toBe(false);
    expect(isAllowedDesktopSender("https://attacker.example/", false)).toBe(false);
  });

  test("allows only AOP app and loopback navigation", () => {
    expect(isAllowedNavigation("app://aop/index.html", false)).toBe(true);
    expect(isAllowedNavigation("http://127.0.0.1:25150/?aopDesktop=1", false)).toBe(true);
    expect(isAllowedNavigation("http://localhost:25160/", true)).toBe(true);
    expect(isAllowedNavigation("https://example.com/", false)).toBe(false);
  });

  test("opens only HTTP and HTTPS links externally", () => {
    expect(isSafeExternalUrl("https://cli.github.com/")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/")).toBe(true);
    expect(isSafeExternalUrl("file:///tmp/secret")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
  });

  test("ships a restrictive renderer content security policy", () => {
    const html = readFileSync(join(import.meta.dirname, "../index.html"), "utf8");

    expect(html).toContain("default-src 'self'");
    expect(html).toContain("script-src 'self'");
    expect(html).toContain("object-src 'none'");
  });
});
