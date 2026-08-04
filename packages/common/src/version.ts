const SEMVER_CORE_PATTERN = /^(\d+)\.(\d+)\.(\d+)/;

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

export const compareReleaseVersions = (left: string, right: string): number => {
  const parseCore = (value: string): [number, number, number] | null => {
    const match = normalizeReleaseVersion(value).match(SEMVER_CORE_PATTERN);
    if (!match) {
      return null;
    }

    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };

  const leftParts = parseCore(left);
  const rightParts = parseCore(right);

  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
};

export const isReleaseVersionNewer = (latest: string, current: string): boolean =>
  compareReleaseVersions(latest, current) > 0;
