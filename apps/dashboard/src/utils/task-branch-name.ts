const normalizeBranchPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export const deriveTaskBranchName = (changePath: string, taskId: string): string => {
  const segments = changePath.split("/").filter(Boolean);
  const branchName = normalizeBranchPart(segments[segments.length - 1] ?? changePath);
  if (branchName) {
    return branchName;
  }

  const fallback = normalizeBranchPart(taskId);
  return fallback || "task";
};
