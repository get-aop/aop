import { describe, expect, test } from "bun:test";
import {
  remoteScript,
  SshExecHost,
  sanitizeForwardedEnv,
  shellQuote,
  sshInvocation,
} from "./exec-host-ssh.ts";

const baseConfig = {
  id: "ehost_1",
  name: "Desktop",
  host: "192.168.1.10",
  user: "dev",
  port: 2222,
  identityFile: "/home/dev/.ssh/id_ed25519",
  remoteRoot: "/home/dev/aop",
};

describe("shellQuote", () => {
  test("quotes spaces, quotes, and dollar signs for POSIX sh", () => {
    expect(shellQuote("simple")).toBe("'simple'");
    expect(shellQuote("has space")).toBe("'has space'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
    expect(shellQuote("$HOME")).toBe("'$HOME'");
  });
});

describe("sshInvocation", () => {
  test("builds BatchMode ssh argv with port, identity, and user@host", () => {
    expect(sshInvocation(baseConfig, "echo hi")).toEqual([
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      "-p",
      "2222",
      "-i",
      "/home/dev/.ssh/id_ed25519",
      "dev@192.168.1.10",
      "--",
      "echo hi",
    ]);
  });

  test("omits optional port, identity, and user when unset", () => {
    expect(
      sshInvocation(
        {
          id: "ehost_2",
          name: "Bare",
          host: "mac.local",
          remoteRoot: "/tmp",
        },
        "true",
      ),
    ).toEqual(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", "mac.local", "--", "true"]);
  });
});

describe("remoteScript", () => {
  test("cd's into quoted cwd and exec's the command", () => {
    expect(remoteScript("/tmp/work tree", ["claude", "--print"])).toBe(
      "cd '/tmp/work tree' && exec 'claude' '--print'",
    );
  });

  test("omits cd when cwd is undefined", () => {
    expect(remoteScript(undefined, ["true"])).toBe("exec 'true'");
  });
});

describe("SshExecHost", () => {
  test("kind is ssh", () => {
    const host = new SshExecHost(baseConfig, {
      pathMap: [{ local: "/local/wt", remote: "/remote/wt" }],
    });
    expect(host.kind).toBe("ssh");
  });

  test("maps cwd through pathMap when spawning", () => {
    const spawns: string[][] = [];
    const host = new SshExecHost(baseConfig, {
      pathMap: [{ local: "/local/wt", remote: "/remote/wt" }],
      spawnImpl: (cmd) => {
        spawns.push([...cmd]);
        return { pid: 1, exited: Promise.resolve(0) } as unknown as Bun.Subprocess;
      },
    });

    host.spawn({
      cmd: ["echo", "hi"],
      cwd: "/local/wt",
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(spawns).toHaveLength(1);
    const argv = spawns[0] ?? [];
    expect(argv[0]).toBe("ssh");
    expect(argv.at(-1)).toContain("cd '/remote/wt'");
    expect(argv.at(-1)).toContain("exec 'echo' 'hi'");
  });

  test("throws a descriptive error for unmapped cwd", () => {
    const host = new SshExecHost(baseConfig, {
      pathMap: [{ local: "/local/wt", remote: "/remote/wt" }],
    });
    expect(() =>
      host.spawn({
        cmd: ["echo", "hi"],
        cwd: "/other/path",
        stdin: "ignore",
      }),
    ).toThrow(/unmapped|path map|cwd/i);
  });

  test("sends env over stdin when stdin is ignore", () => {
    let capturedStdin: unknown;
    const host = new SshExecHost(baseConfig, {
      pathMap: [],
      spawnImpl: (cmd, options) => {
        capturedStdin = options?.stdin;
        expect(cmd.at(-1)).toContain("set -a");
        return {
          pid: 1,
          exited: Promise.resolve(0),
          stdin: {
            write: () => {},
            end: () => {},
          },
        } as unknown as Bun.Subprocess;
      },
    });

    host.spawn({
      cmd: ["claude"],
      env: { SECRET: "s3cret", AOP_STEP_ID: "step_1" },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    // When env is forwarded over stdin, Bun.spawn receives a pipe (or the
    // impl receives the payload via write). Either way the remote command
    // must use the bootstrap and secrets must not appear in argv.
    const remoteCmd = (host as unknown as { lastRemoteCommand?: string }).lastRemoteCommand;
    if (remoteCmd) {
      expect(remoteCmd).not.toContain("s3cret");
      expect(remoteCmd).toContain("set -a");
    }
    expect(capturedStdin).toBeDefined();
  });

  test("env-over-stdin payload is shell-quoted KEY=value lines", () => {
    expect(SshExecHost.buildEnvStdinPayload({ FOO: "bar", BAZ: "qux" })).toBe(
      "FOO='bar'\nBAZ='qux'\n",
    );
  });

  test("sanitizeForwardedEnv keeps task env but drops machine-identity vars", () => {
    expect(
      sanitizeForwardedEnv({
        AOP_STEP_ID: "step_1",
        CUSTOM_RUNTIME_URL: "http://runtime:1234",
        PATH: "/opt/homebrew/bin:/usr/bin",
        HOME: "/Users/local-user",
        TMPDIR: "/var/folders/xx",
        SSH_AUTH_SOCK: "/tmp/agent.sock",
        TERM: "xterm-256color",
        XPC_SERVICE_NAME: "0",
        __CF_USER_TEXT_ENCODING: "0x1F5",
        UNSET_VALUE: undefined,
      }),
    ).toEqual({
      AOP_STEP_ID: "step_1",
      CUSTOM_RUNTIME_URL: "http://runtime:1234",
    });
  });

  test("sanitizeForwardedEnv drops non-POSIX names and newline values (eval safety)", () => {
    expect(
      sanitizeForwardedEnv({
        "BASH_FUNC_greet%%": "() {\n  rm -rf /tmp/x\n}",
        MULTILINE_PEM: "line1\nline2",
        SAFE: "single line",
      }),
    ).toEqual({ SAFE: "single line" });
  });

  test("spawn forwards only sanitized env in the inline-export fallback", () => {
    const spawns: string[][] = [];
    const host = new SshExecHost(baseConfig, {
      pathMap: [],
      spawnImpl: (cmd) => {
        spawns.push([...cmd]);
        return { pid: 1, exited: Promise.resolve(0) } as unknown as Bun.Subprocess;
      },
    });

    host.spawn({
      cmd: ["true"],
      env: { AOP_TASK_ID: "task_1", PATH: "/local/only", HOME: "/Users/local" },
      stdin: "pipe",
      stdout: "ignore",
      stderr: "ignore",
    });

    const remote = spawns[0]?.at(-1) ?? "";
    expect(remote).toContain("export AOP_TASK_ID='task_1'");
    expect(remote).not.toContain("/local/only");
    expect(remote).not.toContain("/Users/local");
  });

  test("commandExists probes remotely via command -v", () => {
    const spawns: string[][] = [];
    const host = new SshExecHost(baseConfig, {
      pathMap: [],
      spawnImpl: (cmd) => {
        spawns.push([...cmd]);
        return { pid: 1, exited: Promise.resolve(0) } as unknown as Bun.Subprocess;
      },
    });

    void host.commandExists("git");
    const remote = spawns[0]?.at(-1) ?? "";
    expect(remote).toContain("command -v");
    expect(remote).toContain("git");
  });
});
