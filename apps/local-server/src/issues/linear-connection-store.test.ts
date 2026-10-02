import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLinearConnectionStore } from "./linear-connection-store.ts";
import { linearConnection } from "./test-utils.ts";

describe("the Linear connection store", () => {
  let home: string;
  const dir = () => join(home, "connections", "linear");

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "linear-store-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("keeps a connection in a file only its owner can read, in a directory only its owner can open", async () => {
    const store = createLinearConnectionStore(dir);
    await store.write("proj_1", linearConnection());

    expect(await store.read("proj_1")).toEqual(linearConnection());
    expect(statSync(join(dir(), "proj_1.json")).mode & 0o777).toBe(0o600);
    expect(statSync(dir()).mode & 0o777).toBe(0o700);
  });

  test("no file, a file that is not a connection, and a removed one all read as none", async () => {
    const store = createLinearConnectionStore(dir);
    expect(await store.read("proj_1")).toBeNull();

    await store.write("proj_1", linearConnection());
    writeFileSync(join(dir(), "proj_1.json"), "{not json");
    expect(await store.read("proj_1")).toBeNull();

    await store.write("proj_1", linearConnection());
    await store.remove("proj_1");
    expect(await store.read("proj_1")).toBeNull();
    await store.remove("proj_1");
  });

  test("a project id cannot reach outside the directory", async () => {
    const store = createLinearConnectionStore(dir);
    await store.write("../escape", linearConnection());
    expect(await store.read("../escape")).toEqual(linearConnection());
    expect(() => statSync(join(home, "connections", "escape.json"))).toThrow();
  });
});
