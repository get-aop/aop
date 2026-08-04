import { describe, expect, test } from "bun:test";
import { SshExecHost, type SshHostConfig } from "./exec-host-ssh.ts";

/**
 * Opt-in live SSH check. Set AOP_TEST_SSH_TARGET=user@host (or host) and
 * optionally AOP_TEST_SSH_PORT / AOP_TEST_SSH_IDENTITY.
 * Skipped in CI when the env var is unset.
 */
const target = process.env.AOP_TEST_SSH_TARGET;

const liveHostConfig = (value: string): SshHostConfig => {
  const at = value.indexOf("@");
  const user = at >= 0 ? value.slice(0, at) : undefined;
  const port = process.env.AOP_TEST_SSH_PORT ? Number(process.env.AOP_TEST_SSH_PORT) : undefined;
  const identityFile = process.env.AOP_TEST_SSH_IDENTITY;
  return {
    id: "ehost_integration",
    name: "Integration",
    host: at >= 0 ? value.slice(at + 1) : value,
    ...(user ? { user } : {}),
    ...(port ? { port } : {}),
    ...(identityFile ? { identityFile } : {}),
    remoteRoot: "/tmp",
  };
};

describe("SshExecHost live integration", () => {
  test.skipIf(!target)("commandExists(sh) and a tiny remote script succeed", async () => {
    const ssh = new SshExecHost(liveHostConfig(target ?? ""), { pathMap: [] });

    expect(await ssh.commandExists("sh")).toBe(true);

    const proc = ssh.shell('printf %s "aop-ssh-ok"', {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [code, stdout] = await Promise.all([
      proc.exited,
      new Response(proc.stdout as ReadableStream).text(),
    ]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe("aop-ssh-ok");
  });
});
