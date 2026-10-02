import { describe, expect, test } from "bun:test";
import { dashboardBuildOptions, outputFilename, pickPageOutputs } from "./build";

test("keeps deferred dashboard features out of the startup bundle", () => {
  expect(dashboardBuildOptions.splitting).toBe(true);
});

describe("outputFilename", () => {
  test("extracts a filename from Windows build output", () => {
    expect(outputFilename(String.raw`C:\workspace\apps\dashboard\dist\main-abc123.js`)).toBe(
      "main-abc123.js",
    );
  });

  test("extracts a filename from Unix build output", () => {
    expect(outputFilename("/workspace/apps/dashboard/dist/main-abc123.js")).toBe("main-abc123.js");
  });
});

describe("pickPageOutputs", () => {
  test("loads the entry point even when the checkout's folder is named main", () => {
    const dist = "/tmp/aop-main-head/apps/dashboard/dist";
    expect(
      pickPageOutputs([
        { path: `${dist}/chunk-etxafnd6.js`, kind: "chunk" },
        { path: `${dist}/main-ds3qxfxy.js`, kind: "entry-point" },
        { path: `${dist}/main-ds3qxfxy.js.map`, kind: "sourcemap" },
        { path: `${dist}/main-a1b2c3.css`, kind: "asset" },
      ]),
    ).toEqual({ js: "main-ds3qxfxy.js", css: "main-a1b2c3.css" });
  });
});
