import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { toast } from "sonner";
import { setupDashboardDom } from "../../../test/setup-dom";
import { makeThread } from "../../test-utils";
import { hostError, json, mockHost } from "../test-utils";
import {
  binary,
  DIFF_URL,
  fileUrl,
  DiffHarness as Harness,
  manyFiles,
  modified,
  serveDiff,
  untracked,
} from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { resetThreadReviewQueueCacheForTests } = await import("./review-queue");
const { initialCollapsedForDiff, LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD } = await import(
  "./use-thread-diff"
);

const THREAD_ID = "thr_1";

let host: ReturnType<typeof mockHost>;
let toastError: ReturnType<typeof spyOn<typeof toast, "error">>;

const serve = (files: Parameters<typeof serveDiff>[1], answers?: Parameters<typeof serveDiff>[2]) =>
  serveDiff(host, files, answers);

beforeEach(() => {
  window.localStorage.clear();
  resetThreadReviewQueueCacheForTests();
  host = mockHost();
  toastError = spyOn(toast, "error").mockImplementation(() => "");
});

afterEach(() => {
  cleanup();
  host.restore();
  toastError.mockRestore();
});

const files = () => screen.getAllByTestId("thread-diff-file");
const fileRequests = (path: string) => host.to(fileUrl(path), "GET");
const summaryRequests = () => host.to(DIFF_URL, "GET");
const settled = () => act(async () => {});

describe("the files", () => {
  test("show while the list is read, then as one section per file under the branch they compare", async () => {
    serve([modified, binary]);
    render(<Harness />);
    expect(screen.getByTestId("thread-diff-loading")).toBeTruthy();

    await waitFor(() => expect(files()).toHaveLength(2));

    expect(files().map((file) => file.getAttribute("data-path"))).toEqual(["src/a.ts", "logo.png"]);
    expect(screen.getByTestId("thread-diff-file-count").textContent).toBe("2 files");
    expect(screen.getByTestId("thread-changes").textContent).toContain("main");
    expect(screen.getByTestId("thread-changes").textContent).toContain("aop/fix-login");
  });

  test("small change sets start open, and each file's lines are asked for once", async () => {
    serve([modified, binary]);
    render(<Harness />);

    await waitFor(() =>
      expect(screen.getAllByTestId("thread-diff-line").length).toBeGreaterThan(0),
    );
    await settled();

    expect(files().every((file) => file.getAttribute("data-collapsed") === "false")).toBe(true);
    expect(fileRequests("src/a.ts")).toHaveLength(1);
    expect(fileRequests("logo.png")).toHaveLength(1);
    expect(summaryRequests()).toHaveLength(1);
    expect(files()[0]?.textContent).toContain("src/a.ts");
    expect(files()[0]?.textContent).toContain("+1");
    expect(files()[0]?.textContent).toContain("−1");
  });

  test("a file the host has not counted shows nothing to count until its lines arrive", async () => {
    let release: (response: Response) => void = () => {};
    const body = new Promise<Response>((resolve) => {
      release = resolve;
    });
    serve([untracked], { "NOTES.md": body });
    render(<Harness />);

    await screen.findByTestId("thread-diff-file-loading");
    expect(files()[0]?.textContent).toContain("+0");

    await act(async () => release(json(untracked)));

    await waitFor(() => expect(files()[0]?.textContent).toContain("+3"));
    expect(screen.queryByTestId("thread-diff-file-loading")).toBeNull();
    expect(screen.getAllByTestId("thread-diff-line")).toHaveLength(3);
  });

  test("lines carry their numbers and kind, and a binary file says its content is not shown", async () => {
    serve([modified, binary]);
    render(<Harness />);
    await screen.findAllByTestId("thread-diff-line");

    const removed = screen
      .getAllByTestId("thread-diff-line")
      .find((row) => row.getAttribute("data-line-type") === "del");
    expect(removed?.textContent).toContain("const b = 2;");
    expect(removed?.textContent).toContain("2");
    const insertion = screen
      .getAllByTestId("thread-diff-line")
      .find((row) => row.getAttribute("data-line-type") === "add");
    expect(insertion?.textContent).toContain("const b = 3;");
    await screen.findByText("Binary file — content not shown.");
  });

  test("code is highlighted for a language it knows once the lines are in", async () => {
    serve([modified]);
    render(<Harness />);
    await screen.findAllByTestId("thread-diff-line");

    const line = screen
      .getAllByTestId("thread-diff-line")
      .find((row) => row.textContent?.includes("const a = 1;"));
    const syntax = line?.querySelector("[data-syntax-language]");
    expect(syntax?.getAttribute("data-syntax-language")).toBe("typescript");
    await waitFor(() => expect(syntax?.getAttribute("data-syntax-highlighted")).toBe("true"));
  });

  test("a long run of unchanged lines is folded, and opens and shuts on request", async () => {
    serve([modified]);
    render(<Harness />);

    const fold = await screen.findByTestId("thread-diff-fold");
    expect(fold.textContent).toContain("4 unmodified lines");
    const hidden = "const c4 = 4;";
    expect(screen.queryByText(hidden, { exact: false })).toBeNull();

    fireEvent.click(fold);
    expect(screen.queryByTestId("thread-diff-fold")).toBeNull();
    expect(screen.getAllByText(hidden, { exact: false }).length).toBeGreaterThan(0);
    const collapse = screen.getByTestId("thread-diff-fold-collapse");
    expect(collapse.getAttribute("aria-label")).toBe("Collapse 4 unmodified lines");

    fireEvent.click(collapse);
    expect(screen.getByTestId("thread-diff-fold")).toBeTruthy();
    expect(screen.queryByText(hidden, { exact: false })).toBeNull();
  });
});

