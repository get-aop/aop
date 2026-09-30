import { describe, expect, test } from "bun:test";
import {
  MEMORY_BODY_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  MEMORY_INDEX_NAME,
  MemoryFileInputSchema,
  MemoryFileSchema,
} from "./memory.ts";
import { AT, rejectedPaths } from "./test-utils.ts";

describe("MemoryFileInputSchema", () => {
  test("accepts the index and a topic file, and defaults a missing description", () => {
    expect(MemoryFileInputSchema.parse({ name: MEMORY_INDEX_NAME, body: "- testing.md" })).toEqual({
      name: "MEMORY.md",
      description: "",
      body: "- testing.md",
    });
    expect(
      MemoryFileInputSchema.parse({ name: "db-migrations_v2.md", description: "How", body: "" })
        .name,
    ).toBe("db-migrations_v2.md");
  });

  test("rejects names that are not a safe .md file name", () => {
    for (const name of ["notes", "notes.txt", "../notes.md", "a/b.md", ".hidden.md", " x.md", ""]) {
      expect(rejectedPaths(MemoryFileInputSchema, { name, body: "" })).toEqual(["name"]);
    }
  });

  test("bounds the description and the body", () => {
    const at = (description: number, body: number) => ({
      name: "a.md",
      description: "d".repeat(description),
      body: "b".repeat(body),
    });
    expect(MemoryFileInputSchema.safeParse(at(MEMORY_DESCRIPTION_MAX_LENGTH, 1)).success).toBe(
      true,
    );
    expect(rejectedPaths(MemoryFileInputSchema, at(MEMORY_DESCRIPTION_MAX_LENGTH + 1, 1))).toEqual([
      "description",
    ]);
    expect(rejectedPaths(MemoryFileInputSchema, at(1, MEMORY_BODY_MAX_LENGTH + 1))).toEqual([
      "body",
    ]);
  });
});

describe("MemoryFileSchema", () => {
  test("adds the time the file last changed", () => {
    const file = { name: "a.md", description: "", body: "x", updatedAt: AT };
    expect(MemoryFileSchema.parse(file)).toEqual(file);
    expect(rejectedPaths(MemoryFileSchema, { ...file, updatedAt: "yesterday" })).toEqual([
      "updatedAt",
    ]);
  });
});
