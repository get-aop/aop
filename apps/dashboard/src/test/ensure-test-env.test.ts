import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

describe("the test environment", () => {
  test("a test process has an AOP home of its own, never the person's ~/.aop", () => {
    const home = process.env.AOP_HOME ?? "";

    expect(home).not.toBe("");
    expect(home).not.toBe(join(homedir(), ".aop"));
    expect(home.startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(existsSync(home)).toBe(true);
    expect(realpathSync(home)).toBe(home);
  });
});
