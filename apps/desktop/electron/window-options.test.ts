import { describe, expect, test } from "bun:test";
import { buildWindowOptions } from "./window-options";

describe("buildWindowOptions", () => {
  test("keeps the page isolated and sandboxed, with the PDF viewer the artifact view needs", () => {
    expect(buildWindowOptions("/app/preload.js").webPreferences).toEqual({
      preload: "/app/preload.js",
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      plugins: true,
    });
  });
});
