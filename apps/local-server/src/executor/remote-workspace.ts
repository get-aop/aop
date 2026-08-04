// Remote workspace sync for SSH execution hosts.
//
// Worktree .git files point at the main repo gitdir, so plain rsync of the worktree cannot
// carry history. Use git bundle for the branch, then rsync --exclude=.git for uncommitted
// files and task docs.

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ExecHostConfig, parseExecHostList } from "@aop/common";
import {
  type ExecHost,
  getLogger,
  SshExecHost,
  shellQuote,
  sshBaseArgs,
  sshTarget,
} from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import { remoteWorkdirForTask } from "../exec-hosts/service.ts";
import { SettingKey } from "../settings/types.ts";
import type { ExecutorContext } from "./types.ts";

const logger = getLogger("executor", "remote-workspace");

export interface RemoteWorkspaceContext {
  config: ExecHostConfig;
  worktreePath: string;
  taskId: string;
  branch: string;
  /** Local main repo path (for fetch of remote commits). */
  repoPath: string;
}

export interface RemoteWorkspaceDeps {
  /** Run a local command; injectable for tests. */
  runLocal?: (
    cmd: string[],
    options?: { cwd?: string },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  /** Create SSH host for remote shell/rsync; defaults to SshExecHost. */
  createHost?: (config: ExecHostConfig, worktreePath: string, taskId: string) => ExecHost;
}

const defaultRunLocal = async (
  cmd: string[],
  options: { cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn({
    cmd,
    cwd: options.cwd,
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

const defaultCreateHost = (
  config: ExecHostConfig,
  worktreePath: string,
  taskId: string,
): ExecHost =>
  new SshExecHost(config, {
    pathMap: [{ local: worktreePath, remote: remoteWorkdirForTask(config, taskId) }],
  });

export const syncToRemote = async (
  ctx: RemoteWorkspaceContext,
  deps: RemoteWorkspaceDeps = {},
): Promise<void> => {
  const runLocal = deps.runLocal ?? defaultRunLocal;
  const host = (deps.createHost ?? defaultCreateHost)(ctx.config, ctx.worktreePath, ctx.taskId);
  const remoteDir = remoteWorkdirForTask(ctx.config, ctx.taskId);
  const tmpDir = mkdtempSync(join(tmpdir(), "aop-remote-sync-"));
  const bundlePath = join(tmpDir, "task.bundle");

  try {
    const bundleResult = await runLocal(["git", "bundle", "create", bundlePath, ctx.branch], {
      cwd: ctx.worktreePath,
    });
    if (bundleResult.exitCode !== 0) {
      // Fallback: create bundle from HEAD if branch name fails
      const fallback = await runLocal(["git", "bundle", "create", bundlePath, "HEAD"], {
        cwd: ctx.worktreePath,
      });
      if (fallback.exitCode !== 0) {
        throw new Error(`git bundle create failed: ${fallback.stderr || fallback.stdout}`);
      }
    }

    await ensureRemoteDir(host, remoteDir);
    const remoteBundle = join(remoteDir, "task.bundle");
    await rsyncFile(runLocal, bundlePath, remoteRsyncTarget(ctx.config, remoteBundle), ctx.config);

    const remoteExists = await remoteDirExists(host, join(remoteDir, ".git"));
    if (!remoteExists) {
      // Clone into a sibling temp dir then move, because clone refuses non-empty dest.
      const cloneTmp = `${remoteDir}.clone-tmp`;
      await runRemote(
        host,
        [
          `rm -rf ${shellQuote(cloneTmp)}`,
          `git clone ${shellQuote(remoteBundle)} ${shellQuote(cloneTmp)} --branch ${shellQuote(ctx.branch)} 2>/dev/null || git clone ${shellQuote(remoteBundle)} ${shellQuote(cloneTmp)}`,
          `cp -a ${shellQuote(`${cloneTmp}/.`)} ${shellQuote(`${remoteDir}/`)}`,
          `rm -rf ${shellQuote(cloneTmp)}`,
        ].join(" && "),
      );
    } else {
      await runRemote(
        host,
        `cd ${shellQuote(remoteDir)} && git fetch ${shellQuote(remoteBundle)} && git reset --hard FETCH_HEAD`,
      );
    }

    // Overlay uncommitted worktree files (exclude .git).
    await rsyncDir(
      runLocal,
      `${ctx.worktreePath}/`,
      remoteRsyncTarget(ctx.config, `${remoteDir}/`),
      ["--exclude=.git"],
      ctx.config,
    );

    logger.info("Synced workspace to remote host", {
      taskId: ctx.taskId,
      host: ctx.config.host,
      remoteDir,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

export const syncFromRemote = async (
  ctx: RemoteWorkspaceContext,
  deps: RemoteWorkspaceDeps = {},
): Promise<void> => {
  const runLocal = deps.runLocal ?? defaultRunLocal;
  const host = (deps.createHost ?? defaultCreateHost)(ctx.config, ctx.worktreePath, ctx.taskId);
  const remoteDir = remoteWorkdirForTask(ctx.config, ctx.taskId);
  const tmpDir = mkdtempSync(join(tmpdir(), "aop-remote-sync-back-"));
  const bundlePath = join(tmpDir, "remote.bundle");

  try {
    if (!(await remoteDirExists(host, remoteDir))) {
      logger.warn("Remote workdir missing; skipping syncFromRemote", {
        taskId: ctx.taskId,
        remoteDir,
      });
      return;
    }

    // Bring remote commits over FIRST: the local branch reset must happen before the
    // file overlay, or reset --hard would clobber uncommitted remote edits to tracked
    // files that rsync just delivered. The bundle lives outside the workdir so the
    // overlay rsync never carries it into the local worktree.
    const remoteBundle = `${remoteDir}.return.bundle`;
    const bundleExit = await runRemote(
      host,
      `cd ${shellQuote(remoteDir)} && git bundle create ${shellQuote(remoteBundle)} HEAD 2>/dev/null`,
    );
    if (bundleExit === 0) {
      await rsyncFile(
        runLocal,
        remoteRsyncTarget(ctx.config, remoteBundle),
        bundlePath,
        ctx.config,
      );
      if (existsSync(bundlePath)) {
        const fetch = await runLocal(["git", "fetch", bundlePath, "HEAD:refs/aop/remote-return"], {
          cwd: ctx.repoPath,
        });
        if (fetch.exitCode === 0) {
          await runLocal(["git", "reset", "--hard", "refs/aop/remote-return"], {
            cwd: ctx.worktreePath,
          });
        }
      }
    }

    // Then overlay the remote working tree (committed + uncommitted, minus .git).
    await rsyncDir(
      runLocal,
      remoteRsyncTarget(ctx.config, `${remoteDir}/`),
      `${ctx.worktreePath}/`,
      ["--exclude=.git"],
      ctx.config,
    );

    logger.info("Synced workspace from remote host", {
      taskId: ctx.taskId,
      host: ctx.config.host,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

/** Best-effort remote process cleanup for a step id. */
export const cleanupRemoteStep = async (host: ExecHost, stepId: string): Promise<void> => {
  try {
    await runRemote(host, `pkill -f ${shellQuote(`AOP_STEP_ID=${stepId}`)} || true`);
  } catch {
    // best-effort
  }
};

/**
 * Best-effort pkill of a step's remote processes on every configured host. Step records
 * do not persist their exec host in v1, so abort/recovery broadcast to all hosts; the
 * pkill is a no-op on hosts (and for steps) that never ran remotely. Never throws.
 */
export const cleanupRemoteStepOnConfiguredHosts = async (
  ctx: Pick<LocalServerContext, "settingsRepository">,
  stepId: string,
): Promise<void> => {
  try {
    const raw = await ctx.settingsRepository.get(SettingKey.REMOTE_EXEC_HOSTS);
    const hosts = parseExecHostList(raw ?? "");
    for (const config of hosts) {
      await cleanupRemoteStep(new SshExecHost(config, { pathMap: [] }), stepId);
    }
  } catch (error) {
    logger.debug("Remote step cleanup skipped", { stepId, error: String(error) });
  }
};

export const buildRemoteWorkspaceContext = (
  config: ExecHostConfig,
  executorCtx: ExecutorContext,
  branch: string,
): RemoteWorkspaceContext => ({
  config,
  worktreePath: executorCtx.worktreePath,
  taskId: executorCtx.task.id,
  branch,
  repoPath: executorCtx.repoPath,
});

const ensureRemoteDir = async (host: ExecHost, remoteDir: string): Promise<void> => {
  await runRemote(host, `mkdir -p ${shellQuote(remoteDir)}`);
};

const remoteDirExists = async (host: ExecHost, path: string): Promise<boolean> => {
  const code = await runRemote(host, `test -e ${shellQuote(path)}`);
  return code === 0;
};

const runRemote = async (host: ExecHost, script: string): Promise<number> => {
  const proc = host.shell(script, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  return proc.exited;
};

const remoteRsyncTarget = (config: ExecHostConfig, remotePath: string): string =>
  `${sshTarget(config)}:${remotePath}`;

const rsyncFile = async (
  runLocal: NonNullable<RemoteWorkspaceDeps["runLocal"]>,
  src: string,
  dest: string,
  config: ExecHostConfig,
): Promise<void> => {
  const sshArgs = buildRsyncSshArgs(config);
  const result = await runLocal(["rsync", "-az", "-e", sshArgs, src, dest]);
  if (result.exitCode !== 0) {
    throw new Error(`rsync failed: ${result.stderr || result.stdout}`);
  }
};

const rsyncDir = async (
  runLocal: NonNullable<RemoteWorkspaceDeps["runLocal"]>,
  src: string,
  dest: string,
  extraArgs: string[] = [],
  config?: ExecHostConfig,
): Promise<void> => {
  const isRemote = dest.includes(":") || src.includes(":");
  const cmd =
    isRemote && config
      ? ["rsync", "-az", "--delete", ...extraArgs, "-e", buildRsyncSshArgs(config), src, dest]
      : ["rsync", "-az", "--delete", ...extraArgs, src, dest];
  const result = await runLocal(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`rsync failed: ${result.stderr || result.stdout}`);
  }
};

const buildRsyncSshArgs = (config: ExecHostConfig): string => sshBaseArgs(config).join(" ");
