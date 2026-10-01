import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReleaseFeed } from "@aop/common";
import { generateReleaseChecksums } from "./checksums.ts";

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
const OPTIONAL_ARTIFACTS = ["aop-windows-x64-setup.exe", "aop-windows-x64-setup.exe.blockmap"];
const FEED_POINTERS = [
  "latest/latest.yml",
  "repos/get-aop/aop-mono/releases/latest",
  "releases/latest.json",
];

describe("deploy-r2.sh release commit point", () => {
  test("publishes the stamped install script last, after verifying every artifact on the public CDN", async () => {
    const harness = await createHarness();

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const lines = await harness.readCallLog();
    // The install script is the commit point, so it must be the very last call.
    const installIndex = uploadIndex(lines, "install.sh");
    expect(installIndex).toBe(lines.length - 1);

    const uploaded = [...REQUIRED_ARTIFACTS, ...OPTIONAL_ARTIFACTS];
    const uploadIndexes = uploaded.map((name) => uploadIndex(lines, `v${VERSION}/${name}`));
    const verifyIndexes = uploaded.map((name) => verifyIndex(lines, name));
    for (const index of [...uploadIndexes, ...verifyIndexes]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }

    // Every verification probe runs after every versioned upload and before the
    // durable desktop download URLs and the install script go live.
    const lastUpload = Math.max(...uploadIndexes);
    const firstVerify = Math.min(...verifyIndexes);
    expect(firstVerify).toBeGreaterThan(lastUpload);
    for (const key of [
      "latest/aop-macos-arm64.dmg",
      "latest/aop-macos-x64.dmg",
      "latest/aop-windows-x64-setup.exe",
    ]) {
      const aliasIndex = uploadIndex(lines, key);
      expect(aliasIndex).toBeGreaterThan(Math.max(...verifyIndexes));
      expect(aliasIndex).toBeLessThan(installIndex);
    }
  });

  test("stamps the release version into the uploaded install script", async () => {
    const harness = await createHarness();

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const uploadedScript = await harness.readUploadedFile("install.sh");
    expect(uploadedScript).toContain(`DEFAULT_VERSION="${VERSION}"`);
    expect(uploadedScript).not.toContain('DEFAULT_VERSION="__AOP_VERSION__"');
    // The guard that rejects an unstamped copy keeps its placeholder so it still works.
    expect(uploadedScript).toContain('[ "$DEFAULT_VERSION" = "__AOP_VERSION__" ]');
  });

  test("publishes the release feed after the artifacts are public and before install.sh", async () => {
    const harness = await createHarness();

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const lines = await harness.readCallLog();
    const lastArtifactProbe = Math.max(
      ...REQUIRED_ARTIFACTS.map((name) => verifyIndex(lines, name)),
    );
    const versioned = ["releases/v9.9.9.json", "releases/v9.9.9.md"].map((key) =>
      uploadIndex(lines, key),
    );
    const feedProbes = ["releases/v9.9.9.json", "releases/v9.9.9.md"].map((key) =>
      lines.indexOf(`curl -fsSIL -o /dev/null ${PUBLIC_BASE}/${key}`),
    );
    const pointers = FEED_POINTERS.map((key) => uploadIndex(lines, key));
    for (const index of [...versioned, ...feedProbes, ...pointers]) {
      expect(index).toBeGreaterThan(lastArtifactProbe);
    }
    expect(Math.min(...feedProbes)).toBeGreaterThan(Math.max(...versioned));
    expect(Math.min(...pointers)).toBeGreaterThan(Math.max(...feedProbes));
    expect(uploadIndex(lines, "releases/latest.json")).toBe(Math.max(...pointers));
    expect(Math.max(...pointers)).toBeLessThan(uploadIndex(lines, "install.sh"));
    expect(lines[uploadIndex(lines, "releases/latest.json")]).toContain(
      "--content-type application/json",
    );
  });

  test("the published feed describes this release with the notes and public URLs", async () => {
    const harness = await createHarness();
    await harness.writeNotes("## What's Changed\n* The feed");

    await harness.run();

    const release = parseReleaseFeed(
      JSON.parse(await harness.readUploadedFile("releases/latest.json")),
    );
    expect(release?.version).toBe(VERSION);
    expect(release?.notes).toBe("## What's Changed\n* The feed");
    expect(release?.url).toBe(`${PUBLIC_BASE}/releases/v${VERSION}.md`);
    expect(release?.assets["aop-darwin-arm64"]?.url).toBe(artifactUrl("aop-darwin-arm64"));
    expect(await harness.readUploadedFile("latest/latest.yml")).toContain(
      `url: ${artifactUrl("aop-windows-x64-setup.exe")}`,
    );
  });

  test("retires latest/version and publishes no Windows host binary or PowerShell installer", async () => {
    const harness = await createHarness();

    await harness.run();

    const lines = await harness.readCallLog();
    expect(lines.filter((line) => line.includes("latest/version"))).toEqual([
      `npx --yes wrangler@4 r2 object delete ${BUCKET}/latest/version --remote`,
    ]);
    expect(lines.some((line) => line.includes("install.ps1"))).toBe(false);
    expect(lines.some((line) => line.includes("aop-windows-x64.exe"))).toBe(false);
  });

  test("rides out CDN propagation by retrying until an artifact appears", async () => {
    const harness = await createHarness();
    await harness.markUnavailableOnce("aop-darwin-arm64");

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    const lines = await harness.readCallLog();
    expect(countProbes(lines, "aop-darwin-arm64")).toBe(2);
    expect(uploadIndex(lines, "install.sh")).toBe(lines.length - 1);
  });

  test("aborts without publishing the install script when an artifact never becomes available", async () => {
    const harness = await createHarness();
    await harness.markUnavailable("aop-darwin-arm64");

    const result = await harness.run({ AOP_RELEASES_VERIFY_ATTEMPTS: "2" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      `Release file never became publicly available: ${artifactUrl("aop-darwin-arm64")}`,
    );
    const lines = await harness.readCallLog();
    // Nobody is pointed at a release with missing assets.
    expect(uploadIndex(lines, "install.sh")).toBe(-1);
    expect(uploadIndex(lines, "latest/aop-macos-arm64.dmg")).toBe(-1);
    expect(uploadIndex(lines, "releases/latest.json")).toBe(-1);
    expect(countProbes(lines, "aop-darwin-arm64")).toBe(2);
  });

  test("skips verification and the alias for optional artifacts that were not built", async () => {
    const harness = await createHarness({ withOptionalArtifacts: false });

    const result = await harness.run();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Skipping optional release artifact: aop-windows-x64-setup.exe",
    );
    const lines = await harness.readCallLog();
    expect(lines.some((line) => line.includes("aop-windows-x64"))).toBe(false);
    expect(uploadIndex(lines, "install.sh")).toBe(lines.length - 1);
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
  readUploadedFile: (key: string) => Promise<string>;
  writeNotes: (notes: string) => Promise<void>;
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
  const stubs = artifacts.filter((name) => name !== "checksums.sha256");
  await Promise.all(stubs.map((name) => writeFile(join(releaseDir, name), `stub ${name}`)));
  if (withOptionalArtifacts) {
    await writeFile(
      join(releaseDir, "latest.yml"),
      "version: 9.9.9\nfiles:\n  - url: aop-windows-x64-setup.exe\npath: aop-windows-x64-setup.exe\n",
    );
  }
  await generateReleaseChecksums(releaseDir);

  const binDir = join(workDir, "bin");
  await mkdir(binDir);
  await writeStub(join(binDir, "npx"), NPX_STUB);
  await writeStub(join(binDir, "curl"), CURL_STUB);

  const callLogPath = join(workDir, "calls.log");
  const uploadsDir = join(workDir, "uploads");
  await mkdir(uploadsDir);
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
        uploadsDir,
        workDir,
      }),
    readCallLog: async () => {
      const content = await readFile(callLogPath, "utf8").catch(() => "");
      return content.split("\n").filter((line) => line.length > 0);
    },
    markUnavailable: (name) => appendFile(unavailablePath, `${artifactUrl(name)}\n`),
    markUnavailableOnce: (name) => appendFile(unavailableOncePath, `${artifactUrl(name)}\n`),
    readUploadedFile: (key) => readFile(join(uploadsDir, key.replaceAll("/", "__")), "utf8"),
    writeNotes: (notes) => writeFile(join(workDir, "notes.md"), notes),
  };
};

type RunScriptOptions = {
  binDir: string;
  callLogPath: string;
  env: Record<string, string>;
  releaseDir: string;
  unavailableOncePath: string;
  unavailablePath: string;
  uploadsDir: string;
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
      AOP_RELEASE_NOTES_FILE: join(options.workDir, "notes.md"),
      AOP_TEST_CALL_LOG: options.callLogPath,
      AOP_TEST_UPLOADS_DIR: options.uploadsDir,
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

// Records each call and keeps a copy of the uploaded file, so a test can read what the script
// actually published (the install script is stamped into a temp file that is deleted on exit).
const NPX_STUB = `#!/bin/sh
printf 'npx %s\\n' "$*" >> "$AOP_TEST_CALL_LOG"
key=""
file=""
prev=""
for arg in "$@"; do
  case "$prev" in
    put) key="$arg" ;;
    --file) file="$arg" ;;
  esac
  prev="$arg"
done
if [ -n "$key" ] && [ -n "$file" ]; then
  cp "$file" "$AOP_TEST_UPLOADS_DIR/$(printf '%s' "\${key#*/}" | sed 's#/#__#g')"
fi
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
