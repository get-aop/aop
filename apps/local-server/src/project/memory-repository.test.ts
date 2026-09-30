import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createMemoryRepository, type MemoryRepository } from "./memory-repository.ts";
import { insertProjectRow } from "./test-utils.ts";

const T0 = new Date("2026-09-30T09:00:00.000Z");
const T1 = new Date("2026-09-30T10:00:00.000Z");

describe("memory repository", () => {
  let db: Kysely<Database>;
  let clock: Date;
  let memory: MemoryRepository;

  beforeEach(async () => {
    db = await createTestDb();
    clock = T0;
    memory = createMemoryRepository(db, () => clock);
    await insertProjectRow(db, "p1");
    await insertProjectRow(db, "p2");
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("saves a file and reads it back", async () => {
    const saved = await memory.save("p1", {
      name: "MEMORY.md",
      description: "Index read by every thread",
      body: "- build.md: how to build",
    });

    expect(saved).toEqual({
      name: "MEMORY.md",
      description: "Index read by every thread",
      body: "- build.md: how to build",
      updatedAt: T0.toISOString(),
    });
    expect(await memory.get("p1", "MEMORY.md")).toEqual(saved);
    expect(await memory.get("p1", "missing.md")).toBeNull();
  });

  test("saving an existing name replaces it instead of adding a second file", async () => {
    await memory.save("p1", { name: "build.md", description: "old", body: "old body" });
    clock = T1;

    const replaced = await memory.save("p1", { name: "build.md", description: "new", body: "" });

    expect(replaced).toEqual({
      name: "build.md",
      description: "new",
      body: "",
      updatedAt: T1.toISOString(),
    });
    expect(await memory.list("p1")).toEqual([replaced]);
  });

  test("lists one project's files by name and never another project's", async () => {
    await memory.save("p1", { name: "b.md", description: "", body: "b" });
    await memory.save("p1", { name: "MEMORY.md", description: "", body: "index" });
    await memory.save("p2", { name: "a.md", description: "", body: "other project" });

    expect((await memory.list("p1")).map((file) => file.name)).toEqual(["MEMORY.md", "b.md"]);
    expect((await memory.list("p2")).map((file) => file.name)).toEqual(["a.md"]);
    expect(await memory.get("p2", "b.md")).toBeNull();
  });

  test("removes a file once and reports the second removal as absent", async () => {
    await memory.save("p1", { name: "a.md", description: "", body: "a" });
    await memory.save("p2", { name: "a.md", description: "", body: "a" });

    expect(await memory.remove("p1", "a.md")).toBe(true);
    expect(await memory.remove("p1", "a.md")).toBe(false);

    expect(await memory.list("p1")).toEqual([]);
    expect(await memory.list("p2")).toHaveLength(1);
  });

  test("cannot save into a project that does not exist", async () => {
    await expect(
      memory.save("missing", { name: "a.md", description: "", body: "a" }),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
