import type { SessionDiffFile, SessionDiffLine, SessionGitDiff } from "@aop/common";
import {
  resolveSessionWorkspaceBinding,
  WorkspaceBindingError,
} from "../chat-session/workspace-binding.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { parseUnifiedDiff } from "./diff-parse.ts";
import { appendUntrackedSummaries, parseNameStatusSummary } from "./diff-summary.ts";
import {
  MACHINE_READABLE_GIT_DIFF_FLAGS,
  resolveDefaultBranch,
  resolveMergeBase,
} from "./git-helpers.ts";
import { defaultRunGit, type RunGit } from "./service.ts";

export type {
  SessionDiffFile,
  SessionDiffFileStatus,
  SessionDiffHunk,
  SessionDiffLine,
  SessionGitDiff,
} from "@aop/common";
export { parseUnifiedDiff } from "./diff-parse.ts";

export type DiffLineType = "context" | "add" | "del";

export type GetSessionGitDiffResult =
  | { success: true; diff: SessionGitDiff }
  | {
      success: false;
      error:
        | { code: "SESSION_NOT_FOUND" }
        | {
            code: "WORKSPACE_BINDING_ERROR";
            message: string;
            path: string | null;
            resettable: boolean;
          };
    };

const PER_FILE_LINE_CAP = 2_000;
const DIFF_CONTEXT_LINES = 20;

/** File list + stats only (no hunks). Use for large change sets before loading bodies. */
export const getSessionGitDiffSummary = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGit: RunGit = defaultRunGit,
): Promise<GetSessionGitDiffResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const workspaceResult = await resolveDiffWorkspace(ctx, session);
  if (!workspaceResult.success) return workspaceResult;

  const diff = await readWorkspaceDiffSummary(runGit, workspaceResult.workspace);
  return { success: true, diff };
};

/** One file's capped hunk body for an expanded row in the session diff panel. */
export const getSessionGitDiffFile = async (
  ctx: LocalServerContext,
  sessionId: string,
  path: string,
  runGit: RunGit = defaultRunGit,
): Promise<
  | { success: true; file: SessionDiffFile }
  | Extract<GetSessionGitDiffResult, { success: false }>
  | { success: false; error: { code: "PATH_REQUIRED" } | { code: "FILE_NOT_FOUND" } }
> => {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes("\0") || trimmed.startsWith("/") || trimmed.includes("..")) {
    return { success: false, error: { code: "PATH_REQUIRED" } };
  }
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const workspaceResult = await resolveDiffWorkspace(ctx, session);
  if (!workspaceResult.success) return workspaceResult;

  const file = await readWorkspaceDiffFile(runGit, workspaceResult.workspace, trimmed);
  if (!file) return { success: false, error: { code: "FILE_NOT_FOUND" } };
  return { success: true, file };
};

/** @deprecated Prefer summary + per-file; kept for tests that need a full tree. */
export const getSessionGitDiff = async (
  ctx: LocalServerContext,
  sessionId: string,
  runGit: RunGit = defaultRunGit,
): Promise<GetSessionGitDiffResult> => {
  const session = await ctx.chatSessionRepository.getById(sessionId);
  if (!session) return { success: false, error: { code: "SESSION_NOT_FOUND" } };

  const workspaceResult = await resolveDiffWorkspace(ctx, session);
  if (!workspaceResult.success) return workspaceResult;

  const diff = await readWorkspaceDiff(runGit, workspaceResult.workspace);
  return { success: true, diff };
};

const resolveDiffWorkspace = async (
  ctx: LocalServerContext,
  session: ChatSession,
): Promise<
  { success: true; workspace: string } | Extract<GetSessionGitDiffResult, { success: false }>
> => {
  try {
    const workspace = await resolveSessionWorkspaceBinding(ctx, session);
    return { success: true, workspace };
  } catch (error) {
    if (error instanceof WorkspaceBindingError) {
      return {
        success: false,
        error: {
          code: "WORKSPACE_BINDING_ERROR",
          message: error.message,
          path: error.path,
          resettable: error.resettable,
        },
      };
    }
    throw error;
  }
};

