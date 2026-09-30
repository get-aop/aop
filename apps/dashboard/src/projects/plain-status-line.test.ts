import { describe, expect, test } from "bun:test";
import { plainStatusLine } from "./plain-status-line";

describe("plainStatusLine", () => {
  test("drops emphasis, strike-through and code markers and keeps their words", () => {
    expect(plainStatusLine("You chose **formal**. Nothing changed.")).toBe(
      "You chose formal. Nothing changed.",
    );
    expect(plainStatusLine("Running *contract* tests with `bun test`")).toBe(
      "Running contract tests with bun test",
    );
    expect(plainStatusLine("__done__ and ~~dropped~~ and _soon_")).toBe(
      "done and dropped and soon",
    );
  });

  test("keeps a link's text and not its address", () => {
    expect(plainStatusLine("Opened [PR #4](https://github.com/acme/app/pull/4)")).toBe(
      "Opened PR #4",
    );
  });

  test("leaves text that only looks like a marker alone", () => {
    expect(plainStatusLine("Read snake_case_names in 3 files")).toBe(
      "Read snake_case_names in 3 files",
    );
    expect(plainStatusLine("2 * 3 = 6 and 4 * 5 = 20")).toBe("2 * 3 = 6 and 4 * 5 = 20");
    expect(plainStatusLine("Bisecting · 7 commits left")).toBe("Bisecting · 7 commits left");
  });
});
