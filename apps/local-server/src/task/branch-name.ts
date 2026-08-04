import { basename } from "node:path";

const normalizeBranchPart = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

export const deriveTaskBranchName = (changePath: string, taskId: string): string => {
  const branchName = normalizeBranchPart(basename(changePath));
  if (branchName) {
    return branchName;
  }

  const fallback = normalizeBranchPart(taskId);
  return fallback || "task";
};

export const resolveTaskBranchName = ({
  branch_name,
  change_path,
  id,
}: {
  branch_name?: string | null;
  change_path: string;
  id: string;
}): string => branch_name ?? deriveTaskBranchName(change_path, id);
