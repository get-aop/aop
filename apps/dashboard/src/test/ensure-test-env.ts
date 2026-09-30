import { afterAll } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.NODE_ENV === undefined || process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test";
}

// Every test process gets an AOP home of its own. Without one, a test that reaches for `aopPaths`
// writes into the real ~/.aop, where two overlapping runs (or a run and the person's own AOP)
// collide on the same `repos/<id>` and `worktrees/<id>` folders, and a failed test leaves its
// folders behind. A test that needs a home of its own still sets one and restores this one.
// The folder is made under the real path of the temp directory: on macOS `/var` is a link to
// `/private/var`, and code that resolves a workspace hands back the resolved form.
const testAopHome = mkdtempSync(join(realpathSync(tmpdir()), "aop-test-home-"));
process.env.AOP_HOME = testAopHome;
// Neither `exit` nor `beforeExit` fires in a `bun test` process; a hook in a preload runs once, after the last file.
afterAll(() => rmSync(testAopHome, { recursive: true, force: true }));
