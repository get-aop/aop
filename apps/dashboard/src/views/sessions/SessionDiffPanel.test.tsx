import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { SessionDiffFile, SessionGitDiff } from "../../api/client";
import { setupDashboardDom } from "../../test/setup-dom";
import { foldUnmodifiedRegionsWithEdges } from "./session-diff-fold";

setupDashboardDom();

const sampleFile = (path: string, lines = 3): SessionDiffFile => ({
  path,
  oldPath: null,
  status: "modified",
  additions: 1,
  deletions: 0,
  truncated: false,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: Array.from({ length: lines }, (_, index) => ({
        type: index === 0 ? ("add" as const) : ("context" as const),
        oldNo: index === 0 ? null : index,
        newNo: index + 1,
        text: `line ${index + 1}`,
      })),
    },
  ],
});

const sampleDiff: SessionGitDiff = {
  defaultBranch: "main",
  perFileLineCap: 2000,
  files: [
    {
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
    },
    {
      path: "logo.png",
      oldPath: null,
      status: "binary",
      additions: 0,
      deletions: 0,
      truncated: false,
      hunks: [],
    },
  ],
};

const getSessionGitDiff = mock(async (_sessionId: string) => sampleDiff);
const getSessionGitDiffFile = mock(async (_sessionId: string, path: string) => {
  const file = sampleDiff.files.find((entry) => entry.path === path);
  if (!file) throw new Error(`missing ${path}`);
  return { ...file, detailsPending: undefined };
});
const actualClient = await import("../../api/client");

mock.module("../../api/client", () => ({
  ...actualClient,
  getSessionGitDiff,
  getSessionGitDiffFile,
}));

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD, SessionDiffPanel, initialCollapsedForDiff } =
  await import("./SessionDiffPanel");
const { getSessionReviewQueue, resetSessionReviewQueueCacheForTests } = await import(
  "./session-review-queue"
);

beforeEach(() => {
  getSessionGitDiff.mockClear();
  getSessionGitDiffFile.mockClear();
  getSessionGitDiff.mockImplementation(async () => sampleDiff);
  getSessionGitDiffFile.mockImplementation(async (_sessionId: string, path: string) => {
    const file = sampleDiff.files.find((entry) => entry.path === path);
    if (!file) throw new Error(`missing ${path}`);
    return { ...file, detailsPending: undefined };
  });
  localStorage.clear();
  resetSessionReviewQueueCacheForTests();
});
afterEach(() => {
  cleanup();
});

describe("foldUnmodifiedRegionsWithEdges", () => {
  test("folds long context runs into an expander segment", () => {
    const lines = Array.from({ length: 12 }, (_, index) => ({
      type: "context" as const,
      oldNo: index + 1,
      newNo: index + 1,
      text: `line ${index + 1}`,
    }));
    const segments = foldUnmodifiedRegionsWithEdges(lines);
    expect(segments.some((segment) => segment.kind === "fold")).toBe(true);
    const fold = segments.find((segment) => segment.kind === "fold");
    expect(fold?.kind === "fold" ? fold.lines.length : 0).toBe(6);
  });

  test("keeps short context runs expanded", () => {
    const lines = [
      { type: "context" as const, oldNo: 1, newNo: 1, text: "a" },
      { type: "add" as const, oldNo: null, newNo: 2, text: "b" },
    ];
    const segments = foldUnmodifiedRegionsWithEdges(lines);
    expect(segments.every((segment) => segment.kind === "lines")).toBe(true);
  });
});

describe("initialCollapsedForDiff", () => {
  test("keeps small diffs expanded by default", () => {
    expect(initialCollapsedForDiff([{ path: "a.ts" }, { path: "b.ts" }])).toEqual({});
  });

  test("collapses every file when the change set is large", () => {
    const files = Array.from({ length: LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD }, (_, i) => ({
      path: `f${i}.ts`,
    }));
    const collapsed = initialCollapsedForDiff(files);
    expect(Object.keys(collapsed)).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD);
    expect(Object.values(collapsed).every(Boolean)).toBe(true);
  });
});

