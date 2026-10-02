import { describe, expect, test } from "bun:test";
import { buildWindowOptions } from "./window-options";

describe("buildWindowOptions", () => {
  // The AOP Browser's pages are <webview> guests; browser/policy.ts gates and hardens each one.
  test("keeps the page isolated and sandboxed, with the PDF viewer and the AOP Browser's webviews", () => {
    expect(buildWindowOptions("/app/preload.js").webPreferences).toEqual({
      preload: "/app/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      plugins: true,
    });
  });
});
