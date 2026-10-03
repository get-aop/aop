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

  test("reinstalling the same release says so instead of an upgrade", async () => {
    const box = await createBox();
    await box.install(["--version", VERSION, "--no-service"]);

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`AOP ${VERSION} is already installed`);
    expect(result.output).toContain(`Reinstalled AOP ${VERSION}`);
    expect(result.output).not.toContain("Upgraded");
  });

  test("an upgrade names the old release by its version alone", async () => {
    const box = await createBox();
    await mkdir(join(box.prefix, "bin"), { recursive: true });
    await writeFile(
      join(box.prefix, "bin", "aop"),
      '#!/bin/sh\necho "aop/9.9.8+abc1234 darwin-arm64 bun-v1.3.14"\n',
      { mode: 0o755 },
    );

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain(`Upgraded AOP from 9.9.8 to ${VERSION}`);
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

  test("sets up computer use with the installed binary, printing the sudo command instead of running it without a terminal", async () => {
    const box = await createBox();

    const result = await box.install(["--version", VERSION, "--no-service"]);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Setting up computer use (CUA Driver)...");
    expect(await box.installedCalls()).toEqual(["computer-use setup --no-sudo"]);
  });

  test("a computer use setup that is not ready or fails never fails the install", async () => {
    const notReady = await createBox();
    const failed = await createBox();

    const a = await notReady.install(["--version", VERSION, "--no-service"], {
      AOP_STUB_EXIT: "2",
    });
    const b = await failed.install(["--version", VERSION, "--no-service"], { AOP_STUB_EXIT: "1" });

    expect(a.exitCode).toBe(0);
    expect(a.stderr).toContain("Computer use is not ready yet");
    expect(b.exitCode).toBe(0);
    expect(b.stderr).toContain("Warning: computer use setup did not finish");
  });

  test("--no-computer-use and AOP_INSTALL_NO_COMPUTER_USE=1 leave computer use alone", async () => {
    const flag = await createBox();
    const env = await createBox();

    const a = await flag.install(["--version", VERSION, "--no-service", "--no-computer-use"]);
    const b = await env.install(["--version", VERSION, "--no-service"], {
      AOP_INSTALL_NO_COMPUTER_USE: "1",
    });

    expect(a.output).toContain("Skipping computer use setup (--no-computer-use)");
    expect(b.output).toContain("Skipping computer use setup (--no-computer-use)");
    expect(await flag.installedCalls()).toEqual([]);
    expect(await env.installedCalls()).toEqual([]);
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

describe("install.sh AOP Nightly", () => {
  test("installs aop-nightly beside stable, on its own port and service, and leaves stable alone", async () => {
    const box = await createBox();
    const health = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => Response.json({ ok: true }),
    });
    const stamped = join(box.root, "install-nightly.sh");
    const source = await readFile(INSTALLER, "utf8");
    await writeFile(
      stamped,
      source
        .replace(/^DEFAULT_VERSION="__AOP_VERSION__"/m, `DEFAULT_VERSION="${VERSION}"`)
        .replace(/^CHANNEL="__AOP_CHANNEL__"/m, 'CHANNEL="nightly"'),
    );
    const agents = join(box.home, "Library", "LaunchAgents");
    await mkdir(agents, { recursive: true });
    await writeFile(join(agents, "com.aop.local-server.plist"), "stable plist");

    try {
      const result = await run(["/bin/sh", stamped], {
        HOME: box.home,
        PATH: `${box.binDir}:/usr/bin:/bin`,
        TMPDIR: box.root,
        AOP_SKIP_PREFLIGHT: "1",
        AOP_NIGHTLY_RELEASES_URL: `file://${box.releases}`,
        AOP_NIGHTLY_LOCAL_SERVER_PORT: String(health.port),
        // What a shell inside a stable AOP thread carries; a nightly install must ignore them.
        AOP_LOCAL_SERVER_PORT: "25150",
        AOP_RELEASES_URL: "file:///nowhere",
        AOP_LOG_DIR: join(box.root, "stable-logs"),
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain(`Installing AOP Nightly ${VERSION}`);
      expect(result.output).toContain("AOP Nightly local server is ready");
      const bin = join(box.home, ".aop-nightly", "bin");
      expect(existsSync(join(bin, "aop-nightly"))).toBe(true);
      expect(existsSync(join(bin, "dashboard", "index.html"))).toBe(true);
      const launcher = join(box.home, ".local", "bin", "aop-nightly");
      expect((await run([launcher, "--version"], { HOME: box.home })).stdout.trim()).toBe(
        `aop/${VERSION} stub`,
      );
      expect(existsSync(join(box.home, ".local", "bin", "aop"))).toBe(false);

      const plistPath = join(agents, "com.aop.local-server.nightly.plist");
      const plist = await readFile(plistPath, "utf8");
      expect(plist).toContain(`<string>${bin}/aop-nightly</string>`);
      expect(plist).toContain(`<string>${health.port}</string>`);
      expect(plist).toContain(`<string>${join(box.home, ".aop-nightly", "logs")}</string>`);
      expect(await readFile(join(agents, "com.aop.local-server.plist"), "utf8")).toBe(
        "stable plist",
      );
      const calls = await box.allCalls();
      expect(calls.filter((line) => line.includes("com.aop.local-server.plist"))).toEqual([]);
      expect(calls.filter((line) => line.startsWith("lsof"))).toEqual([
        `lsof -tiTCP:${health.port} -sTCP:LISTEN`,
      ]);
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
    releases,
    binDir,
    install,
    runInstalled: async (args: string[]) =>
      (await run([join(prefix, "bin", "aop"), ...args], { HOME: home })).stdout.trim(),
    /** What the installer asked of the installed binary, one call per line. */
    installedCalls: async () =>
      (await readFile(join(home, "aop-calls.log"), "utf8").catch(() => ""))
        .split("\n")
        .filter(Boolean),
    allCalls: async () =>
      (await readFile(callLog, "utf8").catch(() => "")).split("\n").filter(Boolean),
    serviceCalls: async () =>
      (await readFile(callLog, "utf8").catch(() => ""))
        .split("\n")
        .filter((line) => line.startsWith("launchctl") || line.startsWith("systemctl")),
  };
};

// The binary is a stub that answers --version, packaged with a real checksum manifest.
const writeReleaseFiles = async (dir: string, corruptBinary: boolean): Promise<void> => {
  await mkdir(dir, { recursive: true });
  // It records every other call, so a test can see what the installer asked of it.
  const binary = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "aop/${VERSION} stub"; exit 0; fi\necho "$@" >> "$HOME/aop-calls.log"\nexit "\${AOP_STUB_EXIT:-0}"\n`;
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
