import type { SessionDiffFile, SessionDiffFileStatus } from "@aop/common";
import type { RunGit } from "./service.ts";

type StatCounts = { additions: number; deletions: number; binary?: boolean };

export const parseNameStatusSummary = (
  nameStatusRaw: string,
  numstatRaw: string,
): SessionDiffFile[] => {
  const stats = parseNumstat(numstatRaw);
  const files: SessionDiffFile[] = [];
  for (const line of nameStatusRaw.split("\n")) {
    const file = parseNameStatusLine(line, stats);
    if (file) files.push(file);
  }
  return files;
};

const parseNameStatusLine = (
  line: string,
  stats: Map<string, StatCounts>,
): SessionDiffFile | null => {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;
  const parts = trimmed.split("\t");
  const statusCode = parts[0] ?? "";
  if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
    return renameSummaryFile(parts, stats);
  }
  const path = parts[1] ?? "";
  if (!path) return null;
  return ordinarySummaryFile(path, statusCode, stats);
};

const renameSummaryFile = (parts: string[], stats: Map<string, StatCounts>): SessionDiffFile => {
  const oldPath = parts[1] ?? "";
  const newPath = parts[2] ?? oldPath;
  const counts = stats.get(newPath) ?? stats.get(oldPath) ?? { additions: 0, deletions: 0 };
  return summaryFile(newPath, oldPath || null, "renamed", counts);
};

const ordinarySummaryFile = (
  path: string,
  statusCode: string,
  stats: Map<string, StatCounts>,
): SessionDiffFile => {
  const counts = stats.get(path) ?? { additions: 0, deletions: 0 };
  if (counts.binary) return summaryFile(path, null, "binary", { additions: 0, deletions: 0 });
  return summaryFile(path, null, statusFromCode(statusCode), counts);
};

const statusFromCode = (statusCode: string): SessionDiffFileStatus => {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  return "modified";
};

const parseNumstat = (raw: string): Map<string, StatCounts> => {
  const map = new Map<string, StatCounts>();
  for (const line of raw.split("\n")) {
    const entry = parseNumstatLine(line);
    if (entry) map.set(entry.path, entry.counts);
  }
  return map;
};

const parseNumstatLine = (line: string): { path: string; counts: StatCounts } | null => {
  const trimmed = line.trimEnd();
  if (!trimmed) return null;
  const parts = trimmed.split("\t");
  if (parts.length < 3) return null;
  const [addRaw, delRaw, ...pathParts] = parts;
  const path = pathParts[pathParts.length - 1] ?? "";
  if (!path) return null;
  if (addRaw === "-" || delRaw === "-") {
    return { path, counts: { additions: 0, deletions: 0, binary: true } };
  }
  return {
    path,
    counts: {
      additions: Number.parseInt(addRaw ?? "0", 10) || 0,
      deletions: Number.parseInt(delRaw ?? "0", 10) || 0,
    },
  };
};

const summaryFile = (
  path: string,
  oldPath: string | null,
  status: SessionDiffFileStatus,
  counts: { additions: number; deletions: number },
): SessionDiffFile => ({
  path,
  oldPath,
  status,
  additions: counts.additions,
  deletions: counts.deletions,
  truncated: false,
  hunks: [],
  detailsPending: true,
});

export const appendUntrackedSummaries = async (
  runGit: RunGit,
  workspace: string,
  files: SessionDiffFile[],
): Promise<void> => {
  const untracked = await runGit(
    ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", "."],
    workspace,
  );
  if (untracked.exitCode !== 0) return;
  const known = new Set(files.map((file) => file.path));
  for (const relativePath of untracked.stdout.split("\n").map((line) => line.trim())) {
    if (!relativePath || known.has(relativePath)) continue;
    files.push(summaryFile(relativePath, null, "added", { additions: 0, deletions: 0 }));
  }
};
