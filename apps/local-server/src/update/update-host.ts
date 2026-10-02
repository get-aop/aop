import { rm } from "node:fs/promises";
import { isNewerBuild } from "@aop/common";
import type { HostPlatform, InstallLayout } from "./install-layout.ts";
import { type FeedConfig, type FetchFn, fetchLatestRelease, messageOf } from "./release-feed.ts";
import {
  detectRestartPlan,
  type PlanInput,
  type RestartPlan,
  type RestartTools,
  restartHost,
} from "./restart.ts";
import { type StageTools, stageRelease } from "./stage.ts";
import { swapIn } from "./swap.ts";

export type UpdateResult =
  | { status: "up-to-date"; current: string; latest: string }
  /** `restarted` is false when nothing here can restart the host: the person does it. */
  | { status: "updated"; from: string; to: string; restarted: boolean };

export interface UpdateDeps {
  layout: InstallLayout;
  platform: HostPlatform;
  /** The running release, `x.y.z`. */
  currentVersion: string;
  feed: FeedConfig;
  fetch: FetchFn;
  stageTools: StageTools;
  restartTools: RestartTools;
  planInput: Omit<PlanInput, "layout">;
  /** True once the host answers `/api/health` with `version`, false after the wait runs out. */
  waitForVersion: (version: string) => Promise<boolean>;
  log: (line: string) => void;
}

/**
 * Brings this host to the newest published release. The new
 * release is downloaded, checked and proven to run before anything in the install changes; it is
 * then swapped in with the old one kept aside, the host is restarted the way it runs, and if the
 * new host does not come up on the new version the old one is put back and started again.
 * Data under `~/.aop` is never touched: migrations run when the new host starts, as always.
 */
export const updateHost = async (deps: UpdateDeps): Promise<UpdateResult> => {
  const { currentVersion: current, log } = deps;
  const release = await fetchLatestRelease(deps.feed, deps.fetch);
  if (!isNewerBuild(release.version, current, deps.feed.channel)) {
    return { status: "up-to-date", current, latest: release.version };
  }

  log(`Downloading AOP ${release.version}`);
  const staged = await stageRelease(release, deps.platform, deps.layout, deps.stageTools);
  const plan = await detectRestartPlan({ ...deps.planInput, layout: deps.layout });
  log(`Installing AOP ${release.version}`);
  const swapped = await swapIn(staged, deps.layout).catch(async (error) => {
    await rm(staged.dir, { recursive: true, force: true });
    throw error;
  });

  if (plan.kind === "manual") {
    await swapped.commit();
    return { status: "updated", from: current, to: release.version, restarted: false };
  }

  try {
    log("Restarting the host");
    await restartHost(plan, deps.layout, deps.restartTools);
    if (!(await deps.waitForVersion(release.version))) {
      throw new Error(`the host did not come back on ${release.version}`);
    }
  } catch (error) {
    await putOldBack(deps, swapped.rollback, plan);
    throw new Error(
      `AOP ${release.version} did not start (${messageOf(error)}). Rolled back to ${current}.`,
    );
  }
  await swapped.commit();
  return { status: "updated", from: current, to: release.version, restarted: true };
};

const putOldBack = async (
  deps: UpdateDeps,
  rollback: () => Promise<void>,
  startedWith: RestartPlan,
): Promise<void> => {
  await rollback();
  deps.log("Rolling back to the previous release");
  // What runs now may be a host that started on the new release and went wrong, which the pid
  // file now names. When nothing is found, the plan the update began with still says how to start.
  const found = await detectRestartPlan({ ...deps.planInput, layout: deps.layout });
  const plan = found.kind === "manual" ? startedWith : found;
  // The old files are back in place even when starting them again fails; say so, do not hide it.
  await restartHost(plan, deps.layout, deps.restartTools).catch((error) =>
    deps.log(`Could not restart the previous release: ${messageOf(error)}`),
  );
};