describe("only while the changes are on screen", () => {
  test("the list is read at once, but no file's lines are until the tab shows", async () => {
    serve([modified, binary]);
    const { rerender } = render(<Harness visible={false} />);
    await waitFor(() => expect(files()).toHaveLength(2));
    await settled();

    expect(summaryRequests()).toHaveLength(1);
    expect(host.requests.filter((request) => request.url.includes("/diff/file"))).toHaveLength(0);
    expect(screen.queryAllByTestId("thread-diff-line")).toHaveLength(0);

    rerender(<Harness visible />);

    await screen.findAllByTestId("thread-diff-line");
    expect(fileRequests("src/a.ts")).toHaveLength(1);
    expect(summaryRequests()).toHaveLength(1);
  });
});

describe("large change sets", () => {
  const large = () => manyFiles(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD);

  test("start folded and read no file's lines until it is opened", async () => {
    serve(large());
    render(<Harness />);

    await waitFor(() => expect(files()).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD));
    await settled();

    expect(files().every((file) => file.getAttribute("data-collapsed") === "true")).toBe(true);
    expect(host.requests.filter((request) => request.url.includes("/diff/file"))).toHaveLength(0);
    expect(screen.queryAllByTestId("thread-diff-line")).toHaveLength(0);
  });

  test("opening one reads its lines exactly once, however often it is opened again", async () => {
    serve(large());
    render(<Harness />);
    await waitFor(() => expect(files()).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD));

    const header = within(files()[0] as HTMLElement).getByRole("button");
    fireEvent.click(header);
    await waitFor(() => expect(screen.getAllByTestId("thread-diff-line")).toHaveLength(1));
    fireEvent.click(header);
    expect(files()[0]?.getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(header);
    await settled();

    expect(files()[0]?.getAttribute("data-collapsed")).toBe("false");
    expect(fileRequests("src/file-0.ts")).toHaveLength(1);
    expect(host.requests.filter((request) => request.url.includes("/diff/file"))).toHaveLength(1);
  });

  test("Expand all reads every file, and Collapse all folds them again", async () => {
    serve(manyFiles(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD));
    render(<Harness />);
    await waitFor(() => expect(files()).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD));

    fireEvent.click(screen.getByText("Expand all"));

    await waitFor(() =>
      expect(screen.getAllByTestId("thread-diff-line")).toHaveLength(
        LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD,
      ),
    );
    expect(files().every((file) => file.getAttribute("data-collapsed") === "false")).toBe(true);

    fireEvent.click(screen.getByText("Collapse all"));
    expect(files().every((file) => file.getAttribute("data-collapsed") === "true")).toBe(true);
  });
});

describe("initialCollapsedForDiff", () => {
  const named = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ path: `f${index}.ts` }));

  test("keeps small change sets open", () => {
    expect(initialCollapsedForDiff(named(2))).toEqual({});
    expect(initialCollapsedForDiff(named(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD - 1))).toEqual({});
  });

  test("folds every file once the set is large", () => {
    const collapsed = initialCollapsedForDiff(named(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD));

    expect(Object.keys(collapsed)).toHaveLength(LARGE_DIFF_AUTO_COLLAPSE_THRESHOLD);
    expect(Object.values(collapsed).every(Boolean)).toBe(true);
  });
});

