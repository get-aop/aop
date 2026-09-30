import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBinDir, successStub, unameStub } from "./test-utils.ts";

const INSTALLER = join(import.meta.dir, "install.sh");
const VERSION = "9.9.9";
const BINARY = "aop-darwin-arm64";

// A release is a folder of files the installer reads through a file:// URL, so these tests run the
// real script against a scratch HOME and prefix without a network or a real service manager.
describe("install.sh host install", () => {
  test("--no-service installs the binary and dashboard and touches no service manager", async () => {
    const box = await createBox();

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`Installed AOP ${VERSION}`);
    expect(result.output).toContain("Skipping the background service (--no-service)");
    expect(result.output).toContain(`Start the host with: ${box.prefix}/bin/aop run`);
    expect(result.output).toContain("Then open the dashboard at http://");
    expect(result.output).not.toContain("Dashboard: http://");
    const version = await box.runInstalled(["--version"]);
    expect(version).toBe(`aop/${VERSION} stub`);
    expect(existsSync(join(box.prefix, "bin", "dashboard", "index.html"))).toBe(true);
    expect(await box.serviceCalls()).toEqual([]);
    expect(existsSync(join(box.home, "Library"))).toBe(false);
    expect(existsSync(join(box.home, ".config"))).toBe(false);
  });

  test("AOP_INSTALL_NO_SERVICE=1 does the same as the flag", async () => {
    const box = await createBox();

    const result = await box.install(["--version", VERSION], { AOP_INSTALL_NO_SERVICE: "1" });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Skipping the background service (--no-service)");
    expect(await box.serviceCalls()).toEqual([]);
  });

  test("a copy stamped by the release installs that release with no --version", async () => {
    const box = await createBox();
    const stamped = join(box.root, "install-stamped.sh");
    const source = await readFile(INSTALLER, "utf8");
    await writeFile(
      stamped,
      source.replace(/^DEFAULT_VERSION="__AOP_VERSION__"/m, `DEFAULT_VERSION="${VERSION}"`),
    );

    const result = await box.install(["--no-service"], {}, stamped);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`Installing AOP ${VERSION}`);
    expect(await box.runInstalled(["--version"])).toBe(`aop/${VERSION} stub`);
  });

  test("an unstamped copy refuses to guess a version", async () => {
    const box = await createBox();

    const result = await box.install(["--no-service"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not tied to a release. Pass --version");
    expect(existsSync(join(box.prefix, "bin", "aop"))).toBe(false);
  });

  test("never asks the network for a latest-version file", async () => {
    const script = await readFile(INSTALLER, "utf8");

    expect(script).not.toContain("latest/version");
  });

  test("rejects a binary whose checksum does not match", async () => {
    const box = await createBox({ corruptBinary: true });

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Checksum verification failed");
    expect(existsSync(join(box.prefix, "bin", "aop"))).toBe(false);
  });

  test("points Windows users to the desktop app instead of installing a host", async () => {
    const box = await createBox({ uname: unameStub("MINGW64_NT-10.0", "x86_64") });

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("The AOP host runs on macOS and Linux");
    expect(result.stderr).toContain("install the desktop app");
    expect(result.stderr).not.toContain("WSL");
  });

  test("registers a launchd service and waits for the host when the service step is on", async () => {
    const box = await createBox();
    const health = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ ok: true }),
    });

    try {
      const result = await box.install(["--version", VERSION], {
        AOP_LOCAL_SERVER_PORT: String(health.port),
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("Started AOP local server with launchd");
      expect(result.output).toContain("AOP local server is ready");
      const plist = await readFile(
        join(box.home, "Library", "LaunchAgents", "com.aop.local-server.plist"),
        "utf8",
      );
      expect(plist).toContain(`<string>${box.prefix}/bin/aop</string>`);
      expect(plist).toContain(`<string>${health.port}</string>`);
      expect(plist).not.toContain("CHECKOUT");
      expect(await box.serviceCalls()).toContain(
        `launchctl load -w ${join(box.home, "Library", "LaunchAgents", "com.aop.local-server.plist")}`,
      );
    } finally {
      await health.stop(true);
    }
  });
});

const roots: string[] = [];

afterEach(async () => {
  const dirs = roots.splice(0);
  await Promise.all(dirs.map((dir) => rm(dir, { force: true, recursive: true })));
});

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

interface BoxOptions {
  corruptBinary?: boolean;
  uname?: string;
}

const createBox = async ({ corruptBinary = false, uname = unameStub() }: BoxOptions = {}) => {
  const root = await mkdtemp(join(tmpdir(), "aop-install-flow-"));
  roots.push(root);
  const home = join(root, "home");
  const prefix = join(root, "prefix");
  const releases = join(root, "releases");
  const callLog = join(root, "service-calls.log");
  await mkdir(home, { recursive: true });
  await writeReleaseFiles(join(releases, `v${VERSION}`), corruptBinary);

  // Tripwires for everything that would reach the real machine. Each one records the call; the
  // tests assert which calls happened.
  const recorder = (name: string): string =>
    `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> '${callLog}'\nexit 0\n`;
  const binDir = await createBinDir({
    uname,
    launchctl: recorder("launchctl"),
    systemctl: recorder("systemctl"),
    lsof: recorder("lsof"),
    codesign: successStub(),
  });
  roots.push(binDir);

  const install = (
    args: string[],
    env: Record<string, string> = {},
    script = INSTALLER,
  ): Promise<RunResult> =>
    run(["/bin/sh", script, "--prefix", prefix, ...args], {
      HOME: home,
      PATH: `${binDir}:/usr/bin:/bin`,
      TMPDIR: root,
      AOP_SKIP_PREFLIGHT: "1",
      AOP_RELEASES_URL: `file://${releases}`,
      AOP_LOCAL_SERVER_PORT: "1",
      ...env,
    });

  return {
    root,
    home,
    prefix,
    install,
    runInstalled: async (args: string[]) =>
      (await run([join(prefix, "bin", "aop"), ...args], { HOME: home })).stdout.trim(),
    serviceCalls: async () =>
      (await readFile(callLog, "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.startsWith("launchctl") || line.startsWith("systemctl")),
  };
};

// The binary is a stub that answers --version, packaged with a real checksum manifest.
const writeReleaseFiles = async (dir: string, corruptBinary: boolean): Promise<void> => {
  await mkdir(dir, { recursive: true });
  const binary = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "aop/${VERSION} stub"; fi\n`;
  await writeFile(join(dir, BINARY), binary, { mode: 0o755 });

  const assets = join(dir, "assets");
  await mkdir(join(assets, "dashboard"), { recursive: true });
  await writeFile(join(assets, "dashboard", "index.html"), "<html></html>");
  await run(["tar", "-czf", join(dir, "runtime-assets.tar.gz"), "-C", assets, "."], {});
  await rm(assets, { recursive: true });

  const sums = await Promise.all(
    [BINARY, "runtime-assets.tar.gz"].map(async (name) => {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(await Bun.file(join(dir, name)).arrayBuffer());
      return `${hasher.digest("hex")}  ${name}`;
    }),
  );
  await writeFile(join(dir, "checksums.sha256"), `${sums.join("\n")}\n`);
  if (corruptBinary) await writeFile(join(dir, BINARY), `${binary}# tampered\n`, { mode: 0o755 });
};

const run = async (cmd: string[], env: Record<string, string>): Promise<RunResult> => {
  const proc = Bun.spawn({
    cmd,
    env: { PATH: "/usr/bin:/bin", ...env },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr, output: `${stdout}\n${stderr}` };
};
