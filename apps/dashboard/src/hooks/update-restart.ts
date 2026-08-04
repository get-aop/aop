import { type AopUpdateStatus, normalizeReleaseVersion } from "@aop/common";
import { getUpdateStatus } from "../api/client";

export const UPDATE_RESTART_POLL_MS = 2_000;
export const UPDATE_RESTART_INITIAL_DELAY_MS = 3_000;
export const UPDATE_RESTART_TIMEOUT_MS = 10 * 60 * 1000;

export const hasReachedTargetVersion = (currentVersion: string, targetVersion: string): boolean =>
  normalizeReleaseVersion(currentVersion) === normalizeReleaseVersion(targetVersion);

const reloadIfReady = async (
  fetchStatus: () => Promise<AopUpdateStatus>,
  targetVersion: string,
  reload: () => void,
): Promise<boolean> => {
  try {
    const status = await fetchStatus();
    if (!hasReachedTargetVersion(status.currentVersion, targetVersion)) {
      return false;
    }
    reload();
    return true;
  } catch {
    return false;
  }
};

export const waitForUpdateRestart = async (
  targetVersion: string,
  options: {
    fetchStatus?: () => Promise<AopUpdateStatus>;
    reload?: () => void;
    initialDelayMs?: number;
    pollIntervalMs?: number;
    timeoutMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> => {
  const fetchStatus = options.fetchStatus ?? getUpdateStatus;
  const reload = options.reload ?? (() => window.location.reload());
  const initialDelayMs = options.initialDelayMs ?? UPDATE_RESTART_INITIAL_DELAY_MS;
  const pollIntervalMs = options.pollIntervalMs ?? UPDATE_RESTART_POLL_MS;
  const timeoutMs = options.timeoutMs ?? UPDATE_RESTART_TIMEOUT_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms)));

  const deadline = Date.now() + timeoutMs;

  await sleep(initialDelayMs);

  while (Date.now() < deadline) {
    if (await reloadIfReady(fetchStatus, targetVersion, reload)) {
      return true;
    }

    await sleep(pollIntervalMs);
  }

  return false;
};
