import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scratchDir } from "./test-utils.ts";
import { acquireUpdateLock } from "./update-lock.ts";

describe("acquireUpdateLock", () => {
  test("lets one run hold it at a time, and the next take it once released", async () => {
    const home = await scratchDir("lock");

    const release = acquireUpdateLock(home);
    expect(release).not.toBeNull();
    expect(acquireUpdateLock(home)).toBeNull();

    release?.();
    expect(existsSync(join(home, "update.lock"))).toBe(false);
    expect(acquireUpdateLock(home)).not.toBeNull();
  });

  test("takes over a lock left by a run that died or ran past any update", async () => {
    const home = await scratchDir("lock");
    writeFileSync(join(home, "update.lock"), JSON.stringify({ pid: 2 ** 22 + 7, at: Date.now() }));
    expect(acquireUpdateLock(home)).not.toBeNull();

    const old = await scratchDir("lock");
    writeFileSync(join(old, "update.lock"), JSON.stringify({ pid: process.pid, at: 0 }));
    expect(acquireUpdateLock(old)).not.toBeNull();
  });
});
