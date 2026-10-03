import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeProjectConnections } from "./connection-store.ts";
import { createJiraConnectionStore } from "./jira/jira-connection-store.ts";
import { jiraConnection } from "./jira/test-utils.ts";
import { createLinearConnectionStore } from "./linear-connection-store.ts";
import { linearConnection } from "./test-utils.ts";

describe("the tracker connection stores", () => {
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

  test("Jira's store keeps its own file, and removing a project removes both", async () => {
    const jiraDir = () => join(home, "connections", "jira");
    const jira = createJiraConnectionStore(jiraDir);
    const linear = createLinearConnectionStore(dir);
    await jira.write("proj_1", jiraConnection());
    await linear.write("proj_1", linearConnection());

    expect(await jira.read("proj_1")).toEqual(jiraConnection());
    expect(statSync(join(jiraDir(), "proj_1.json")).mode & 0o777).toBe(0o600);

    await removeProjectConnections("proj_1", (kind) => join(home, "connections", kind));
    expect(await jira.read("proj_1")).toBeNull();
    expect(await linear.read("proj_1")).toBeNull();
  });
});
