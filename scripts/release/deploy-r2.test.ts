import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "deploy-r2.sh");
const VERSION = "9.9.9";
const BUCKET = "test-bucket";
const PUBLIC_BASE = "https://releases.invalid";

const REQUIRED_ARTIFACTS = [
  "aop-linux-x64",
  "aop-linux-arm64",
  "aop-darwin-x64",
  "aop-darwin-arm64",
  "aop-macos-x64.dmg",
  "aop-macos-arm64.dmg",
  "runtime-assets.tar.gz",
  "checksums.sha256",
];
const OPTIONAL_ARTIFACTS = ["aop-windows-x64.exe", "aop-windows-x64-setup.exe"];

describe("deploy-r2.sh release commit point", () => {
  test("flips latest/version last, after verifying every artifact on the public CDN", async () => {
    const harness = await createHarness();

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const lines = await harness.readCallLog();
    const pointerIndex = uploadIndex(lines, "latest/version");
    // The pointer flip is the commit point, so it must be the very last call.
    expect(pointerIndex).toBe(lines.length - 1);

    const uploaded = [...REQUIRED_ARTIFACTS, ...OPTIONAL_ARTIFACTS];
    const uploadIndexes = uploaded.map((name) => uploadIndex(lines, `v${VERSION}/${name}`));
    const verifyIndexes = uploaded.map((name) => verifyIndex(lines, name));
    for (const index of [...uploadIndexes, ...verifyIndexes]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }

    // Every verification probe runs after every versioned upload and before the
    // flip, with only verification between the stable pointers and the flip.
    const lastUpload = Math.max(...uploadIndexes);
    const firstVerify = Math.min(...verifyIndexes);
    expect(firstVerify).toBeGreaterThan(lastUpload);
    expect(Math.max(...verifyIndexes)).toBeLessThan(pointerIndex);
    for (const key of ["install.sh", "install.ps1", "latest/aop-windows-x64-setup.exe"]) {
      const stableIndex = uploadIndex(lines, key);
      expect(stableIndex).toBeGreaterThanOrEqual(0);
      expect(stableIndex).toBeLessThan(firstVerify);
    }
  });

  test("rides out CDN propagation by retrying until an artifact appears", async () => {
    const harness = await createHarness();
    await harness.markUnavailableOnce("aop-darwin-arm64");

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const lines = await harness.readCallLog();
    expect(countProbes(lines, "aop-darwin-arm64")).toBe(2);
    expect(uploadIndex(lines, "latest/version")).toBe(lines.length - 1);
  });

  test("aborts without flipping the pointer when an artifact never becomes available", async () => {
    const harness = await createHarness();
    await harness.markUnavailable("aop-darwin-arm64");

    const result = await harness.run({ AOP_RELEASES_VERIFY_ATTEMPTS: "2" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Release artifact never became publicly available: ${artifactUrl("aop-darwin-arm64")}`,
    );
    const lines = await harness.readCallLog();
    // Installed clients must never learn about a release with missing assets.
    expect(uploadIndex(lines, "latest/version")).toBe(-1);
    expect(countProbes(lines, "aop-darwin-arm64")).toBe(2);
    // The abort happens at verification time, after the artifact uploads ran.
    expect(uploadIndex(lines, "install.sh")).toBeGreaterThanOrEqual(0);
  });

  test("skips verification for optional artifacts that were not uploaded", async () => {
    const harness = await createHarness({ withOptionalArtifacts: false });

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skipping optional release artifact: aop-windows-x64.exe");
    const lines = await harness.readCallLog();
    expect(lines.some((line) => line.includes("aop-windows-x64"))).toBe(false);
    expect(uploadIndex(lines, "latest/version")).toBe(lines.length - 1);
  });
});

const tempDirs: string[] = [];

afterEach(async () => {
  const dirs = tempDirs.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

type Harness = {
  run: (env?: Record<string, string>) => Promise<RunResult>;
  readCallLog: () => Promise<string[]>;
  markUnavailable: (name: string) => Promise<void>;
  markUnavailableOnce: (name: string) => Promise<void>;
};

type RunResult = { exitCode: number; stdout: string; stderr: string };

const createHarness = async ({ withOptionalArtifacts = true } = {}): Promise<Harness> => {
  const workDir = await mkdtemp(join(tmpdir(), "aop-deploy-r2-"));
  tempDirs.push(workDir);

  const releaseDir = join(workDir, "release");
  await mkdir(releaseDir);
  const artifacts = withOptionalArtifacts
    ? [...REQUIRED_ARTIFACTS, ...OPTIONAL_ARTIFACTS]
    : REQUIRED_ARTIFACTS;
  await Promise.all(artifacts.map((name) => writeFile(join(releaseDir, name), `stub ${name}`)));

  const binDir = join(workDir, "bin");
  await mkdir(binDir);
  await writeStub(join(binDir, "npx"), NPX_STUB);
  await writeStub(join(binDir, "curl"), CURL_STUB);

  const callLogPath = join(workDir, "calls.log");
  const unavailablePath = join(workDir, "curl-unavailable");
  const unavailableOncePath = join(workDir, "curl-unavailable-once");

  return {
    run: (env = {}) =>
      runScript({
        binDir,
        callLogPath,
        env,
        releaseDir,
        unavailableOncePath,
        unavailablePath,
        workDir,
      }),
    readCallLog: async () => {
      const content = await readFile(callLogPath, "utf8").catch(() => "");
      return content.split("\n").filter((line) => line.length > 0);
    },
    markUnavailable: (name) => appendFile(unavailablePath, `${artifactUrl(name)}\n`),
    markUnavailableOnce: (name) => appendFile(unavailableOncePath, `${artifactUrl(name)}\n`),
  };
};

type RunScriptOptions = {
  binDir: string;
  callLogPath: string;
  env: Record<string, string>;
  releaseDir: string;
  unavailableOncePath: string;
  unavailablePath: string;
  workDir: string;
};

const runScript = async (options: RunScriptOptions): Promise<RunResult> => {
  const proc = Bun.spawn({
    cmd: ["bash", SCRIPT, VERSION],
    cwd: options.workDir,
    env: {
      // Stubs shadow npx and curl; the real PATH stays behind them for bash,
      // mktemp, and the coreutils the stubs themselves use.
      PATH: `${options.binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      HOME: options.workDir,
      TMPDIR: options.workDir,
      CLOUDFLARE_API_TOKEN: "test-token",
      CLOUDFLARE_ACCOUNT_ID: "test-account",
      AOP_RELEASES_R2_BUCKET: BUCKET,
      RELEASE_DIR: options.releaseDir,
      AOP_RELEASES_PUBLIC_BASE_URL: PUBLIC_BASE,
      AOP_RELEASES_VERIFY_ATTEMPTS: "3",
      AOP_RELEASES_VERIFY_DELAY_SECONDS: "0",
      AOP_TEST_CALL_LOG: options.callLogPath,
      AOP_TEST_CURL_UNAVAILABLE: options.unavailablePath,
      AOP_TEST_CURL_UNAVAILABLE_ONCE: options.unavailableOncePath,
      ...options.env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
};

const writeStub = async (path: string, content: string): Promise<void> => {
  await writeFile(path, content);
  await chmod(path, 0o755);
};

const artifactUrl = (name: string): string => `${PUBLIC_BASE}/v${VERSION}/${name}`;

const uploadIndex = (lines: string[], key: string): number =>
  lines.findIndex((line) =>
    line.startsWith(`npx --yes wrangler@4 r2 object put ${BUCKET}/${key} `),
  );

const verifyIndex = (lines: string[], name: string): number => lines.indexOf(probeLine(name));

const countProbes = (lines: string[], name: string): number =>
  lines.filter((line) => line === probeLine(name)).length;

const probeLine = (name: string): string => `curl -fsSIL -o /dev/null ${artifactUrl(name)}`;

const NPX_STUB = `#!/bin/sh
printf 'npx %s\\n' "$*" >> "$AOP_TEST_CALL_LOG"
exit 0
`;

// Reports a URL as unavailable (curl's HTTP-error exit code 22) while it is
// listed in the unavailable fixtures; the "once" list drops the URL after one
// failure to model CDN propagation finishing between retries.
const CURL_STUB = `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$AOP_TEST_CALL_LOG"
url=""
for arg in "$@"; do url="$arg"; done
if [ -f "$AOP_TEST_CURL_UNAVAILABLE_ONCE" ] && grep -qxF "$url" "$AOP_TEST_CURL_UNAVAILABLE_ONCE"; then
  grep -vxF "$url" "$AOP_TEST_CURL_UNAVAILABLE_ONCE" > "$AOP_TEST_CURL_UNAVAILABLE_ONCE.next" || true
  mv "$AOP_TEST_CURL_UNAVAILABLE_ONCE.next" "$AOP_TEST_CURL_UNAVAILABLE_ONCE"
  exit 22
fi
if [ -f "$AOP_TEST_CURL_UNAVAILABLE" ] && grep -qxF "$url" "$AOP_TEST_CURL_UNAVAILABLE"; then
  exit 22
fi
exit 0
`;