describe("collapse and expand all", () => {
  test("fold every file and open them again, and only offer it for two files or more", async () => {
    serve([modified, binary]);
    render(<Harness />);
    await waitFor(() => expect(files()).toHaveLength(2));

    fireEvent.click(screen.getByText("Collapse all"));
    expect(files().every((file) => file.getAttribute("data-collapsed") === "true")).toBe(true);
    expect(screen.queryAllByTestId("thread-diff-line")).toHaveLength(0);

    fireEvent.click(screen.getByText("Expand all"));
    expect(files().every((file) => file.getAttribute("data-collapsed") === "false")).toBe(true);
    await screen.findAllByTestId("thread-diff-line");
  });

  test("a single file has nothing to fold all of", async () => {
    serve([modified]);
    render(<Harness />);
    await waitFor(() => expect(files()).toHaveLength(1));

    expect(screen.queryByText("Collapse all")).toBeNull();
    expect(screen.queryByText("Expand all")).toBeNull();
    expect(screen.getByTestId("thread-diff-file-count").textContent).toBe("1 file");
  });
});

describe("a file whose lines cannot be read", () => {
  test("is reported once and never asked for again", async () => {
    serve([modified, binary], {
      "src/a.ts": hostError(500, "GIT_FAILED", "git could not read the file"),
    });
    render(<Harness />);

    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
    expect(toastError).toHaveBeenCalledWith("git could not read the file");
    await settled();
    await settled();

    expect(fileRequests("src/a.ts")).toHaveLength(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("thread-diff-file-loading")).toBeNull();
    expect(files().map((file) => file.getAttribute("data-path"))).toContain("src/a.ts");
  });
});

describe("reading again", () => {
  test("the refresh button reads the list again and shows what is new", async () => {
    serve([modified]);
    render(<Harness />);
    await waitFor(() => expect(files()).toHaveLength(1));

    serve([modified, untracked]);
    fireEvent.click(screen.getByTestId("thread-diff-refresh"));

    await waitFor(() => expect(files()).toHaveLength(2));
    expect(summaryRequests()).toHaveLength(2);
    expect(files().map((file) => file.getAttribute("data-path"))).toEqual(["src/a.ts", "NOTES.md"]);
  });

  test("a new refresh key, which is a turn that ended, reads the list again", async () => {
    serve([modified]);
    const { rerender } = render(<Harness refreshKey="working:1" />);
    await waitFor(() => expect(files()).toHaveLength(1));
    expect(summaryRequests()).toHaveLength(1);

    serve([modified, binary]);
    rerender(<Harness refreshKey="idle:2" />);

    await waitFor(() => expect(files()).toHaveLength(2));
    expect(summaryRequests()).toHaveLength(2);
  });

  test("the same key does not", async () => {
    serve([modified]);
    const { rerender } = render(<Harness refreshKey="idle:2" />);
    await waitFor(() => expect(files()).toHaveLength(1));

    rerender(<Harness refreshKey="idle:2" />);
    await settled();

    expect(summaryRequests()).toHaveLength(1);
  });
});

describe("when there is nothing to show", () => {
  test("a worktree the host cannot open is said in the host's own words", async () => {
    host.respondWith(() =>
      hostError(409, "WORKTREE_FAILED", "The thread's git worktree failed: no such directory"),
    );
    render(<Harness />);

    const note = await screen.findByTestId("thread-diff-unavailable");
    expect(note.getAttribute("role")).toBe("alert");
    expect(note.textContent).toBe("The thread's git worktree failed: no such directory");
  });

  test("for a resolved thread, whose worktree is meant to be gone, it says so plainly", async () => {
    host.respondWith(() =>
      hostError(409, "WORKTREE_FAILED", "The thread's git worktree failed: no such directory"),
    );
    render(<Harness thread={makeThread({ id: THREAD_ID, status: "resolved" })} />);

    const note = await screen.findByTestId("thread-diff-unavailable");
    expect(note.textContent).toContain("This thread is resolved, so its worktree is gone.");
    expect(note.textContent).not.toContain("no such directory");
  });

  test("a thread that changed nothing says so, and offers no folding", async () => {
    serve([]);
    render(<Harness />);

    await screen.findByTestId("thread-diff-empty");
    expect(screen.getByTestId("thread-diff-empty").textContent).toBe(
      "No changes in this worktree.",
    );
    expect(screen.queryByTestId("thread-diff-file-count")).toBeNull();
    expect(screen.queryByText("Collapse all")).toBeNull();
    expect(screen.getByTestId("thread-diff-refresh")).toBeTruthy();
  });
});
