import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { setupDashboardDom } from "../test/setup-dom";
import type { Task } from "../types";

setupDashboardDom();
mock.restore();

const { render, screen, cleanup, waitFor, fireEvent } = await import("@testing-library/react");
const { SpecsTab } = await import("./SpecsTab");

const originalFetch = globalThis.fetch;
const mockFetch = mock(() => Promise.resolve(new Response()));

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

beforeEach(() => {
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  mockFetch.mockClear();
  controlledReviewNotes = [];
  onCreateNote.mockClear();
  onDeleteNote.mockClear();
  onUpdateNote.mockClear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  repoId: "repo-1",
  repoPath: "/home/user/my-repo",
  changePath: "docs/tasks/my-change",
  status: "DONE",
  baseBranch: null,
  preferredProvider: null,
  preferredWorkflow: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

const extractUrl = (input: unknown): string => {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
};

const matchFileContent = (urlStr: string, fileContents: Record<string, string>) => {
  for (const [path, content] of Object.entries(fileContents)) {
    if (urlStr.includes(`/files/${encodeURIComponent(path)}`)) {
      return jsonResponse({ content });
    }
  }
  return null;
};

type MockReviewNote = {
  id: string;
  filePath: string;
  selectedText: string;
  textOccurrence?: number;
  note: string;
  createdAt: string;
  updatedAt: string;
};

let controlledReviewNotes: MockReviewNote[] = [];
const onCreateNote = mock(
  async (_input: {
    filePath: string;
    selectedText: string;
    textOccurrence?: number;
    note: string;
  }) => {},
);
const onDeleteNote = mock(async (_noteId: string) => {});
const onUpdateNote = mock(async (_noteId: string, _noteText: string) => {});

const matchReviewNotes = (urlStr: string, method: string, reviewNotes: MockReviewNote[]) => {
  if (urlStr.endsWith("/review-notes") && method === "GET") {
    return jsonResponse({ notes: reviewNotes });
  }
  if (urlStr.endsWith("/review-notes") && method === "POST") {
    return jsonResponse({
      note: {
        id: "note-new",
        filePath: "plan.md",
        selectedText: "Implementation steps",
        note: "Split this into backend and frontend sections.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  }
  if (urlStr.includes("/review-notes/") && method === "DELETE") {
    return jsonResponse({ ok: true });
  }
  return null;
};

const setupMockFetch = (
  files: string[],
  fileContents: Record<string, string> = {},
  reviewNotes: MockReviewNote[] = [],
) => {
  controlledReviewNotes = reviewNotes;
  mockFetch.mockImplementation((...args: unknown[]) => {
    const urlStr = extractUrl(args[0]);
    const method = ((args[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    if (urlStr.endsWith("/files")) {
      return Promise.resolve(jsonResponse({ files }));
    }
    const matchedReviewNotes = matchReviewNotes(urlStr, method, reviewNotes);
    if (matchedReviewNotes) return Promise.resolve(matchedReviewNotes);
    const matched = matchFileContent(urlStr, fileContents);
    if (matched) return Promise.resolve(matched);
    return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
  });
};

const setupPendingFetch = () => {
  mockFetch.mockImplementation(() => new Promise<Response>(() => {}));
};

const mockTextSelection = (
  text: string,
  rect: Partial<DOMRect> = {},
  rangeDetails: Partial<Range> = {},
) =>
  ({
    toString: () => text,
    rangeCount: text ? 1 : 0,
    getRangeAt: () =>
      ({
        getBoundingClientRect: () =>
          ({
            bottom: 240,
            height: 20,
            left: 120,
            right: 360,
            top: 220,
            width: 240,
            x: 120,
            y: 220,
            toJSON: () => ({}),
            ...rect,
          }) as DOMRect,
        ...rangeDetails,
      }) as Range,
    removeAllRanges: () => {},
  }) as unknown as Selection;

const findTextNode = (root: HTMLElement, text: string, occurrence = 0): Text => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let found = 0;
  let node = walker.nextNode();

  while (node) {
    if (node.nodeValue?.includes(text)) {
      if (found === occurrence) return node as Text;
      found += 1;
    }
    node = walker.nextNode();
  }

  throw new Error(`Unable to find text node for ${text}`);
};

const renderSpecsTab = (
  task: Task,
  notes: MockReviewNote[] = controlledReviewNotes,
  initialFilePath?: string,
) => (
  <SpecsTab
    task={task}
    notes={notes}
    initialFilePath={initialFilePath}
    onCreateNote={onCreateNote}
    onDeleteNote={onDeleteNote}
    onUpdateNote={onUpdateNote}
  />
);

describe("SpecsTab", () => {
  test("loads plan.md as default file", async () => {
    setupMockFetch(["task.md", "plan.md", "prd.md", "issues.md"], {
      "task.md": "# Task\n\n## Description\nDone",
      "issues.md": "# Issues\n\n## Agent Brief\nImplement",
      "prd.md": "# PRD\n\n## Problem\nNeed it",
      "plan.md": "# Plan\n\n## Steps\nReview",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.getByText("plan.md")).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
  });

  test("loads plan.md as default when no other spec docs exist", async () => {
    setupMockFetch(["task.md", "plan.md"], {
      "task.md": "# Task\n\n## Description\nDone",
      "plan.md": "# Plan\n\n## Steps\nReview",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.getByText("plan.md")).toBeTruthy();
  });

  test("loads requested handoff file when provided", async () => {
    setupMockFetch(["task.md", "plan.md", "report.md"], {
      "task.md": "# Task",
      "plan.md": "# Plan",
      "report.md": "# Report\n\nReady for review.",
    });

    render(renderSpecsTab(makeTask(), controlledReviewNotes, "report.md"));

    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.getByText("report.md")).toBeTruthy();
    expect(screen.getByText("Ready for review.")).toBeTruthy();
  });

  test("does not render or fetch the worker profile editor", async () => {
    setupMockFetch(["task.md"], {
      "task.md": "# Task\n\n## Description\nDone",
    });

    render(renderSpecsTab(makeTask()));

    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    const requestedUrls = mockFetch.mock.calls.map((call) => extractUrl((call as unknown[])[0]));
    expect(screen.queryByText("Worker Profile")).toBeNull();
    expect(screen.queryByText("Save Worker Profile")).toBeNull();
    expect(requestedUrls.some((url) => url.includes("native-agent-config"))).toBe(false);
  });

  test("shows file tree flyout", async () => {
    setupPendingFetch();
    render(renderSpecsTab(makeTask()));
    expect(screen.getByTestId("file-tree-flyout")).toBeTruthy();
  });

  test("shows loading state initially", () => {
    setupPendingFetch();
    render(renderSpecsTab(makeTask()));
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  test("switches files on selection via flyout", async () => {
    setupMockFetch(["task.md", "plan.md"], {
      "task.md": "# Task",
      "plan.md": "# Plan",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    fireEvent.click(screen.getByTestId("flyout-pill"));
    fireEvent.click(screen.getByTestId("file-plan.md"));
    await waitFor(() => expect(screen.getByText("plan.md")).toBeTruthy());
  });

  test("does not render progress bar (shown in header instead)", async () => {
    setupMockFetch(["task.md"], { "task.md": "# Task" });
    render(renderSpecsTab(makeTask({ taskProgress: { completed: 3, total: 10 } })));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());
    expect(screen.queryByTestId("specs-progress-bar")).toBeNull();
  });

  test("shows error on fetch failure", async () => {
    mockFetch.mockImplementation((...args: unknown[]) => {
      const urlStr = extractUrl(args[0]);
      if (urlStr.endsWith("/files")) {
        return Promise.resolve(jsonResponse({ files: ["task.md"] }));
      }
      return Promise.resolve(jsonResponse({ error: "Not found" }, 404));
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByText("Failed to load file")).toBeTruthy());
  });

  test("creates a review note from selected markdown text", async () => {
    setupMockFetch(["task.md", "plan.md"], {
      "task.md": "# Task",
      "plan.md": "Implementation steps",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    fireEvent.click(screen.getByTestId("flyout-pill"));
    fireEvent.click(screen.getByTestId("file-plan.md"));
    await waitFor(() => expect(screen.getByText("plan.md")).toBeTruthy());

    const originalSelection = window.getSelection;
    window.getSelection = () => mockTextSelection("Implementation steps");

    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));
    fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("Reviewer note"), {
      target: { value: "Split this into backend and frontend sections." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(onCreateNote).toHaveBeenCalled());
    expect(onCreateNote.mock.calls[0]?.[0]).toEqual({
      filePath: "plan.md",
      selectedText: "Implementation steps",
      note: "Split this into backend and frontend sections.",
    });

    window.getSelection = originalSelection;
  });

  test("stores which repeated text occurrence the note was created from", async () => {
    setupMockFetch(["plan.md"], {
      "plan.md": "First: Repeat me\n\nSecond: Repeat me",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    const markdown = screen.getByTestId("markdown-viewer");
    const secondRepeatNode = findTextNode(markdown, "Repeat me", 1);
    const originalSelection = window.getSelection;
    window.getSelection = () =>
      mockTextSelection(
        "Repeat me",
        {},
        {
          startContainer: secondRepeatNode,
          startOffset: secondRepeatNode.nodeValue?.indexOf("Repeat me") ?? 0,
          endContainer: secondRepeatNode,
          endOffset: (secondRepeatNode.nodeValue?.indexOf("Repeat me") ?? 0) + "Repeat me".length,
        },
      );

    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));
    fireEvent.click(await screen.findByRole("button", { name: "Add note" }));
    fireEvent.change(screen.getByLabelText("Reviewer note"), {
      target: { value: "This note belongs to the second occurrence." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));

    await waitFor(() => expect(onCreateNote).toHaveBeenCalled());
    expect(onCreateNote.mock.calls[0]?.[0]).toEqual({
      filePath: "plan.md",
      selectedText: "Repeat me",
      textOccurrence: 1,
      note: "This note belongs to the second occurrence.",
    });

    window.getSelection = originalSelection;
  });

  test("highlights the saved occurrence for repeated selected text", async () => {
    setupMockFetch(
      ["plan.md"],
      {
        "plan.md": "First: Repeat me\n\nSecond: Repeat me",
      },
      [
        {
          id: "note-second-repeat",
          filePath: "plan.md",
          selectedText: "Repeat me",
          textOccurrence: 1,
          note: "This note belongs to the second occurrence.",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    );

    render(renderSpecsTab(makeTask()));

    const highlight = await screen.findByTestId("annotation-highlight-note-second-repeat");
    expect(highlight.closest("p")?.textContent).toContain("Second:");
  });

  test("hides add note action when the text selection is cleared", async () => {
    setupMockFetch(["plan.md"], {
      "plan.md": "Implementation steps",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    const originalSelection = window.getSelection;
    window.getSelection = () => mockTextSelection("Implementation steps");

    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));
    expect(await screen.findByRole("button", { name: "Add note" })).toBeTruthy();

    window.getSelection = () => mockTextSelection("");
    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Add note" })).toBeNull());

    window.getSelection = originalSelection;
  });

  test("positions the add note action near the selected text", async () => {
    setupMockFetch(["plan.md"], {
      "plan.md": "Implementation steps",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    const originalSelection = window.getSelection;
    window.getSelection = () =>
      mockTextSelection("Implementation steps", {
        bottom: 340,
        left: 210,
        top: 320,
      });

    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));
    const addNote = await screen.findByRole("button", { name: "Add note" });

    // The add-note affordance renders a lucide Plus icon instead of a "+" glyph.
    expect(addNote.querySelector("svg")).toBeTruthy();
    expect(addNote.parentElement?.style.top).toBe("272px");
    expect(addNote.parentElement?.style.left).toBe("210px");

    window.getSelection = originalSelection;
  });

  test("lets the review note editor be moved by dragging its header", async () => {
    setupMockFetch(["plan.md"], {
      "plan.md": "Implementation steps",
    });
    render(renderSpecsTab(makeTask()));
    await waitFor(() => expect(screen.getByTestId("markdown-viewer")).toBeTruthy());

    const originalSelection = window.getSelection;
    window.getSelection = () =>
      mockTextSelection("Implementation steps", {
        bottom: 340,
        left: 210,
        top: 320,
      });

    fireEvent.mouseUp(screen.getByTestId("annotated-markdown-viewer"));
    fireEvent.click(await screen.findByRole("button", { name: "Add note" }));

    const editor = screen.getByTestId("review-note-editor");
    const dragHandle = screen.getByTestId("review-note-drag-handle");
    expect(editor.style.left).toBe("210px");
    expect(editor.style.top).toBe("352px");

    fireEvent.pointerDown(dragHandle, { clientX: 220, clientY: 362, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 336, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(editor.style.left).toBe("290px");
    expect(editor.style.top).toBe("326px");

    window.getSelection = originalSelection;
  });

  test("removes a review note marker after deleting it", async () => {
    setupMockFetch(["plan.md"], { "plan.md": "Implementation steps" }, [
      {
        id: "note-1",
        filePath: "plan.md",
        selectedText: "Implementation steps",
        note: "Remove this instruction.",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    render(renderSpecsTab(makeTask()));

    const marker = await screen.findByRole("button", { name: "Open note for plan.md" });
    fireEvent.click(marker);
    fireEvent.click(screen.getByRole("button", { name: "Delete note" }));

    await waitFor(() => expect(onDeleteNote).toHaveBeenCalledWith("note-1"));
  });

  test("shows a marker for a note whose selection spans inline code", async () => {
    setupMockFetch(
      ["plan.md"],
      {
        "plan.md":
          '- Add a root theme attribute such as `data-theme="light" | "dark"`.\n- Add a small theme preference hook.',
      },
      [
        {
          id: "note-inline-code",
          filePath: "plan.md",
          selectedText: 'Add a root theme attribute such as data-theme="light" | "dark".',
          note: "Create a third Valentine's Day theme with a red background.",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    );

    render(renderSpecsTab(makeTask()));

    expect(await screen.findByRole("button", { name: "Open note for plan.md" })).toBeTruthy();
    expect(screen.getByTestId("annotation-highlight-note-inline-code")).toBeTruthy();
  });
});
