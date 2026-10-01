import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createBinDir, ghStub, successStub, unameStub } from "./test-utils.ts";

const INSTALLER = join(import.meta.dir, "install.sh");

describe("install.sh preflight", () => {
  test("defaults the user-facing dashboard URL to aop.localhost", async () => {
    const script = await readFile(INSTALLER, "utf8");
    const localServerUrlExpansion =
      "$" + "{AOP_LOCAL_SERVER_URL:-http://aop.localhost:" + "$" + "{LOCAL_SERVER_PORT}}";

    expect(script).toContain(`LOCAL_SERVER_URL="${localServerUrlExpansion}"`);
  });

  test("keeps installer health checks on numeric loopback", async () => {
    const script = await readFile(INSTALLER, "utf8");
    const portExpansion = "$" + "{LOCAL_SERVER_PORT}";
    const healthUrlExpansion = "$" + "{LOCAL_SERVER_HEALTH_URL}";

    expect(script).toContain(`LOCAL_SERVER_HEALTH_URL="http://127.0.0.1:${portExpansion}"`);
    expect(script).toContain(`local health_url="${healthUrlExpansion}/api/health"`);
  });

  test("ad-hoc signs the installed macOS binary before starting the service", async () => {
    const script = await readFile(INSTALLER, "utf8");

    expect(script).toContain('if [ "$OS" = "darwin" ] && command -v codesign');
    expect(script).toContain('codesign --force --sign - "$target"');
  });

  test("clears a stale local-server listener before starting the installed service", async () => {
    const script = await readFile(INSTALLER, "utf8");

    expect(script).toContain("clear_local_server_port");
    expect(script).toContain('lsof -tiTCP:"$LOCAL_SERVER_PORT" -sTCP:LISTEN');
    expect(script).toContain("kill $pids >/dev/null 2>&1 || true");
    expect(script).toContain("kill -9 $pids >/dev/null 2>&1 || true");
    expect(script.indexOf("stop_existing_service")).toBeLessThan(
      script.indexOf("download_release_artifacts"),
    );
    expect(script).toContain(`  clear_local_server_port
}

clear_local_server_port()`);
  });

  test("a service restart (an update) stops the host but leaves its detached agent runs running", async () => {
    const script = await readFile(INSTALLER, "utf8");
    const entrypoint = await readFile(join(import.meta.dir, "entrypoint.ts"), "utf8");

    // systemd would otherwise stop every process in the unit's control group.
    expect(script).toMatch(/^KillMode=process$/m);
    // launchd's SIGTERM must end the installed host like a crash, not run the graceful shutdown
    // that stops every chat run.
    expect(entrypoint).not.toMatch(/process\.(on|once)\(\s*"SIG/);
  });

  test("blocks before install when Git is missing", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
      gh: ghStub({ authenticated: true }),
      claude: successStub(),
    });

    const result = await runInstaller(binDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AOP preflight checks failed.");
    expect(result.stderr).toContain("Git 2.40+ is required");
    expect(result.stderr).toContain("AOP_SKIP_PREFLIGHT=1 sh");
    expect(result.output).not.toContain("Downloading");
  });

  test("blocks before install when GitHub CLI is not authenticated", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
      git: successStub(),
      gh: ghStub({ authenticated: false }),
      claude: successStub(),
    });

    const result = await runInstaller(binDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AOP preflight checks failed.");
    expect(result.stderr).toContain("GitHub CLI is not authenticated");
    expect(result.output).not.toContain("Downloading");
  });

  test("blocks before install when no supported runtime CLI is available", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
      git: successStub(),
      gh: ghStub({ authenticated: true }),
    });

    const result = await runInstaller(binDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("AOP preflight checks failed.");
    expect(result.stderr).toContain("No supported agent runtime found");
    expect(result.stderr).toContain("Claude Code (claude)");
    expect(result.output).not.toContain("Downloading");
  });

  test("passes preflight when GitHub auth and one runtime CLI are available", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
      git: successStub(),
      gh: ghStub({ authenticated: true }),
      claude: successStub(),
    });

    const result = await runInstaller(binDir);

    expect(result.output).toContain("AOP preflight checks passed.");
    expect(result.stderr).not.toContain("AOP preflight checks failed.");
  });

  test("allows advanced users to skip preflight checks", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
    });

    const result = await runInstaller(binDir, { AOP_SKIP_PREFLIGHT: "1" });

    expect(result.output).toContain("Skipping AOP preflight checks.");
    expect(result.stderr).not.toContain("AOP preflight checks failed.");
  });
});

const runInstaller = async (binDir: string, env: Record<string, string> = {}) => {
  const proc = Bun.spawn({
    cmd: ["/bin/sh", INSTALLER, "--version", "0.1.19", "--prefix", "/tmp/aop-install-test"],
    env: {
      HOME: "/tmp",
      PATH: binDir,
      TMPDIR: "/tmp",
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return {
    exitCode,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
};
