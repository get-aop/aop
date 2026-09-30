import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { harnessDir } from "./state.ts";

const NAME = `run-test-${process.pid}`;
const RUN = join(import.meta.dir, "run.ts");

describe("run.ts report", () => {
  afterAll(() => rm(harnessDir(NAME), { recursive: true, force: true }));

  test("says no scenario ran instead of crashing when the harness has no facts", async () => {
    const dir = harnessDir(NAME);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "harness.json"),
      JSON.stringify({ name: NAME, dir, gateDir: join(dir, "gate") }),
    );

    const child = Bun.spawn(["bun", RUN, "report", "--name", NAME], {
      env: { ...process.env, AOP_REAL_RUNTIME: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(out).toContain("no scenario ran");
    expect(err).not.toContain("undefined is not an object");
    expect(code).toBe(1);
  });
});