const readWorkspaceDiff = async (runGit: RunGit, workspace: string): Promise<SessionGitDiff> => {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], workspace);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return { defaultBranch: null, files: [], perFileLineCap: PER_FILE_LINE_CAP };
  }

  const defaultBranch = await resolveDefaultBranch(runGit, workspace);
  const mergeBase = await resolveMergeBaseRef(runGit, workspace, defaultBranch);
  if (!mergeBase) {
    return { defaultBranch, files: [], perFileLineCap: PER_FILE_LINE_CAP };
  }

  const tracked = await runGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      ...MACHINE_READABLE_GIT_DIFF_FLAGS,
      "--find-renames",
      `--unified=${DIFF_CONTEXT_LINES}`,
      mergeBase,
    ],
    workspace,
  );
  const files = parseUnifiedDiff(tracked.exitCode === 0 ? tracked.stdout : "");
  await appendUntrackedDiffs(runGit, workspace, files);

  return {
    defaultBranch,
    files: files.map((file) => applyPerFileCap(file, PER_FILE_LINE_CAP)),
    perFileLineCap: PER_FILE_LINE_CAP,
  };
};

/** name-status + numstat only — avoids parsing multi-MB unified diffs for 500+ files. */
const readWorkspaceDiffSummary = async (
  runGit: RunGit,
  workspace: string,
): Promise<SessionGitDiff> => {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], workspace);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") {
    return { defaultBranch: null, files: [], perFileLineCap: PER_FILE_LINE_CAP, summaryOnly: true };
  }

  const defaultBranch = await resolveDefaultBranch(runGit, workspace);
  const mergeBase = await resolveMergeBaseRef(runGit, workspace, defaultBranch);
  if (!mergeBase) {
    return { defaultBranch, files: [], perFileLineCap: PER_FILE_LINE_CAP, summaryOnly: true };
  }

  const nameStatus = await runGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      ...MACHINE_READABLE_GIT_DIFF_FLAGS,
      "--name-status",
      "--find-renames",
      mergeBase,
    ],
    workspace,
  );
  const numstat = await runGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      ...MACHINE_READABLE_GIT_DIFF_FLAGS,
      "--numstat",
      "--find-renames",
      mergeBase,
    ],
    workspace,
  );
  const files = parseNameStatusSummary(
    nameStatus.exitCode === 0 ? nameStatus.stdout : "",
    numstat.exitCode === 0 ? numstat.stdout : "",
  );
  await appendUntrackedSummaries(runGit, workspace, files);

  return {
    defaultBranch,
    files,
    perFileLineCap: PER_FILE_LINE_CAP,
    summaryOnly: true,
  };
};

const readWorkspaceDiffFile = async (
  runGit: RunGit,
  workspace: string,
  path: string,
): Promise<SessionDiffFile | null> => {
  const inside = await runGit(["rev-parse", "--is-inside-work-tree"], workspace);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return null;

  const defaultBranch = await resolveDefaultBranch(runGit, workspace);
  const mergeBase = await resolveMergeBaseRef(runGit, workspace, defaultBranch);
  if (!mergeBase) return null;

  const tracked = await runGit(
    [
      "-c",
      "core.quotepath=false",
      "diff",
      ...MACHINE_READABLE_GIT_DIFF_FLAGS,
      "--find-renames",
      `--unified=${DIFF_CONTEXT_LINES}`,
      mergeBase,
      "--",
      path,
    ],
    workspace,
  );
  const files = parseUnifiedDiff(tracked.exitCode === 0 ? tracked.stdout : "");
  const match =
    files.find((file) => file.path === path) ?? files.find((file) => file.oldPath === path) ?? null;
  if (match) return applyPerFileCap(match, PER_FILE_LINE_CAP);

  // Untracked path: show as full-file add when present on disk.
  const untracked = await runGit(
    ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", path],
    workspace,
  );
  if (untracked.exitCode !== 0 || !untracked.stdout.trim()) return null;
  return applyPerFileCap(await buildUntrackedFileDiff(workspace, path), PER_FILE_LINE_CAP);
};

