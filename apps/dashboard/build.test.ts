import { describe, expect, test } from "bun:test";
import { dashboardBuildOptions, outputFilename } from "./build";

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
