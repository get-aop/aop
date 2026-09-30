export const normalizeReleaseVersion = (input: string): string => {
  const trimmed = input.trim().replace(/^v/i, "");
  const core = trimmed.split("+")[0]?.split("-")[0] ?? trimmed;
  const segments = core.split(".");
  if (segments.length > 0 && segments.length < 3 && segments.every((part) => /^\d+$/.test(part))) {
    while (segments.length < 3) segments.push("0");
    return segments.join(".");
  }
  return core;
};

/**
 * Orders two release versions by their major.minor.patch core, ignoring a `v` prefix, a
 * pre-release and build metadata (`0.10.0+abc1234` is `0.10.0`). Negative when `a` is older.
 * Only published, non-pre-release versions are compared, so the core is all that matters.
 */
export const compareReleaseVersions = (a: string, b: string): number => {
  const left = releaseCore(a);
  const right = releaseCore(b);
  for (let i = 0; i < 3; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** Whether `candidate` is a newer release than `current`. A build that is not a release (`dev`) is never older. */
export const isNewerRelease = (candidate: string, current: string): boolean =>
  isReleaseVersion(candidate) &&
  isReleaseVersion(current) &&
  compareReleaseVersions(candidate, current) > 0;

export const isReleaseVersion = (input: string): boolean =>
  /^\d+\.\d+\.\d+$/.test(normalizeReleaseVersion(input));

const releaseCore = (input: string): number[] =>
  normalizeReleaseVersion(input)
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