describe("SessionDiffPanel", () => {
  test("renders per-file sections with counts, fold expanders, and line numbers", async () => {
    render(
      <SessionDiffPanel sessionId="csess_1" onClose={() => {}} showToast={() => {}} width={420} />,
    );

    await waitFor(() => expect(screen.getByTestId("session-diff-panel")).toBeTruthy());
    expect(getSessionGitDiff).toHaveBeenCalledWith("csess_1");

    const files = screen.getAllByTestId("session-diff-file");
    expect(files).toHaveLength(2);
    // Small diffs start expanded; content-visibility is only for collapsed headers.
    expect(files[0]?.className).not.toContain("session-diff-file-virtualized");
    expect(files[0]?.getAttribute("data-collapsed")).toBe("false");
    expect(files[0]?.textContent).toContain("src/a.ts");
    expect(files[0]?.textContent).toContain("+1");
    expect(files[0]?.textContent).toContain("−1");
    expect(screen.getByTestId("session-diff-file-count").textContent).toContain("2 files");

    const fold = await screen.findByTestId("session-diff-fold");
    expect(fold.textContent).toContain("unmodified lines");
    fireEvent.click(fold);
    expect(screen.queryByTestId("session-diff-fold")).toBeNull();
    const collapse = screen.getByTestId("session-diff-fold-collapse");
    expect(collapse.getAttribute("aria-label")).toContain("Collapse");
    fireEvent.click(collapse);
    expect(screen.getByTestId("session-diff-fold")).toBeTruthy();
    fireEvent.click(screen.getByTestId("session-diff-fold"));

    const delLine = screen
      .getAllByTestId("session-diff-line")
      .find((row) => row.getAttribute("data-line-type") === "del");
    expect(delLine?.textContent).toContain("const b = 2;");
    expect(delLine?.textContent).toContain("2");

    expect(screen.getByText("Binary file — content not shown.")).toBeTruthy();
    const contextLine = screen
      .getAllByTestId("session-diff-line")
      .find((row) => row.textContent?.includes("const a = 1;"));
    const syntax = contextLine?.querySelector("[data-syntax-language]");
    expect(syntax?.getAttribute("data-syntax-language")).toBe("typescript");
    await waitFor(() => expect(syntax?.getAttribute("data-syntax-highlighted")).toBe("true"));
  });

  test("keeps expanded file rows interactive for comments", async () => {
    render(<SessionDiffPanel sessionId="csess_1" onClose={() => {}} showToast={() => {}} />);

    const file = (await screen.findAllByTestId("session-diff-file"))[0];
    expect(file?.className).not.toContain("session-diff-file-virtualized");

    fireEvent.click(await screen.findByLabelText("Comment on src/a.ts line 2"));
    expect(screen.getByTestId("diff-comment-editor")).toBeTruthy();
  });

  test("starts large change sets collapsed and loads file bodies only after expand", async () => {
    const largeDiff: SessionGitDiff = {
      defaultBranch: "main",
      perFileLineCap: 2000,
      summaryOnly: true,
      files: Array.from({ length: LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD }, (_, i) => ({
        ...sampleFile(`src/file-${i}.ts`, 8),
        hunks: [],
        detailsPending: true,
      })),
    };
    getSessionGitDiff.mockImplementation(async () => largeDiff);
    getSessionGitDiffFile.mockImplementation(async (_sessionId, path) => ({
      ...sampleFile(path, 8),
      detailsPending: undefined,
    }));

    render(<SessionDiffPanel sessionId="csess_large" onClose={() => {}} showToast={() => {}} />);

    const files = await screen.findAllByTestId("session-diff-file");
    expect(files).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD);
    expect(files.every((file) => file.getAttribute("data-collapsed") === "true")).toBe(true);
    expect(getSessionGitDiffFile).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("session-diff-line")).toHaveLength(0);

    const firstHeader = files[0]?.querySelector("button");
    expect(firstHeader).toBeTruthy();
    fireEvent.click(firstHeader as HTMLButtonElement);
    await waitFor(() =>
      expect(getSessionGitDiffFile).toHaveBeenCalledWith("csess_large", "src/file-0.ts"),
    );
    await waitFor(() =>
      expect(screen.getAllByTestId("session-diff-line").length).toBeGreaterThan(0),
    );
    expect(getSessionGitDiffFile).toHaveBeenCalledTimes(1);
  });

  test("refetches when refreshKey changes", async () => {
    const { rerender } = render(
      <SessionDiffPanel
        sessionId="csess_1"
        onClose={() => {}}
        showToast={() => {}}
        refreshKey={0}
      />,
    );
    await waitFor(() => expect(getSessionGitDiff).toHaveBeenCalledTimes(1));

    rerender(
      <SessionDiffPanel
        sessionId="csess_1"
        onClose={() => {}}
        showToast={() => {}}
        refreshKey={1}
      />,
    );
    await waitFor(() => expect(getSessionGitDiff).toHaveBeenCalledTimes(2));
  });

  test("gutter + opens an editor; Cancel and Escape close without queueing", async () => {
    render(<SessionDiffPanel sessionId="csess_1" onClose={() => {}} showToast={() => {}} />);
    const button = await screen.findByLabelText("Comment on src/a.ts line 2");

    fireEvent.click(button);
    expect(screen.getByTestId("diff-comment-editor")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();

    fireEvent.click(button);
    fireEvent.keyDown(screen.getByLabelText("Review comment"), { key: "Escape" });
    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();
    expect(getSessionReviewQueue("csess_1")).toHaveLength(0);
  });

  test("Add saves the comment to the queue and marks the row", async () => {
    render(<SessionDiffPanel sessionId="csess_1" onClose={() => {}} showToast={() => {}} />);
    const addRowButton = await screen.findByLabelText("Comment on src/a.ts line 2");
    expect(addRowButton.getAttribute("data-commented")).toBeNull();

    fireEvent.click(addRowButton);
    fireEvent.change(screen.getByLabelText("Review comment"), {
      target: { value: "prefer a constant" },
    });
    fireEvent.click(screen.getByText("Add"));

    expect(screen.queryByTestId("diff-comment-editor")).toBeNull();
    const queue = getSessionReviewQueue("csess_1");
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      path: "src/a.ts",
      lineType: "add",
      oldNo: null,
      newNo: 2,
      excerpt: "const b = 3;",
      note: "prefer a constant",
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Comment on src/a.ts line 2").getAttribute("data-commented"),
      ).toBe("true"),
    );
  });

  test("Cmd+Enter saves from the editor keyboard shortcut", async () => {
    render(<SessionDiffPanel sessionId="csess_1" onClose={() => {}} showToast={() => {}} />);
    fireEvent.click(await screen.findByLabelText("Comment on src/a.ts line 1"));
    const textarea = screen.getByLabelText("Review comment");
    fireEvent.change(textarea, { target: { value: "context note" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(getSessionReviewQueue("csess_1")).toHaveLength(1);
    expect(getSessionReviewQueue("csess_1")[0]?.lineType).toBe("context");
  });
});
