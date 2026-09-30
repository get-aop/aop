import type { SessionDiffFile, SessionGitDiff, Thread } from "@aop/common";
import { createElement } from "react";
import { makeThread } from "../../test-utils";
import { hostError, json, type mockHost } from "../test-utils";
import { ThreadChanges } from "./ThreadChanges";
import { useThreadDiff } from "./use-thread-diff";

export const THREAD_ID = "thr_1";
export const DIFF_URL = `/api/threads/${THREAD_ID}/diff`;
export const fileUrl = (path: string) => `${DIFF_URL}/file?path=${encodeURIComponent(path)}`;

export const modified: SessionDiffFile = {
  path: "src/a.ts",
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 1,
  truncated: false,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { type: "context", oldNo: 1, newNo: 1, text: "const a = 1;" },
        { type: "del", oldNo: 2, newNo: null, text: "const b = 2;" },
        { type: "add", oldNo: null, newNo: 2, text: "const b = 3;" },
        ...Array.from({ length: 10 }, (_, index) => ({
          type: "context" as const,
          oldNo: index + 3,
          newNo: index + 3,
          text: `const c${index} = ${index};`,
        })),
      ],
    },
  ],
};

export const binary: SessionDiffFile = {
  path: "logo.png",
  oldPath: null,
  status: "binary",
  additions: 0,
  deletions: 0,
  truncated: false,
  hunks: [],
};

/** A file the thread wrote and has not committed: the host counts nothing until the lines are read. */
export const untracked: SessionDiffFile = {
  path: "NOTES.md",
  oldPath: null,
  status: "added",
  additions: 3,
  deletions: 0,
  truncated: false,
  hunks: [
    {
      oldStart: 0,
      newStart: 1,
      lines: ["one", "two", "three"].map((text, index) => ({
        type: "add" as const,
        oldNo: null,
        newNo: index + 1,
        text,
      })),
    },
  ],
};

export const manyFiles = (count: number): SessionDiffFile[] =>
  Array.from({ length: count }, (_, index) => ({
    ...modified,
    path: `src/file-${index}.ts`,
    hunks: [
      {
        oldStart: 1,
        newStart: 1,
        lines: [
          { type: "add" as const, oldNo: null, newNo: 1, text: `export const f${index} = 1;` },
        ],
      },
    ],
  }));

/** A file as a host may send it when it leaves the lines out: with no `hunks` key at all. */
export const withoutHunks = ({
  hunks: _left,
  ...file
}: SessionDiffFile): Omit<SessionDiffFile, "hunks"> => file;

export type Answer = SessionDiffFile | Response | Promise<Response>;

/** What the real host sends first: the list and counts, no lines, every file waiting for its body. */
export const summaryOf = (files: SessionDiffFile[]): SessionGitDiff => ({
  defaultBranch: "main",
  perFileLineCap: 2000,
  summaryOnly: true,
  files: files.map((file) => ({
    ...file,
    hunks: [],
    detailsPending: true,
    ...(file.status === "added" ? { additions: 0, deletions: 0 } : {}),
  })),
});

/** Makes the host answer as the real one does: the list first, then a file's lines when asked for one. */
export const serveDiff = (
  host: ReturnType<typeof mockHost>,
  files: SessionDiffFile[],
  answers: Record<string, Answer> = {},
) =>
  host.respondWith(({ url }) => {
    if (url === DIFF_URL) return json(summaryOf(files));
    const path = decodeURIComponent(new URL(url, "http://host").searchParams.get("path") ?? "");
    const answer = answers[path] ?? files.find((file) => file.path === path);
    if (answer === undefined) return hostError(404, "FILE_NOT_FOUND", "No diff for that path");
    return answer instanceof Response || answer instanceof Promise ? answer : json(answer);
  });

export interface DiffHarnessProps {
  thread?: Thread;
  refreshKey?: string;
  visible?: boolean;
  onBack?: () => void;
  onReviewSent?: () => void;
}

/** The pane's wiring: the hook reads the diff, the view draws it. */
export const DiffHarness = ({
  thread = makeThread({ id: THREAD_ID, status: "idle", branch: "aop/fix-login" }),
  refreshKey = "k1",
  visible = true,
  onBack = () => {},
  onReviewSent = () => {},
}: DiffHarnessProps) => {
  const view = useThreadDiff(thread.id, refreshKey, visible);
  return createElement(ThreadChanges, { thread, view, onBack, onReviewSent });
};
