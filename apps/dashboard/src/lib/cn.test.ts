import { describe, expect, test } from "bun:test";
import { cn } from "./cn";

describe("cn", () => {
  test("keeps the project screen's font sizes next to a text colour", () => {
    expect(cn("text-body text-text-muted")).toBe("text-body text-text-muted");
    expect(cn("text-meta text-text", "text-waiting")).toBe("text-meta text-waiting");
  });

  test("a later font size replaces an earlier one", () => {
    expect(cn("text-meta", "text-title")).toBe("text-title");
    expect(cn("text-xs", "text-body")).toBe("text-body");
  });
});
