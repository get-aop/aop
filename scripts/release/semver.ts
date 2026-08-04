import { normalizeReleaseVersion } from "./versioning.ts";

export type SemverBump = "patch" | "minor" | "major";

export const bumpSemver = (current: string, bump: SemverBump): string => {
  const normalized = normalizeReleaseVersion(current);
  const core = normalized.split("-")[0] ?? normalized;
  const [major, minor, patch] = core.split(".").map((part) => Number.parseInt(part, 10));

  if ([major, minor, patch].some((part) => Number.isNaN(part))) {
    throw new Error(`Cannot bump invalid semver "${current}"`);
  }

  const majorPart = major ?? 0;
  const minorPart = minor ?? 0;
  const patchPart = patch ?? 0;

  switch (bump) {
    case "patch":
      return `${majorPart}.${minorPart}.${patchPart + 1}`;
    case "minor":
      return `${majorPart}.${minorPart + 1}.0`;
    case "major":
      return `${majorPart + 1}.0.0`;
  }
};

export const resolveNextReleaseVersion = (current: string, target: SemverBump | string): string => {
  if (target === "patch" || target === "minor" || target === "major") {
    return bumpSemver(current, target);
  }

  return normalizeReleaseVersion(target);
};
