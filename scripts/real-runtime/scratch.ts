import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { shellOk } from "./shell.ts";

/**
 * The private scratch repository the harness's threads push to and open pull requests in. Its
 * `main` holds a tiny bun project and a workflow whose only job, `ci`, runs `bun test`, so a
 * thread that adds a wrong test gets a check that really fails on GitHub.
 */
export const SCRATCH_REPO = "get-aop/aop-harness-scratch";
export const SCRATCH_URL = `https://github.com/${SCRATCH_REPO}.git`;

export const SCRATCH_FILES: Record<string, string> = {
  "README.md":
    "# aop-harness-scratch\n\nScratch repository for AOP's real-runtime harness. Safe to reset.\n",
  "package.json": `${JSON.stringify({ name: "aop-harness-scratch", type: "module", scripts: { test: "bun test" } }, null, 2)}\n`,
  "src/greeting.ts": `export const greet = (name: string): string => \`Hello, \${name}!\`;\n`,
  "src/greeting.test.ts": `import { expect, test } from "bun:test";
import { greet } from "./greeting";

test("greet", () => {
  expect(greet("AOP")).toBe("Hello, AOP!");
});
`,
  ".github/workflows/ci.yml": `name: ci

on:
  pull_request:
  push:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun test
`,
};

/**
 * Clones the scratch repository into `dest` and makes sure its `main` has the files above,
 * pushing one commit when it lacks them. `git` is the command that reaches GitHub: plain git,
 * or this environment's wrapper (see the shim in stack.ts).
 */
export const prepareScratch = async (git: string[], dest: string): Promise<void> => {
  await shellOk([...git, "clone", SCRATCH_URL, dest]);
  const inRepo = (...args: string[]) => shellOk([...git, "-C", dest, ...args]);
  const written = await writeMissing(dest);
  if (written.length === 0) return;
  await inRepo("config", "user.email", "harness@aop.local");
  await inRepo("config", "user.name", "AOP real-runtime harness");
  await inRepo("add", ...written);
  await inRepo("commit", "-m", "Add the harness project and its ci workflow");
  await inRepo("push", "origin", "HEAD:main");
};

const writeMissing = async (dest: string): Promise<string[]> => {
  const written: string[] = [];
  for (const [path, content] of Object.entries(SCRATCH_FILES)) {
    const target = join(dest, path);
    if (await Bun.file(target).exists()) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    written.push(path);
  }
  return written;
};
