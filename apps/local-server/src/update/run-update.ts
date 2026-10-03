import { buildChannel, isNewerBuild, normalizeReleaseVersion } from "@aop/common";
import { detectInstall, selfUpdateBlock, selfUpdateRefusal } from "./install-layout.ts";
import { apiFetch, feedConfigFromEnv, fetchLatestRelease, messageOf } from "./release-feed.ts";
import { createSystemUpdateDeps } from "./system.ts";
import { type OutcomeRecord, writeOutcomeRecord } from "./update-files.ts";
import { type UpdateResult, updateHost } from "./update-host.ts";
import { acquireUpdateLock } from "./update-lock.ts";
import { restartNeededMessage } from "./update-progress.ts";

export interface RunUpdateInput {
  /** The version this binary was built as (`BUILD_VERSION`), or undefined when it is not a build. */
  buildVersion: string | undefined;
  /** This binary's own path. */
  execPath: string;
  checkOnly: boolean;
  print: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

/**
 * `aop update`: the command the terminal runs, and the one the dashboard's "Update now" starts
 * in a process of its own. Returns the process exit code.
 */
export const runUpdate = async (input: RunUpdateInput): Promise<number> => {
  const { buildVersion, print, env = process.env } = input;
  if (!input.checkOnly && env.AOP_CHAT_SESSION_ID?.trim()) {
    print(AGENT_REFUSAL);
    return 1;
  }
  if (!buildVersion?.trim()) {
    print(selfUpdateRefusal("source", input.execPath));
    return 1;
  }
  const current = normalizeReleaseVersion(buildVersion);
  const startedAt = new Date().toISOString();
  try {
    if (input.checkOnly) {
      await printCheck(current, env, print);
      return 0;
    }
    const layout = detectInstall(input.execPath, buildVersion);
    if (!layout) {
      const block = selfUpdateBlock(input.execPath, buildVersion) ?? "other-binary";
      print(selfUpdateRefusal(block, input.execPath));
      return 1;
    }
    return await runLocked(() => updateHost(createSystemUpdateDeps(layout, current, print, env)), {
      current,
      startedAt,
      print,
    });
  } catch (error) {
    if (!input.checkOnly) await recordFailure(current, startedAt, error);
    print(`Update failed: ${messageOf(error)}`);
    return 1;
  }
};

// One run at a time per install (update-lock.ts); the lock is let go however the run ends.
const runLocked = async (
  update: () => Promise<UpdateResult>,
  run: { current: string; startedAt: string; print: (line: string) => void },
): Promise<number> => {
  const release = acquireUpdateLock();
  if (!release) {
    run.print("Another update of this host is running. Let it finish, then try again.");
    return 1;
  }
  try {
    const result = await update();
    await writeOutcomeRecord(outcomeOf(result, run.current, run.startedAt));
    printResult(result, run.print);
    return 0;
  } finally {
    release();
  }
};

// The host sets AOP_CHAT_SESSION_ID in every agent turn. Updating restarts the host that runs the
// turn, so an agent leaves it to the person; the host's own update run starts without it
// (spawn-updater.ts).
const AGENT_REFUSAL = `An agent can't update the host it runs on: the restart would cut its own turn. Ask the person to use Update host in AOP, or to run \`${buildChannel().binaryName} update\` in a terminal on the host.`;

const printCheck = async (
  current: string,
  env: NodeJS.ProcessEnv,
  print: (line: string) => void,
): Promise<void> => {
  const feed = feedConfigFromEnv(env);
  const release = await fetchLatestRelease(feed, apiFetch);
  if (!isNewerBuild(release.version, current, feed.channel)) {
    print(`AOP ${current} is up to date.`);
    return;
  }
  print(
    `AOP ${release.version} is available (you have ${current}). Run \`${buildChannel().binaryName} update\` to install it.`,
  );
  print(`Release notes: ${release.url}`);
};

// The host that started this run reads the record to tell the person how it went. A host
// started by hand keeps running the old release: the new one is installed, and it says so
// ("Installed, restart needed") rather than failing.
const outcomeOf = (result: UpdateResult, current: string, startedAt: string): OutcomeRecord => {
  const at = new Date().toISOString();
  if (result.status === "up-to-date") {
    return {
      at,
      startedAt,
      ok: false,
      from: current,
      to: null,
      error: "AOP is already up to date",
    };
  }
  return {
    at,
    startedAt,
    ok: true,
    from: current,
    to: result.to,
    error: null,
    ...(result.restarted ? {} : { restartNeeded: true }),
  };
};

const recordFailure = (current: string, startedAt: string, error: unknown): Promise<void> =>
  writeOutcomeRecord({
    at: new Date().toISOString(),
    startedAt,
    ok: false,
    from: current,
    to: null,
    error: messageOf(error),
  }).catch(() => {});

const printResult = (result: UpdateResult, print: (line: string) => void): void => {
  if (result.status === "up-to-date") {
    print(`AOP ${result.current} is up to date.`);
  } else if (result.status === "updated") {
    print(`Updated AOP from ${result.from} to ${result.to}.`);
    if (!result.restarted) {
      const bin = buildChannel().binaryName;
      print(`This host was not started as a service or with \`${bin} run --background\`, so it is`);
      print(`still running the old release. ${restartNeededMessage(result.to)}.`);
    }
  }
};
