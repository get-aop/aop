import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExecHost, ExecHostSpawnSpec } from "@aop/infra";
import { syncFromRemote, syncToRemote } from "./remote-workspace.ts";

const run = async (cmd: string[], cwd: string): Promise<void> => {
  const proc = Bun.spawn({ cmd, cwd, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const code = await proc.exited;
  if (code !== 0) {
    const err = await new Response(proc.stderr).text();
    throw new Error(`${cmd.join(" ")} failed: ${err}`);
  }
};

/** Map `localhost:` rsync targets to plain paths and drop `-e <ssh args>` for loopback. */
const toLoopbackCmd = (cmd: string[]): string[] => {
  const mapped = cmd.map((arg) =>
    arg.startsWith("localhost:") ? arg.slice("localhost:".length) : arg,
  );
  const cleaned: string[] = [];
  let skipNext = false;
  for (const arg of mapped) {
    if (skipNext) {
      skipNext = false;
    } else if (arg === "-e") {
      skipNext = true;
    } else {
      cleaned.push(arg);
    }
  }
  return cleaned;
};

/** Loopback host: runs shell against a second temp directory as if it were remote. */
class LoopbackHost implements ExecHost {
  readonly kind = "ssh" as const;
  constructor(private readonly remoteRoot: string) {}

  spawn(spec: ExecHostSpawnSpec): Bun.Subprocess {
    return Bun.spawn({
      cmd: [...spec.cmd],
      cwd: spec.cwd ?? this.remoteRoot,
      env: process.env as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  shell(script: string): Bun.Subprocess {
    return Bun.spawn({
      cmd: ["sh", "-lc", script],
      cwd: this.remoteRoot,
      env: process.env as Record<string, string>,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  async commandExists(name: string): Promise<boolean> {
    const proc = Bun.spawn({
      cmd: ["sh", "-lc", `command -v ${name}`],
      stdout: "ignore",
      stderr: "ignore",
    });
    return (await proc.exited) === 0;
  }
}

describe("remote-workspace loopback sync", () => {
  let localRepo: string;
  let worktree: string;
  let remoteRoot: string;
  let remoteWorkdir: string;

  beforeEach(async () => {
    const base = mkdtempSync(join(tmpdir(), "aop-remote-ws-"));
    localRepo = join(base, "repo");
    worktree = join(base, "wt");
    remoteRoot = join(base, "remote");
    remoteWorkdir = join(remoteRoot, "task_1");
    mkdirSync(localRepo, { recursive: true });
    mkdirSync(remoteRoot, { recursive: true });

    await run(["git", "init", "-b", "main"], localRepo);
    await run(["git", "config", "user.email", "test@example.com"], localRepo);
    await run(["git", "config", "user.name", "Test"], localRepo);
    writeFileSync(join(localRepo, "README.md"), "hello\n");
    await run(["git", "add", "."], localRepo);
    await run(["git", "commit", "-m", "init"], localRepo);
    await run(["git", "branch", "task-branch"], localRepo);
    await run(["git", "worktree", "add", worktree, "task-branch"], localRepo);
  });

  afterEach(() => {
    const base = join(localRepo, "..");
    if (existsSync(base)) rmSync(base, { recursive: true, force: true });
  });

  test("syncToRemote copies uncommitted files; syncFromRemote brings remote edits back", async () => {
    writeFileSync(join(worktree, "local-only.txt"), "from-local\n");

    const config = {
      id: "ehost_loop",
      name: "Loop",
      host: "localhost",
      remoteRoot,
    };

    const host = new LoopbackHost(remoteRoot);
    const runLocal = async (cmd: string[], options?: { cwd?: string }) => {
      const proc = Bun.spawn({
        cmd: toLoopbackCmd(cmd),
        cwd: options?.cwd,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [exitCode, stdout, stderr] = await Promise.all([
        proc.exited,
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    };

    await syncToRemote(
      {
        config,
        worktreePath: worktree,
        taskId: "task_1",
        branch: "task-branch",
        repoPath: localRepo,
      },
      {
        runLocal,
        createHost: () => host,
      },
    );

    expect(existsSync(join(remoteWorkdir, "local-only.txt"))).toBe(true);
    expect(readFileSync(join(remoteWorkdir, "local-only.txt"), "utf-8")).toBe("from-local\n");

    // Simulate the remote agent: a commit, an uncommitted edit to a TRACKED file
    // (must survive the branch reset on sync-back), and untracked files.
    await run(["git", "config", "user.email", "remote@example.com"], remoteWorkdir);
    await run(["git", "config", "user.name", "Remote"], remoteWorkdir);
    writeFileSync(join(remoteWorkdir, "committed-remotely.txt"), "committed\n");
    await run(["git", "add", "committed-remotely.txt"], remoteWorkdir);
    await run(["git", "commit", "-m", "remote work"], remoteWorkdir);
    writeFileSync(join(remoteWorkdir, "README.md"), "tracked-edit\n");
    writeFileSync(join(remoteWorkdir, "remote-edit.txt"), "from-remote\n");
    writeFileSync(join(remoteWorkdir, "local-only.txt"), "modified-remotely\n");

    await syncFromRemote(
      {
        config,
        worktreePath: worktree,
        taskId: "task_1",
        branch: "task-branch",
        repoPath: localRepo,
      },
      {
        runLocal,
        createHost: () => host,
      },
    );

    expect(readFileSync(join(worktree, "remote-edit.txt"), "utf-8")).toBe("from-remote\n");
    expect(readFileSync(join(worktree, "local-only.txt"), "utf-8")).toBe("modified-remotely\n");
    // Remote commit landed on the local branch…
    expect(readFileSync(join(worktree, "committed-remotely.txt"), "utf-8")).toBe("committed\n");
    const log = Bun.spawnSync({ cmd: ["git", "log", "-1", "--format=%s"], cwd: worktree });
    expect(log.stdout.toString().trim()).toBe("remote work");
    // …and the uncommitted tracked edit survived the branch reset.
    expect(readFileSync(join(worktree, "README.md"), "utf-8")).toBe("tracked-edit\n");
    // The return bundle never leaks into the local worktree.
    expect(existsSync(join(worktree, "aop-return.bundle"))).toBe(false);
    expect(existsSync(join(worktree, "task_1.return.bundle"))).toBe(false);
  });
});
