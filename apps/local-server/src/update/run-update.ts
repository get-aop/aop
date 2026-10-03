import { buildChannel, isNewerBuild, normalizeReleaseVersion } from "@aop/common";
import { detectInstall, selfUpdateBlock, selfUpdateRefusal } from "./install-layout.ts";
import { apiFetch, feedConfigFromEnv, fetchLatestRelease, messageOf } from "./release-feed.ts";
import { createSystemUpdateDeps } from "./system.ts";
import { type OutcomeRecord, writeOutcomeRecord } from "./update-files.ts";
import { type UpdateResult, updateHost } from "./update-host.ts";

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
  if (!buildVersion?.trim()) {
    print(selfUpdateRefusal("source", input.execPath));
    return 1;
  }
  const current = normalizeReleaseVersion(buildVersion);
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
    const result = await updateHost(createSystemUpdateDeps(layout, current, print, env));
    await writeOutcomeRecord(outcomeOf(result, current));
    printResult(result, print);
    return 0;
  } catch (error) {
    if (!input.checkOnly) await recordFailure(current, error);
    print(`Update failed: ${messageOf(error)}`);
    return 1;
  }
};

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

// The host that started this run reads the record to tell the person how it went. A run that
// leaves the old release running is not a success from the dashboard's point of view.
const outcomeOf = (result: UpdateResult, current: string): OutcomeRecord => {
  const at = new Date().toISOString();
  if (result.status === "updated" && result.restarted) {
    return { at, ok: true, from: current, to: result.to, error: null };
  }
  const error =
    result.status === "updated"
      ? `Installed ${result.to}. Restart the host to use it.`
      : "AOP is already up to date";
  return { at, ok: false, from: current, to: null, error };
};

const recordFailure = (current: string, error: unknown): Promise<void> =>
  writeOutcomeRecord({
    at: new Date().toISOString(),
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
      print(`still running the old release. Stop it and run \`${bin} run\` to use the new one.`);
    }
  }
};
