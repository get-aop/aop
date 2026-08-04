import type { ChatTurnDiffFileSummary, SessionDiffFile, SessionDiffFileStatus } from "@aop/common";
import {
  CheckpointFailure,
  checkpointError,
  requireGitSuccess,
  runCheckpointGit,
} from "./checkpoint-command.ts";
import {
  CHECKPOINT_DIFF_LINE_CAP,
  type CheckpointGitOptions,
  type WorkspaceCheckpointResult,
} from "./checkpoint-types.ts";
import { resolveWorkspaceCheckpointRef } from "./checkpoints.ts";
import { applyPerFileCap } from "./diff.ts";
import { parseUnifiedDiff } from "./diff-parse.ts";
import { MACHINE_READABLE_GIT_DIFF_FLAGS } from "./git-helpers.ts";

const DIFF_CONTEXT_LINES = 20;

interface CheckpointDiffInput extends CheckpointGitOptions {
  workspacePath: string;
  fromRef: string;
  toRef: string;
}

export interface CheckpointDiffSummary {
  fromCommit: string;
  toCommit: string;
  files: ChatTurnDiffFileSummary[];
  perFileLineCap: number;
  summaryOnly: true;
}

export const getCheckpointDiffSummary = async (
  input: CheckpointDiffInput,
): Promise<WorkspaceCheckpointResult<CheckpointDiffSummary>> => {
  try {
    const { fromCommit, toCommit } = await resolveDiffCommits(input);
    const nameStatus = await successfulGit(
      [
        "-c",
        "core.quotepath=false",
        "diff",
        ...MACHINE_READABLE_GIT_DIFF_FLAGS,
        "--name-status",
        "-z",
        "--find-renames",
        fromCommit,
        toCommit,
        "--",
        ".",
      ],
      input,
    );
    const numstat = await successfulGit(
      [
        "-c",
        "core.quotepath=false",
        "diff",
        ...MACHINE_READABLE_GIT_DIFF_FLAGS,
        "--numstat",
        "-z",
        "--find-renames",
        fromCommit,
        toCommit,
        "--",
        ".",
      ],
      input,
    );
    return {
      success: true,
      value: {
        fromCommit,
        toCommit,
        files: parseCheckpointSummary(nameStatus, numstat),
        perFileLineCap: CHECKPOINT_DIFF_LINE_CAP,
        summaryOnly: true,
      },
    };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

export const getCheckpointDiffFile = async (
  input: CheckpointDiffInput & { path: string },
): Promise<
  WorkspaceCheckpointResult<{ fromCommit: string; toCommit: string; file: SessionDiffFile }>
> => {
  try {
    const path = validateDiffPath(input.path);
    const summary = await getCheckpointDiffSummary(input);
    if (!summary.success) throw new CheckpointFailure(summary.error);
    const summaryFile =
      summary.value.files.find((file) => file.path === path) ??
      summary.value.files.find((file) => file.oldPath === path);
    if (!summaryFile) {
      throw new CheckpointFailure({
        code: "INVALID_PATH",
        message: `Path is not changed between checkpoints: ${path}`,
      });
    }

    const paths = summaryFile.oldPath
      ? [summaryFile.oldPath, summaryFile.path]
      : [summaryFile.path];
    const raw = await successfulGit(
      [
        "-c",
        "core.quotepath=false",
        "diff",
        ...MACHINE_READABLE_GIT_DIFF_FLAGS,
        "--find-renames",
        `--unified=${DIFF_CONTEXT_LINES}`,
        summary.value.fromCommit,
        summary.value.toCommit,
        "--",
        ...paths,
      ],
      input,
    );
    const parsed = parseUnifiedDiff(raw);
    const file =
      parsed.find((candidate) => candidate.path === summaryFile.path) ??
      parsed.find((candidate) => candidate.oldPath === summaryFile.oldPath) ??
      summaryToDiffFile(summaryFile);
    return {
      success: true,
      value: {
        fromCommit: summary.value.fromCommit,
        toCommit: summary.value.toCommit,
        file: applyPerFileCap({ ...file, detailsPending: false }, CHECKPOINT_DIFF_LINE_CAP),
      },
    };
  } catch (error) {
    return { success: false, error: checkpointError(error) };
  }
};

const resolveDiffCommits = async (
  input: CheckpointDiffInput,
): Promise<{ fromCommit: string; toCommit: string }> => {
  const from = await resolveWorkspaceCheckpointRef({ ...input, ref: input.fromRef });
  if (!from.success) throw new CheckpointFailure(from.error);
  const to = await resolveWorkspaceCheckpointRef({ ...input, ref: input.toRef });
  if (!to.success) throw new CheckpointFailure(to.error);
  if (from.value.identity.gitCommonDirectory !== to.value.identity.gitCommonDirectory) {
    throw new CheckpointFailure({
      code: "WORKSPACE_IDENTITY_MISMATCH",
      message: "Checkpoint refs do not belong to the same git common directory",
    });
  }
  return { fromCommit: from.value.commitId, toCommit: to.value.commitId };
};

const successfulGit = async (args: string[], input: CheckpointDiffInput): Promise<string> =>
  requireGitSuccess(
    await runCheckpointGit(args, input.workspacePath, input),
    args,
    `Git checkpoint diff command failed: ${args[3] ?? args[0]}`,
  );

const validateDiffPath = (path: string): string => {
  const trimmed = path.trim();
  const segments = trimmed.split("/");
  if (
    !trimmed ||
    trimmed.includes("\0") ||
    trimmed.startsWith("/") ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new CheckpointFailure({ code: "INVALID_PATH", message: `Invalid diff path: ${path}` });
  }
  return trimmed;
};

interface DiffStat {
  additions: number;
  deletions: number;
  binary: boolean;
}

const parseCheckpointSummary = (
  nameStatusRaw: string,
  numstatRaw: string,
): ChatTurnDiffFileSummary[] => {
  const stats = parseNumstatZ(numstatRaw);
  const tokens = splitNul(nameStatusRaw);
  const files: ChatTurnDiffFileSummary[] = [];
  let index = 0;
  while (index < tokens.length) {
    const statusCode = tokens[index++] ?? "";
    const oldOrCurrentPath = tokens[index++] ?? "";
    if (!statusCode || !oldOrCurrentPath) continue;
    if (statusCode.startsWith("R") || statusCode.startsWith("C")) {
      const newPath = tokens[index++] ?? oldOrCurrentPath;
      files.push(summaryFile(newPath, oldOrCurrentPath, "renamed", stats.get(newPath)));
      continue;
    }
    files.push(
      summaryFile(oldOrCurrentPath, null, statusFromCode(statusCode), stats.get(oldOrCurrentPath)),
    );
  }
  return files;
};

const parseNumstatZ = (raw: string): Map<string, DiffStat> => {
  const tokens = splitNul(raw);
  const stats = new Map<string, DiffStat>();
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index++] ?? "";
    const [addRaw = "0", delRaw = "0", path = ""] = token.split("\t");
    const counts = statCounts(addRaw, delRaw);
    if (path) {
      stats.set(path, counts);
      continue;
    }
    const oldPath = tokens[index++] ?? "";
    const newPath = tokens[index++] ?? "";
    if (oldPath) stats.set(oldPath, counts);
    if (newPath) stats.set(newPath, counts);
  }
  return stats;
};

