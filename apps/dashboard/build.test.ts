import { describe, expect, test } from "bun:test";
import { outputFilename } from "./build";

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
