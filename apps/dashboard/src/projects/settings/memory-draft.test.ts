import { describe, expect, test } from "bun:test";
import { MEMORY_BODY_MAX_LENGTH } from "@aop/common";
import { refusalOf } from "./memory-draft";

describe("refusalOf", () => {
  test("says which part of the file is too long, in plain words", () => {
    const input = {
      name: "notes.md",
      description: "",
      body: "x".repeat(MEMORY_BODY_MAX_LENGTH + 1),
    };

    expect(refusalOf(input, false, [])).toBe(
      `Body can be at most ${MEMORY_BODY_MAX_LENGTH} characters.`,
    );
  });

  test("keeps the schema's own sentence for a name that is not allowed", () => {
    expect(refusalOf({ name: "no spaces.md", description: "", body: "" }, true, [])).toBe(
      "Memory file names are letters, digits, . _ - and end in .md",
    );
  });

  test("refuses to replace a file that exists when creating, and allows the rest", () => {
    const input = { name: "notes.md", description: "", body: "" };

    expect(refusalOf(input, true, ["notes.md"])).toBe(
      "notes.md already exists. Pick another name, or open it from the list.",
    );
    expect(refusalOf(input, false, ["notes.md"])).toBeNull();
    expect(refusalOf(input, true, [])).toBeNull();
  });
});
