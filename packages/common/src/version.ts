import type { ReleaseChannel } from "./channel.ts";

/**
 * A nightly build's version: the next patch, the build date and the workflow run,
 * `0.10.7-nightly.20261002.14` (docs/NIGHTLY.md). Semver orders it above the release it follows
 * and below the one it previews.
 */
const NIGHTLY_PATTERN = /^(\d+\.\d+\.\d+)-nightly\.(\d{8})\.(\d+)$/;

export const normalizeReleaseVersion = (input: string): string => {
  const trimmed = input.trim().replace(/^v/i, "");
  const withoutBuild = trimmed.split("+")[0] ?? trimmed;
  // A nightly keeps its pre-release part: it is what orders one nightly after another.
  if (NIGHTLY_PATTERN.test(withoutBuild)) return withoutBuild;
  const core = withoutBuild.split("-")[0] ?? withoutBuild;
  const segments = core.split(".");
  if (segments.length > 0 && segments.length < 3 && segments.every((part) => /^\d+$/.test(part))) {
    while (segments.length < 3) segments.push("0");
    return segments.join(".");
  }
  return core;
};

/**
 * Orders two versions by their major.minor.patch core, ignoring a `v` prefix and build metadata
 * (`0.10.0+abc1234` is `0.10.0`). Negative when `a` is older. Two nightlies of the same core
 * order by date, then run; a nightly is older than the release of its core, as in semver.
 */
export const compareReleaseVersions = (a: string, b: string): number => {
  const left = releaseCore(a);
  const right = releaseCore(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return compareNightlyParts(nightlyParts(a), nightlyParts(b));
};

/** Whether `candidate` is a newer release than `current`. A build that is not a release (`dev`) is never older. */
export const isNewerRelease = (candidate: string, current: string): boolean =>
  isReleaseVersion(candidate) &&
  isReleaseVersion(current) &&
  compareReleaseVersions(candidate, current) > 0;

/** A published stable release, `x.y.z`. A nightly is not one, so stable never offers a nightly. */
export const isReleaseVersion = (input: string): boolean =>
  /^\d+\.\d+\.\d+$/.test(normalizeReleaseVersion(input));

export const isNightlyVersion = (input: string): boolean =>
  NIGHTLY_PATTERN.test(normalizeReleaseVersion(input));

/** Whether `input` is a published build of `channel`. */
export const isChannelVersion = (input: string, channel: ReleaseChannel): boolean =>
  channel === "nightly" ? isNightlyVersion(input) : isReleaseVersion(input);

/**
 * Whether `candidate` is a newer build of `channel` than `current`. Stable compares releases
 * only. Nightly compares nightlies only, so a nightly install never moves onto a stable release
 * or back.
 */
export const isNewerBuild = (
  candidate: string,
  current: string,
  channel: ReleaseChannel,
): boolean =>
  isChannelVersion(candidate, channel) &&
  isChannelVersion(current, channel) &&
  compareReleaseVersions(candidate, current) > 0;

const releaseCore = (input: string): number[] =>
  normalizeReleaseVersion(input)
    .split("-")[0]
    ?.split(".")
    .map((part) => Number.parseInt(part, 10) || 0) ?? [];

const nightlyParts = (input: string): [number, number] | null => {
  const match = normalizeReleaseVersion(input).match(NIGHTLY_PATTERN);
  return match ? [Number(match[2]), Number(match[3])] : null;
};

const compareNightlyParts = (
  a: [number, number] | null,
  b: [number, number] | null,
): number => {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return a[0] - b[0] || a[1] - b[1];
};
