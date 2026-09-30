import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { createRuntimeProfileRepository, type RuntimeProfileRepository } from "./repository.ts";

describe("runtime profile repository", () => {
  let db: Kysely<Database>;
  let repository: RuntimeProfileRepository;

  beforeEach(async () => {
    db = await createTestDb();
    repository = createRuntimeProfileRepository(db);
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("creates and lists normalized profiles by name", async () => {
    await repository.create({
      name: "Zulu",
      baseProvider: "claude-code",
      command: "claude",
      model: "claude-sonnet-4-6",
      reasoning: "medium",
      fastMode: false,
    });
    const alpha = await repository.create({
      name: "Alpha",
      baseProvider: "claude-code",
      command: "cpe",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
    });

    expect(alpha.id).toStartWith("rprof_");
    expect((await repository.list()).map((profile) => profile.name)).toEqual(["Alpha", "Zulu"]);
  });

  test("updates and deletes a profile", async () => {
    const profile = await repository.create({
      name: "Claude",
      baseProvider: "claude-code",
      command: "claude",
      model: "claude-opus-5",
      reasoning: "medium",
      fastMode: false,
    });

    expect(
      await repository.update(profile.id, { name: "Work Claude", fastMode: true }),
    ).toMatchObject({ name: "Work Claude", fastMode: true });
    expect(await repository.delete(profile.id)).toBe(true);
    expect(await repository.get(profile.id)).toBeNull();
  });
});