const splitNul = (raw: string): string[] => raw.split("\0").filter((token) => token.length > 0);

const statCounts = (addRaw: string, delRaw: string): DiffStat => ({
  additions: addRaw === "-" ? 0 : Number.parseInt(addRaw, 10) || 0,
  deletions: delRaw === "-" ? 0 : Number.parseInt(delRaw, 10) || 0,
  binary: addRaw === "-" || delRaw === "-",
});

const statusFromCode = (statusCode: string): SessionDiffFileStatus => {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  return "modified";
};

const summaryFile = (
  path: string,
  oldPath: string | null,
  status: SessionDiffFileStatus,
  counts: DiffStat | undefined,
): ChatTurnDiffFileSummary => ({
  path,
  oldPath,
  status: counts?.binary && status !== "renamed" ? "binary" : status,
  additions: counts?.additions ?? 0,
  deletions: counts?.deletions ?? 0,
  binary: counts?.binary ?? false,
  detailsPending: true,
});

const summaryToDiffFile = (summary: ChatTurnDiffFileSummary): SessionDiffFile => ({
  path: summary.path,
  oldPath: summary.oldPath,
  status: summary.status,
  additions: summary.additions,
  deletions: summary.deletions,
  truncated: false,
  hunks: [],
  detailsPending: false,
});
