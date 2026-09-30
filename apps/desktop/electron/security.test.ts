import { describe, expect, test } from "bun:test";
import {
  isAllowedNavigation,
  isDashboardSender,
  isSafeExternalUrl,
  isSafeUpdateUrl,
  isShellSender,
} from "./security";

describe("isShellSender", () => {
  test("is the connect screen, and only it", () => {
    expect(isShellSender("app://desktop/index.html", false)).toBe(true);
    expect(isShellSender("app://aop/index.html", false)).toBe(false);
    expect(isShellSender("https://mac.tail1234.ts.net/", false)).toBe(false);
    expect(isShellSender("http://127.0.0.1:25150/", false)).toBe(false);
    expect(isShellSender("not a url", false)).toBe(false);
  });

  test("includes the Vite dev server while developing, and only then", () => {
    expect(isShellSender("http://127.0.0.1:25170/", true)).toBe(true);
    expect(isShellSender("http://127.0.0.1:25170/", false)).toBe(false);
    expect(isShellSender("http://127.0.0.1:25171/", true)).toBe(false);
    expect(isShellSender("http://localhost:25170/", true)).toBe(false);
  });
});

describe("isDashboardSender", () => {
  test("is the bundled dashboard, and nothing a host serves", () => {
    expect(isDashboardSender("app://aop/projects/prj_1")).toBe(true);
    expect(isDashboardSender("app://desktop/index.html")).toBe(false);
    expect(isDashboardSender("http://127.0.0.1:25150/")).toBe(false);
    expect(isDashboardSender("https://aop/")).toBe(false);
  });
});

describe("isAllowedNavigation", () => {
  test("allows the app's own two pages", () => {
    expect(isAllowedNavigation("app://aop/projects/prj_1", false)).toBe(true);
    expect(isAllowedNavigation("app://desktop/index.html#/connect", false)).toBe(true);
  });

  test("refuses every other page, including the host's own dashboard", () => {
    for (const url of [
      "https://mac.tail1234.ts.net/",
      "http://127.0.0.1:25150/",
      "https://example.com/",
      "app://other/",
      "file:///etc/passwd",
    ]) {
      expect(isAllowedNavigation(url, false)).toBe(false);
    }
  });
});

describe("isSafeExternalUrl", () => {
  test("hands only web addresses to the person's browser", () => {
    expect(isSafeExternalUrl("https://github.com/acme/repo/pull/1")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000")).toBe(true);
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalUrl("app://aop/")).toBe(false);
  });
});

describe("isSafeUpdateUrl", () => {
  test("opens an https download and nothing else for the real feed", () => {
    expect(
      isSafeUpdateUrl("https://github.com/get-aop/aop-mono/releases/download/v1/a.dmg", false),
    ).toBe(true);
    expect(isSafeUpdateUrl("http://127.0.0.1:9/download/a.dmg", false)).toBe(false);
    expect(isSafeUpdateUrl("http://evil.example/a.dmg", false)).toBe(false);
    expect(isSafeUpdateUrl("file:///etc/passwd", false)).toBe(false);
  });

  test("a test feed may serve plain http from this computer, and only from it", () => {
    expect(isSafeUpdateUrl("http://127.0.0.1:9/download/a.dmg", true)).toBe(true);
    expect(isSafeUpdateUrl("http://localhost:9/download/a.dmg", true)).toBe(true);
    expect(isSafeUpdateUrl("http://evil.example/a.dmg", true)).toBe(false);
  });
});
