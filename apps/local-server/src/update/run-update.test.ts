import { afterEach, describe, expect, test } from "bun:test";
import { detectPlatform, hostAssetName } from "./install-layout.ts";
import { runUpdate } from "./run-update.ts";
import { runsUnderRosetta } from "./system.ts";
import { createInstall, PLATFORM, scratchDir, startFakeRelease } from "./test-utils.ts";
import { readOutcomeRecord } from "./update-files.ts";

const stopAfter: Array<() => void> = [];
afterEach(() => {
  for (const stop of stopAfter.splice(0)) stop();
});

const run = async (input: Partial<Parameters<typeof runUpdate>[0]> & { feedUrl?: string }) => {
  const lines: string[] = [];
  const code = await runUpdate({
    buildVersion: "0.9.51+abc1234",
    execPath: "/irrelevant/aop",
    checkOnly: false,
    print: (line) => lines.push(line),
    // No token from the shell running the tests: GitHub must never be asked.
    env: {
      ...process.env,
      AOP_GITHUB_TOKEN: "",
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      AOP_RELEASE_FEED_URL: input.feedUrl ?? "http://127.0.0.1:1",
    },
    ...input,
  });
  return { code, output: lines.join("\n") };
};

// Updates a scratch install from a fake feed. runUpdate updates the machine running the tests, so
// the release carries this machine's binary; the data folder is a scratch one, never the person's.
const updateScratchInstall = async (release: { corruptBinary?: boolean }) => {
  const layout = await createInstall("0.9.51");
  const thisMachine = detectPlatform(process.platform, process.arch, runsUnderRosetta());
  const fake = await startFakeRelease({
    version: "0.10.0",
    ...release,
    binaryAsset: hostAssetName(thisMachine ?? PLATFORM),
  });
  stopAfter.push(fake.stop);
  const home = await scratchDir("aop-home");
  const previousHome = process.env.AOP_HOME;
  process.env.AOP_HOME = home;
  try {
    return { ...(await run({ execPath: layout.binaryPath, feedUrl: fake.url })), home };
  } finally {
    if (previousHome === undefined) delete process.env.AOP_HOME;
    else process.env.AOP_HOME = previousHome;
  }
};

describe("runUpdate", () => {
  test("--check says a newer release exists and where its notes are, and changes nothing", async () => {
    const release = await startFakeRelease({ version: "0.10.0" });
    stopAfter.push(release.stop);

    const { code, output } = await run({ checkOnly: true, feedUrl: release.url });

    expect(code).toBe(0);
    expect(output).toContain("AOP 0.10.0 is available (you have 0.9.51)");
    expect(output).toContain(`Release notes: ${release.url}/releases/v0.10.0.md`);
    expect(release.requests.filter((line) => line.startsWith("/v0.10.0/"))).toEqual([]);
  });

  test("--check says so when there is nothing newer", async () => {
    const release = await startFakeRelease({ version: "0.9.51" });
    stopAfter.push(release.stop);

    const { code, output } = await run({ checkOnly: true, feedUrl: release.url });

    expect(code).toBe(0);
    expect(output).toBe("AOP 0.9.51 is up to date.");
  });

  test("--check reports a feed it cannot reach as a failure", async () => {
    const { code, output } = await run({ checkOnly: true });

    expect(code).toBe(1);
    expect(output).toContain("Update failed: Could not reach the release feed");
  });

  test("an agent's turn may look but not update the host it runs on", async () => {
    const env = { ...process.env, AOP_CHAT_SESSION_ID: "session-1" };

    const update = await run({ env });
    const check = await run({ env, checkOnly: true });

    expect(update.code).toBe(1);
    expect(update.output).toContain("An agent can't update the host it runs on");
    expect(check.output).not.toContain("An agent can't");
  });

  test("a source checkout is told to pull instead", async () => {
    const { code, output } = await run({ buildVersion: undefined });

    expect(code).toBe(1);
    expect(output).toContain("runs from source");
  });

  test("a binary that is not the installed aop is not replaced", async () => {
    const { code, output } = await run({ execPath: "/usr/local/bin/bun" });

    expect(code).toBe(1);
    expect(output).toContain('replaces the installed "aop" binary');
  });

  test("a failed update leaves a record the host can show", async () => {
    const { code, output, home } = await updateScratchInstall({ corruptBinary: true });

    expect(code).toBe(1);
    expect(output).toContain("Update failed: Checksum verification failed");
    const record = await readOutcomeRecord(home);
    expect(record).toMatchObject({
      ok: false,
      from: "0.9.51",
      error: expect.stringContaining("Checksum verification failed"),
    });
    expect(Date.parse(record?.startedAt ?? "")).toBeLessThanOrEqual(Date.parse(record?.at ?? ""));
  });

  test("a host started by hand is recorded as installed, needing a restart, not as failed", async () => {
    // Nothing supervises a scratch install, so this is the `aop run` case.
    const { code, output, home } = await updateScratchInstall({});

    expect(code).toBe(0);
    expect(output).toContain("Restart the host to use 0.10.0: stop `aop run` and start it again.");
    expect(await readOutcomeRecord(home)).toMatchObject({
      ok: true,
      from: "0.9.51",
      to: "0.10.0",
      error: null,
      restartNeeded: true,
      startedAt: expect.any(String),
    });
  });
});