const resolveMergeBaseRef = async (
  runGit: RunGit,
  workspace: string,
  defaultBranch: string | null,
): Promise<string | null> => resolveMergeBase(runGit, workspace, defaultBranch ?? "HEAD");

const appendUntrackedDiffs = async (
  runGit: RunGit,
  workspace: string,
  files: SessionDiffFile[],
): Promise<void> => {
  const untracked = await runGit(
    ["-c", "core.quotepath=false", "ls-files", "--others", "--exclude-standard", "--", "."],
    workspace,
  );
  if (untracked.exitCode !== 0) return;
  for (const relativePath of untracked.stdout.split("\n").map((line) => line.trim())) {
    if (!relativePath) continue;
    files.push(await buildUntrackedFileDiff(workspace, relativePath));
  }
};

const buildUntrackedFileDiff = async (
  workspace: string,
  relativePath: string,
): Promise<SessionDiffFile> => {
  try {
    const file = Bun.file(`${workspace}/${relativePath}`);
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (looksBinary(bytes)) {
      return {
        path: relativePath,
        oldPath: null,
        status: "binary",
        additions: 0,
        deletions: 0,
        truncated: false,
        hunks: [],
      };
    }
    const text = new TextDecoder().decode(bytes);
    const contentLines = text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
    const lines: SessionDiffLine[] = contentLines.map((line, index) => ({
      type: "add" as const,
      oldNo: null,
      newNo: index + 1,
      text: line,
    }));
    return {
      path: relativePath,
      oldPath: null,
      status: "added",
      additions: lines.length,
      deletions: 0,
      truncated: false,
      hunks: lines.length > 0 ? [{ oldStart: 0, newStart: 1, lines }] : [],
    };
  } catch {
    return {
      path: relativePath,
      oldPath: null,
      status: "added",
      additions: 0,
      deletions: 0,
      truncated: false,
      hunks: [],
    };
  }
};

const looksBinary = (bytes: Uint8Array): boolean => {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8000));
  return sample.includes(0);
};

export const applyPerFileCap = (file: SessionDiffFile, cap: number): SessionDiffFile => {
  const positioned = file.hunks.flatMap((hunk, hunkIndex) =>
    hunk.lines.map((line, lineIndex) => ({ hunkIndex, lineIndex, line })),
  );
  const changed = positioned.filter(({ line }) => line.type !== "context");
  const context = positioned.filter(({ line }) => line.type === "context");
  const contextBudget = Math.max(0, cap - changed.length);
  if (context.length <= contextBudget) return file;

  const kept = new Set(changed.map(positionedLineKey));
  const nearest = context
    .map((candidate) => ({
      candidate,
      distance: distanceToNearestChange(candidate, changed),
    }))
    .sort(compareContextPriority)
    .slice(0, contextBudget);
  for (const { candidate } of nearest) kept.add(positionedLineKey(candidate));

  const hunks = file.hunks.flatMap((hunk, hunkIndex) => {
    const lines = hunk.lines.filter((_, lineIndex) => kept.has(`${hunkIndex}:${lineIndex}`));
    if (lines.length === 0) return [];
    return [{ ...hunk, lines }];
  });
  return { ...file, hunks, truncated: true };
};

interface PositionedDiffLine {
  hunkIndex: number;
  lineIndex: number;
  line: SessionDiffLine;
}

const positionedLineKey = ({ hunkIndex, lineIndex }: PositionedDiffLine): string =>
  `${hunkIndex}:${lineIndex}`;

const distanceToNearestChange = (
  context: PositionedDiffLine,
  changed: PositionedDiffLine[],
): number => {
  let nearest = Number.POSITIVE_INFINITY;
  for (const candidate of changed) {
    if (candidate.hunkIndex !== context.hunkIndex) continue;
    nearest = Math.min(nearest, Math.abs(candidate.lineIndex - context.lineIndex));
  }
  return nearest;
};

const compareContextPriority = (
  left: { candidate: PositionedDiffLine; distance: number },
  right: { candidate: PositionedDiffLine; distance: number },
): number =>
  left.distance - right.distance ||
  left.candidate.hunkIndex - right.candidate.hunkIndex ||
  left.candidate.lineIndex - right.candidate.lineIndex;
