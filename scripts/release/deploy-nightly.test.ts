import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseReleaseFeed } from "@aop/common";
import { generateReleaseChecksums } from "./checksums.ts";
import { writeLatestMacYml } from "./macos-updater.ts";

const SCRIPT = join(import.meta.dir, "deploy-nightly.sh");
const VERSION = "0.10.7-nightly.20261002.14";
const COMMIT = "c2133573";
const BUCKET = "nightly-test";
const PUBLIC_BASE = "https://releases.invalid";
const FILES = [
  "aop-linux-x64",
  "aop-linux-arm64",
  "aop-darwin-x64",
  "aop-darwin-arm64",
  "aop-macos-x64.dmg",
  "aop-macos-arm64.dmg",
  "aop-macos-x64.zip",
  "aop-macos-arm64.zip",
  "runtime-assets.tar.gz",
];

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("deploy-nightly.sh", () => {
  test("uploads only under nightly/, probes before pointing at the build, and publishes install.sh last", async () => {
    const h = await createHarness();

    const result = await h.run();

    expect(result.exitCode).toBe(0);
    const uploads = await h.uploads();
    expect(uploads.length).toBeGreaterThan(0);
    for (const key of uploads) expect(key).toStartWith("nightly/");
    expect(uploads.at(-1)).toBe("nightly/install.sh");

    const calls = await h.calls();
    const at = (needle: string) => calls.findIndex((line) => line.includes(needle));
    const lastVersioned = Math.max(...FILES.map((name) => at(`nightly/v${VERSION}/${name} `)));
    const probes = FILES.map((name) =>
      at(`curl -fsSIL -o /dev/null ${PUBLIC_BASE}/nightly/v${VERSION}/${name}`),
    );
    for (const probe of probes) expect(probe).toBeGreaterThan(lastVersioned);
    for (const pointer of [
      "latest/latest-mac.yml",
      "releases/latest.json",
      "latest/aop-macos-arm64.dmg",
    ]) {
      expect(at(`nightly/${pointer} `)).toBeGreaterThan(Math.max(...probes));
    }
    // The pointer flips only after its versioned document is up and reachable.
    expect(at("nightly/releases/latest.json ")).toBeGreaterThan(
      at(`curl -fsSIL -o /dev/null ${PUBLIC_BASE}/nightly/releases/v${VERSION}.json`),
    );
    for (const call of calls.filter((line) => line.startsWith("aws"))) {
      expect(call).toContain(`s3://${BUCKET}/nightly/`);
      expect(call).toContain("--endpoint-url https://r2.invalid");
    }
  });

  test("publishes a nightly feed with the commit and a stamped nightly install.sh", async () => {
    const h = await createHarness();

    expect((await h.run()).exitCode).toBe(0);

    const feed = JSON.parse(await h.uploaded("nightly/releases/latest.json"));
    expect(feed).toMatchObject({ version: VERSION, commit: COMMIT, channel: "nightly" });
    expect(parseReleaseFeed(feed, "nightly")?.assets["aop-darwin-arm64"]?.url).toBe(
      `${PUBLIC_BASE}/nightly/v${VERSION}/aop-darwin-arm64`,
    );
    const mac = await h.uploaded("nightly/latest/latest-mac.yml");
    expect(mac).toContain(`url: ${PUBLIC_BASE}/nightly/v${VERSION}/aop-macos-arm64.zip`);
    const script = await h.uploaded("nightly/install.sh");
    expect(script).toContain(`DEFAULT_VERSION="${VERSION}"`);
    expect(script).toMatch(/^CHANNEL="nightly"$/m);
  });

  test("keeps the newest builds and deletes the rest only after install.sh is live", async () => {
    const published = Array.from({ length: 3 }, (_, i) => ({
      version: `0.10.7-nightly.20261001.${i + 1}`,
      commit: `old${i}`,
      publishedAt: "2026-10-01T00:00:00Z",
    }));
    const h = await createHarness({ index: { builds: published }, keep: 3 });

    expect((await h.run()).exitCode).toBe(0);

    const index = JSON.parse(await h.uploaded("nightly/releases/index.json"));
    expect(index.builds.map((build: { version: string }) => build.version)).toEqual([
      VERSION,
      "0.10.7-nightly.20261001.3",
      "0.10.7-nightly.20261001.2",
    ]);
    const calls = await h.calls();
    const removals = calls.filter((line) => line.startsWith("aws s3 rm"));
    expect(removals).toEqual([
      `aws s3 rm s3://${BUCKET}/nightly/v0.10.7-nightly.20261001.1/ --recursive --endpoint-url https://r2.invalid --only-show-errors`,
      `aws s3 rm s3://${BUCKET}/nightly/releases/v0.10.7-nightly.20261001.1.json --endpoint-url https://r2.invalid --only-show-errors`,
      `aws s3 rm s3://${BUCKET}/nightly/releases/v0.10.7-nightly.20261001.1.md --endpoint-url https://r2.invalid --only-show-errors`,
    ]);
    const installAt = calls.findIndex((line) => line.includes("nightly/install.sh"));
    expect(calls.findIndex((line) => line.startsWith("aws s3 rm"))).toBeGreaterThan(installAt);
  });

  test("refuses to run without the nightly bucket's credentials", async () => {
    const h = await createHarness();

    const result = await h.run({ AOP_NIGHTLY_R2_SECRET_ACCESS_KEY: "" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Missing nightly R2 env");
    expect(await h.calls()).toEqual([]);
  });

  test("a dry run needs no credentials and touches neither the bucket nor the network", async () => {
    const h = await createHarness();

    const result = await h.run({
      AOP_NIGHTLY_DRY_RUN: "1",
      AOP_NIGHTLY_R2_ACCESS_KEY_ID: "",
      AOP_NIGHTLY_R2_SECRET_ACCESS_KEY: "",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`dry-run: aws s3 cp ${h.releaseDir}/aop-darwin-arm64 s3://`);
    expect(result.stdout).toContain("Dry run: nothing was published.");
    expect(result.stdout).not.toContain("Published AOP Nightly");
    expect(result.stdout).toContain("nightly/install.sh");
    expect(await h.calls()).toEqual([]);
  });

  test("refuses a build with a missing file before uploading anything", async () => {
    const h = await createHarness();
    await rm(join(h.releaseDir, "aop-macos-arm64.zip"));

    const result = await h.run();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("aop-macos-arm64.zip");
    expect(await h.calls()).toEqual([]);
  });
});

interface HarnessOptions {
  index?: unknown;
  keep?: number;
}

const createHarness = async ({ index, keep = 10 }: HarnessOptions = {}) => {
  const root = await mkdtemp(join(tmpdir(), "aop-deploy-nightly-"));
  roots.push(root);
  const releaseDir = join(root, "release");
  const bucket = join(root, "bucket");
  const bin = join(root, "bin");
  const log = join(root, "calls.log");
  await mkdir(releaseDir, { recursive: true });
  await mkdir(bucket, { recursive: true });
  await mkdir(bin, { recursive: true });
  for (const name of FILES) await writeFile(join(releaseDir, name), `contents of ${name}`);
  await writeLatestMacYml(releaseDir, VERSION, "2026-10-02T00:00:00.000Z");
  await generateReleaseChecksums(releaseDir);
  if (index) {
    await mkdir(join(bucket, "nightly", "releases"), { recursive: true });
    await writeFile(join(bucket, "nightly", "releases", "index.json"), JSON.stringify(index));
  }
  // `aws s3 cp <src> <dst>` copies into or out of a folder standing in for the bucket; every
  // call is recorded. `curl` answers every probe.
  await writeFile(
    join(bin, "aws"),
    `#!/bin/sh
printf 'aws %s\\n' "$*" >> '${log}'
[ "$2" = "cp" ] || exit 0
src="$3"; dst="$4"
case "$src" in s3://*) src="${bucket}/\${src#s3://*/}";; esac
case "$dst" in s3://*) dst="${bucket}/\${dst#s3://*/}"; mkdir -p "$(dirname "$dst")";; esac
[ -f "$src" ] || exit 1
cp "$src" "$dst"
`,
  );
  await writeFile(join(bin, "curl"), `#!/bin/sh\nprintf 'curl %s\\n' "$*" >> '${log}'\nexit 0\n`);
  await chmod(join(bin, "aws"), 0o755);
  await chmod(join(bin, "curl"), 0o755);
  const notes = join(root, "notes.md");
  await writeFile(notes, "* a change");

  const run = async (env: Record<string, string> = {}) => {
    const proc = Bun.spawn(["bash", SCRIPT, VERSION, COMMIT], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        HOME: root,
        RELEASE_DIR: releaseDir,
        AOP_RELEASE_NOTES_FILE: notes,
        AOP_NIGHTLY_PUBLIC_BASE_URL: PUBLIC_BASE,
        AOP_NIGHTLY_KEEP: String(keep),
        AOP_NIGHTLY_R2_ACCESS_KEY_ID: "id",
        AOP_NIGHTLY_R2_SECRET_ACCESS_KEY: "secret",
        AOP_NIGHTLY_R2_ENDPOINT: "https://r2.invalid",
        AOP_NIGHTLY_R2_BUCKET: BUCKET,
        AOP_RELEASES_VERIFY_DELAY_SECONDS: "0",
        ...env,
      },
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  };

  const calls = async (): Promise<string[]> =>
    (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean);

  return {
    releaseDir,
    run,
    calls,
    // The bucket keys written, in order (the read of index.json is not a write).
    uploads: async () =>
      (await calls())
        .filter((line) => line.startsWith("aws s3 cp") && !line.startsWith("aws s3 cp s3://"))
        .map((line) => line.match(/ s3:\/\/[^/]+\/(\S+)/)?.[1] ?? ""),
    uploaded: (key: string) => readFile(join(bucket, key), "utf8"),
  };
};
