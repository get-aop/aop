import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PullRequestViewFile } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { hostError, json, mockHost } from "../thread/test-utils";
import { MANY_FILES } from "./diff-files";
import { makeDetail, makeFile } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { FilesTab } = await import("./FilesTab");
// The tab loads the diff renderer lazily; loading it here keeps each test's wait short.
await import("./DiffList");

let host: ReturnType<typeof mockHost>;
beforeEach(() => {
  window.localStorage.clear();
  host = mockHost();
});
afterEach(() => {
  cleanup();
  host.restore();
});

const mount = async (files: PullRequestViewFile[] | Response) => {
  host.respondWith(() =>
    files instanceof Response ? files.clone() : json({ files, truncated: false }),
  );
  render(
    <FilesTab pullKey={{ projectId: "p1", repoId: "repo_1", number: 752 }} detail={makeDetail()} />,
  );
  // The diff renderer is a lazy module.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 200)));
};

const sections = () =>
  screen.queryAllByTestId("pr-file").map((section) => section.getAttribute("data-path"));

describe("the Files changed tab", () => {
  test("the tree lists the files; a file in it opens its diff and scrolls to it", async () => {
    const scrolled: string[] = [];
    await mount([makeFile({ path: "src/a.ts" }), makeFile({ path: "src/b.ts" })]);
    for (const section of screen.getAllByTestId("pr-file")) {
      section.scrollIntoView = () => scrolled.push(section.id);
    }
    expect(
      screen.getAllByTestId("pr-file-tree-file").map((node) => node.getAttribute("data-path")),
    ).toEqual(["src/a.ts", "src/b.ts"]);
    fireEvent.click(screen.getAllByTestId("pr-file-tree-file")[1] as HTMLElement);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(scrolled).toEqual(["pr-file-src%2Fb.ts"]);

    fireEvent.click(screen.getByTestId("pr-file-tree-toggle"));
    expect(screen.queryByTestId("pr-file-tree")).toBeNull();
  }, 20_000);

  test("the filter narrows the files to paths that contain it", async () => {
    await mount([makeFile({ path: "src/a.ts" }), makeFile({ path: "docs/readme.md" })]);
    fireEvent.change(screen.getByTestId("pr-files-filter"), { target: { value: "DOCS" } });
    await act(async () => {});
    expect(sections()).toEqual(["docs/readme.md"]);
    fireEvent.change(screen.getByTestId("pr-files-filter"), { target: { value: "nothing" } });
    expect(screen.getByText("No file matches “nothing”.")).toBeTruthy();
  }, 20_000);

  test("unified or split is the person's choice, kept in this browser", async () => {
    await mount([makeFile()]);
    expect(screen.getByTestId("pr-diff-unified").getAttribute("data-state")).toBe("on");
    fireEvent.click(screen.getByTestId("pr-diff-split"));
    await act(async () => {});
    expect(screen.getByTestId("pr-diff-split").getAttribute("data-state")).toBe("on");
    expect(window.localStorage.getItem("aop:pr-view:diff-style")).toBe("split");
  }, 20_000);

  test(`more than ${MANY_FILES} files start folded, so none of their lines are drawn`, async () => {
    await mount(
      Array.from({ length: MANY_FILES + 1 }, (_, index) => makeFile({ path: `m/${index}.ts` })),
    );
    const folded = screen
      .getAllByTestId("pr-file")
      .filter((section) => section.getAttribute("data-collapsed") === "true");
    expect(folded).toHaveLength(MANY_FILES + 1);
    expect(document.querySelector("diffs-container")).toBeNull();
  }, 20_000);

  test("no files, and a failed read with a way to try again", async () => {
    await mount([]);
    const empty = screen.getByTestId("pr-files-empty");
    expect(empty.textContent).toContain("changes no files");
    // Clear of the column's edges, like the error state.
    expect(empty.className).toContain("m-6");
    cleanup();

    await mount(hostError(502, "GITHUB_FAILED", "GitHub is down"));
    expect(screen.getByTestId("pr-files-error").textContent).toContain("GitHub is down");
    host.respondWith(() => json({ files: [makeFile()], truncated: false }));
    fireEvent.click(screen.getByText("Try again"));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(sections()).toEqual(["src/impacts.ts"]);
  }, 20_000);
});
