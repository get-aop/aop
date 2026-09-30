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
