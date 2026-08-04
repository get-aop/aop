import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
    expect(result.stderr).toContain("claude, opencode, codex, or pi");
    expect(result.output).not.toContain("Downloading");
  });

  test("passes preflight when GitHub auth and one runtime CLI are available", async () => {
    const binDir = await createBinDir({
      uname: unameStub(),
      git: successStub(),
      gh: ghStub({ authenticated: true }),
      pi: successStub(),
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

const createBinDir = async (commands: Record<string, string>): Promise<string> => {
  const binDir = await mkdtemp(join(tmpdir(), "aop-install-preflight-bin-"));

  for (const [name, content] of Object.entries(commands)) {
    const path = join(binDir, name);
    await writeFile(path, content);
    await chmod(path, 0o755);
  }

  return binDir;
};

const unameStub = (): string => `#!/bin/sh
if [ "$1" = "-s" ]; then
  echo Darwin
else
  echo arm64
fi
`;

const successStub = (): string => `#!/bin/sh
exit 0
`;

const ghStub = ({ authenticated }: { authenticated: boolean }): string => `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  ${authenticated ? "exit 0" : "exit 1"}
fi
exit 0
`;
