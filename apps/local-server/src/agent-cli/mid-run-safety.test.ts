import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectUpdatePlan } from "./install-method.ts";
import { probeCli, runWithTimeout } from "./probe.ts";
import { testCli, waitUntil } from "./test-utils.ts";
import { runPlannedUpdate } from "./update-runner.ts";

// A native install updated while a run is in flight, end to end with real processes and a
// stand-in for Claude Code's installer: the run keeps the binary it started on and finishes, and
// the next launch is the new version. The stand-in is harsher than the real installer, which
// keeps the last few versions: it deletes the version the run is executing.

const SHELL_ENV = { PATH: "/usr/bin:/bin" };
const root = mkdtempSync(join(tmpdir(), "aop-mid-run-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const home = join(root, "home");
const versions = join(home, ".local", "share", "claude", "versions");
const bin = join(home, ".local", "bin");
const link = join(bin, "claude");

// A "run" prints its version, works for a while, then prints it again; `update` installs 2.0.1.
const versionScript = (version: string) => `#!/bin/sh
if [ "$1" = "--version" ]; then echo "${version} (Claude Code)"; exit 0; fi
if [ "$1" = "update" ]; then
  cat > "${versions}/2.0.1.tmp" <<'NEXT'
${nextScript()}
NEXT
  chmod 755 "${versions}/2.0.1.tmp"
  mv "${versions}/2.0.1.tmp" "${versions}/2.0.1"
  ln -s "${versions}/2.0.1" "${link}.new" && mv -f "${link}.new" "${link}"
  rm -f "${versions}/${version}"
  echo "Updated to 2.0.1"
  exit 0
fi
echo "start ${version}"
sleep 1
echo "end ${version}"
`;

const nextScript = () =>
  `#!/bin/sh
if [ "$1" = "--version" ]; then echo "2.0.1 (Claude Code)"; exit 0; fi
echo "start 2.0.1"; echo "end 2.0.1"`;

describe("updating a native install while a run is in flight", () => {
  test("the run finishes on its version and the next launch runs the new one", async () => {
    mkdirSync(versions, { recursive: true });
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(versions, "2.0.0"), versionScript("2.0.0"));
    chmodSync(join(versions, "2.0.0"), 0o755);
    symlinkSync(join(versions, "2.0.0"), link);

    const cli = testCli();
    const probeDeps = {
      locate: () => link,
      resolveLink: async (path: string) => (await import("node:fs/promises")).realpath(path),
      run: (argv: string[], timeoutMs: number) =>
        runWithTimeout(argv, timeoutMs, { env: SHELL_ENV }),
    };
    const before = await probeCli(cli, probeDeps);
    expect(before.version).toBe("2.0.0");

    // The run in flight, launched through the symlink as a session launches it.
    const runLog = join(root, "run.log");
    const run = Bun.spawn({ cmd: [link, "-p", "hello"], stdout: Bun.file(runLog), env: SHELL_ENV });
    await waitUntil(
      () => existsSync(runLog) && readFileSync(runLog, "utf-8").includes("start 2.0.0"),
    );

    const plan = detectUpdatePlan(cli, { path: link, realPath: before.realPath ?? "" }, "latest");
    expect(plan.method).toBe("native");
    expect(plan.safeWhileRunning).toBe(true);
    let last: { state?: string; toVersion?: string | null } = {};
    await runPlannedUpdate(
      {
        definition: cli,
        plan: { ...plan, command: plan.command ?? [] },
        fromVersion: "2.0.0",
        latest: "2.0.1",
      },
      {
        activeRunCount: async () => 1,
        runCommand: (argv, onOutput) => runWithTimeout(argv, 10_000, { env: SHELL_ENV, onOutput }),
        reprobe: () => probeCli(cli, probeDeps),
        onChange: (patch) => {
          last = { ...last, ...patch };
        },
        sleep: Bun.sleep,
        deferPollMs: 1,
        isStopped: () => false,
      },
    );
    expect(last).toMatchObject({ state: "succeeded", toVersion: "2.0.1" });

    expect(await run.exited).toBe(0);
    expect(readFileSync(runLog, "utf-8")).toBe("start 2.0.0\nend 2.0.0\n");

    const next = Bun.spawn({ cmd: [link, "-p", "again"], stdout: "pipe", env: SHELL_ENV });
    expect(await new Response(next.stdout).text()).toBe("start 2.0.1\nend 2.0.1\n");
  });
});
