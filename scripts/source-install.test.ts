import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  chmod as chmodFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildInstallSuccessMessage,
  buildLaunchdPlist,
  buildOpenBrowserCommand,
  buildSystemdUnit,
  type InstallDependencies,
  installFromSource,
  openDashboardInBrowser,
  parseInstallerArgs,
} from "./source-install";

const tempDirs: string[] = [];
const originalBunInstall = process.env.BUN_INSTALL;
const originalLocalServerUrl = process.env.AOP_LOCAL_SERVER_URL;
const originalLicenseServerUrl = process.env.AOP_LICENSE_SERVER_URL;
const originalCheckoutProUrl = process.env.AOP_CHECKOUT_PRO_URL;
const originalCheckoutTeamUrl = process.env.AOP_CHECKOUT_TEAM_URL;

beforeEach(() => {
  delete process.env.BUN_INSTALL;
  delete process.env.AOP_LOCAL_SERVER_URL;
  delete process.env.AOP_LICENSE_SERVER_URL;
  delete process.env.AOP_CHECKOUT_PRO_URL;
  delete process.env.AOP_CHECKOUT_TEAM_URL;
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  restoreEnv("BUN_INSTALL", originalBunInstall);
  restoreEnv("AOP_LOCAL_SERVER_URL", originalLocalServerUrl);
  restoreEnv("AOP_LICENSE_SERVER_URL", originalLicenseServerUrl);
  restoreEnv("AOP_CHECKOUT_PRO_URL", originalCheckoutProUrl);
  restoreEnv("AOP_CHECKOUT_TEAM_URL", originalCheckoutTeamUrl);
});

describe("parseInstallerArgs", () => {
  test("recognizes help flags without side effects", () => {
    expect(parseInstallerArgs(["--help"])).toEqual({ mode: "help" });
    expect(parseInstallerArgs(["-h"])).toEqual({ mode: "help" });
  });

  test("rejects unknown flags", () => {
    expect(() => parseInstallerArgs(["--wat"])).toThrow('Unknown argument "--wat"');
  });
});

describe("install shell", () => {
  test("falls back to npx when bun is not on PATH", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "aop-install-shell-"));
    tempDirs.push(tempDir);
    const fakeBinDir = join(tempDir, "bin");
    const argsPath = join(tempDir, "npx-args.txt");
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      join(fakeBinDir, "npx"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argsPath)}\n`,
    );
    await chmodFile(join(fakeBinDir, "npx"), 0o755);

    const proc = Bun.spawn({
      cmd: ["./install", "--help"],
      env: { ...process.env, PATH: `${fakeBinDir}:/usr/bin:/bin` },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await proc.exited).toBe(0);
    expect(await readFile(argsPath, "utf8")).toBe(
      ["--yes", "bun", join(process.cwd(), "scripts", "source-install.ts"), "--help", ""].join(
        "\n",
      ),
    );
  });
});

describe("buildLaunchdPlist", () => {
  test("renders a launch agent that runs the local server with the bundled dashboard", () => {
    const plist = buildLaunchdPlist({
      bunPath: "/opt/homebrew/bin/bun",
      dashboardStaticPath: "/Users/marcelo/src/aop-mono/apps/dashboard/dist",
      logPath: "/Users/marcelo/.aop/logs/local-server.log",
      localServerPort: "25150",
      localServerUrl: "http://localhost:25150",
      serviceName: "com.aop.local-server",
      workspaceDir: "/Users/marcelo/src/aop-mono/aop",
    });

    expect(plist).toContain("<string>/opt/homebrew/bin/bun</string>");
    expect(plist).toContain("<string>apps/local-server/src/run.ts</string>");
    expect(plist).toContain("<string>/Users/marcelo/src/aop-mono/aop</string>");
    expect(plist).toContain("<string>/Users/marcelo/.aop/logs/local-server.log</string>");
    expect(plist).toContain("<key>NODE_ENV</key>");
    expect(plist).toContain("<string>production</string>");
    expect(plist).toContain("<key>PATH</key>");
    expect(plist).toContain("<string>/opt/homebrew/bin");
    expect(plist).toContain("<key>AOP_LOCAL_SERVER_PORT</key>");
    expect(plist).toContain("<string>25150</string>");
    expect(plist).toContain("<key>AOP_LOCAL_SERVER_URL</key>");
    expect(plist).toContain("<string>http://localhost:25150</string>");
    expect(plist).toContain("<key>DASHBOARD_STATIC_PATH</key>");
    expect(plist).toContain("<string>/Users/marcelo/src/aop-mono/apps/dashboard/dist</string>");
  });
});

describe("buildSystemdUnit", () => {
  test("renders a user service that runs the local server with the bundled dashboard", () => {
    const unit = buildSystemdUnit({
      bunPath: "/home/marcelo/.bun/bin/bun",
      dashboardStaticPath: "/home/marcelo/src/aop-mono/apps/dashboard/dist",
      logPath: "/home/marcelo/.aop/logs/local-server.log",
      localServerPort: "25150",
      localServerUrl: "http://localhost:25150",
      serviceName: "aop-local-server",
      workspaceDir: "/home/marcelo/src/aop-mono/aop",
    });

    expect(unit).toContain("Description=AOP Local Server");
    expect(unit).toContain("WorkingDirectory=/home/marcelo/src/aop-mono/aop");
    expect(unit).toContain("ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts");
    expect(unit).toContain("Environment=NODE_ENV=production");
    expect(unit).toContain("Environment=PATH=/home/marcelo/.bun/bin");
    expect(unit).toContain("Environment=AOP_LOCAL_SERVER_PORT=25150");
    expect(unit).toContain("Environment=AOP_LOCAL_SERVER_URL=http://localhost:25150");
    expect(unit).toContain("Environment=AOP_LOG_DIR=/home/marcelo/.aop/logs");
    expect(unit).toContain(
      "Environment=DASHBOARD_STATIC_PATH=/home/marcelo/src/aop-mono/apps/dashboard/dist",
    );
  });

  test("persists hosted licensing environment variables for paid installs", () => {
    process.env.AOP_LICENSE_SERVER_URL = "https://aop-license.up.railway.app";
    process.env.AOP_CHECKOUT_PRO_URL = "https://aop.lemonsqueezy.com/buy/pro";
    process.env.AOP_CHECKOUT_TEAM_URL = "https://aop.lemonsqueezy.com/buy/team";

    const unit = buildSystemdUnit({
      bunPath: "/home/marcelo/.bun/bin/bun",
      dashboardStaticPath: "/home/marcelo/src/aop-mono/apps/dashboard/dist",
      logPath: "/home/marcelo/.aop/logs/local-server.log",
      localServerPort: "25150",
      localServerUrl: "http://localhost:25150",
      serviceName: "aop-local-server",
      workspaceDir: "/home/marcelo/src/aop-mono/aop",
    });

    expect(unit).toContain("Environment=AOP_LICENSE_SERVER_URL=https://aop-license.up.railway.app");
    expect(unit).toContain("Environment=AOP_CHECKOUT_PRO_URL=https://aop.lemonsqueezy.com/buy/pro");
    expect(unit).toContain(
      "Environment=AOP_CHECKOUT_TEAM_URL=https://aop.lemonsqueezy.com/buy/team",
    );
  });
});

describe("buildInstallSuccessMessage", () => {
  test("includes the default dashboard url", () => {
    expect(buildInstallSuccessMessage()).toContain("http://aop.localhost:25150");
  });

  test("uses the configured dashboard url when provided", () => {
    expect(buildInstallSuccessMessage("http://localhost:3002")).toContain("http://localhost:3002");
  });
});

describe("buildOpenBrowserCommand", () => {
  test("uses open on macOS", () => {
    expect(buildOpenBrowserCommand("http://localhost:25150", "darwin")).toEqual([
      "open",
      "http://localhost:25150",
    ]);
  });

  test("uses xdg-open on Linux", () => {
    expect(buildOpenBrowserCommand("http://localhost:25150", "linux")).toEqual([
      "xdg-open",
      "http://localhost:25150",
    ]);
  });
});

describe("openDashboardInBrowser", () => {
  test("opens the dashboard url with the platform browser command", async () => {
    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const originalCi = process.env.CI;
    delete process.env.CI;

    try {
      await openDashboardInBrowser("http://localhost:25150", {
        platform: "darwin",
        run,
      });
    } finally {
      restoreEnv("CI", originalCi);
    }

    expect(commands).toEqual([["open", "http://localhost:25150"]]);
  });

  test("skips opening the browser in CI", async () => {
    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const originalCi = process.env.CI;
    process.env.CI = "true";

    await openDashboardInBrowser("http://localhost:25150", {
      platform: "darwin",
      run,
    });

    expect(commands).toEqual([]);
    restoreEnv("CI", originalCi);
  });
});

describe("installFromSource", () => {
  test("writes the CLI shim to the Bun global bin when running the installer through npx", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-npx-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-npx-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

    const writeFile = mock(async () => undefined);
    const chmod = mock(async () => undefined);

    await installFromSource({
      refresh: false,
      platform: "linux",
      dependencies: {
        chmod,
        mkdir: mock(async () => undefined),
        run: mock(async () => undefined),
        writeFile,
      } satisfies Partial<InstallDependencies>,
      homeDir,
      bunPath: "/tmp/npm-cache/_npx/abc/node_modules/bun/bin/bun.exe",
      workspaceDir,
    });

    const shimPath = join(homeDir, ".bun", "bin", "aop");
    expect(writeFile).toHaveBeenCalledWith(shimPath, expect.stringContaining("exec npx --yes bun"));
    expect(chmod).toHaveBeenCalledWith(shimPath, 0o755);
  });

  test("replaces the bun-link symlink without overwriting the CLI entrypoint", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-symlink-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-symlink-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

    const shimPath = join(homeDir, ".bun", "bin", "aop");
    const cliEntryPath = join(workspaceDir, "apps", "cli", "src", "main.ts");
    await mkdir(join(homeDir, ".bun", "bin"), { recursive: true });
    await mkdir(join(workspaceDir, "apps", "cli", "src"), { recursive: true });
    await writeFile(cliEntryPath, "original cli entry\n");
    await symlink(cliEntryPath, shimPath);

    await installFromSource({
      refresh: false,
      platform: "linux",
      dependencies: {
        run: mock(async () => undefined),
      } satisfies Partial<InstallDependencies>,
      homeDir,
      bunPath: "/tmp/npm-cache/_npx/abc/node_modules/bun/bin/bun.exe",
      workspaceDir,
    });

    expect((await lstat(shimPath)).isSymbolicLink()).toBe(false);
    expect(await readFile(cliEntryPath, "utf8")).toBe("original cli entry\n");
    expect(await readFile(shimPath, "utf8")).toContain("exec npx --yes bun");
  });

  test("builds the dashboard, links the CLI, writes a systemd unit, and starts it on Linux", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-linux-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-linux-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const writeFile = mock(async () => undefined);
    const mkdir = mock(async () => undefined);
    const chmod = mock(async () => undefined);

    await installFromSource({
      refresh: false,
      platform: "linux",
      dependencies: {
        chmod,
        mkdir,
        run,
        writeFile,
      } satisfies Partial<InstallDependencies>,
      homeDir,
      bunPath: "/home/marcelo/.bun/bin/bun",
      workspaceDir,
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bun", "run", "build"],
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "aop-local-server.service"],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      join(homeDir, ".config", "systemd", "user", "aop-local-server.service"),
      expect.stringContaining(
        "ExecStart=/home/marcelo/.bun/bin/bun run apps/local-server/src/run.ts",
      ),
    );
    const shimPath = join(homeDir, ".bun", "bin", "aop");
    expect(writeFile).toHaveBeenCalledWith(
      shimPath,
      expect.stringContaining('exec "/home/marcelo/.bun/bin/bun"'),
    );
    expect(writeFile).toHaveBeenCalledWith(shimPath, expect.stringContaining("exec npx --yes bun"));
    expect(writeFile).toHaveBeenCalledWith(
      shimPath,
      expect.stringContaining(`${workspaceDir}/apps/cli/src/main.ts`),
    );
    expect(chmod).toHaveBeenCalledWith(shimPath, 0o755);
    expect(mkdir).toHaveBeenCalled();
  });

  test("builds the dashboard, links the CLI, writes a launch agent, and loads it on macOS", async () => {
    const homeDir = await mkdtemp(join(tmpdir(), "aop-install-macos-home-"));
    const workspaceDir = await mkdtemp(join(tmpdir(), "aop-install-macos-workspace-"));
    tempDirs.push(homeDir, workspaceDir);

    const commands: string[][] = [];
    const run = mock(async (command: string[]) => {
      commands.push(command);
    });
    const writeFile = mock(async () => undefined);
    const mkdir = mock(async () => undefined);
    const chmod = mock(async () => undefined);

    await installFromSource({
      refresh: false,
      platform: "darwin",
      dependencies: {
        chmod,
        mkdir,
        run,
        writeFile,
      } satisfies Partial<InstallDependencies>,
      homeDir,
      bunPath: "/opt/homebrew/bin/bun",
      workspaceDir,
    });

    expect(commands).toEqual([
      ["bun", "install", "--ignore-scripts"],
      ["bun", "link"],
      ["bun", "run", "build"],
      [
        "launchctl",
        "unload",
        join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      ],
      [
        "launchctl",
        "load",
        "-w",
        join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      ],
    ]);
    expect(writeFile).toHaveBeenCalledWith(
      join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      expect.stringContaining("<string>/opt/homebrew/bin/bun</string>"),
    );
    expect(chmod).toHaveBeenCalledWith(
      join(homeDir, "Library", "LaunchAgents", "com.aop.local-server.plist"),
      0o644,
    );
    expect(mkdir).toHaveBeenCalled();
  });

  test("refreshes any existing install before rebuilding when refresh is enabled", async () => {
    const events: string[] = [];
    const uninstall = mock(async () => {
      events.push("uninstall");
    });
    const run = mock(async (command: string[]) => {
      events.push(`run:${command.join(" ")}`);
    });

    await installFromSource({
      platform: "linux",
      refresh: true,
      uninstall,
      dependencies: {
        chmod: mock(async () => undefined),
        mkdir: mock(async () => undefined),
        run,
        writeFile: mock(async () => undefined),
      } satisfies Partial<InstallDependencies>,
      homeDir: "/tmp/aop-home",
      bunPath: "/usr/bin/bun",
      workspaceDir: "/tmp/aop-workspace",
    });

    expect(events[0]).toBe("uninstall");
    expect(events).toContain("run:bun install --ignore-scripts");
    expect(events).toContain("run:bun run build");
    expect(uninstall).toHaveBeenCalledTimes(1);
  });
});

const restoreEnv = (key: string, value: string | undefined): void => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};
