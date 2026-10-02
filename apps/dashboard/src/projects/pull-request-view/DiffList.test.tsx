import { afterEach, describe, expect, mock, test } from "bun:test";
import type { PullRequestViewFile } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeFile } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { DiffList } = await import("./DiffList");

afterEach(cleanup);

const addedLines = (count: number) =>
  `@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, (_, index) => `+export const v${index} = ${index};`).join("\n")}`;

const renderList = (
  files: PullRequestViewFile[],
  { shown = [] as string[], collapsed = [] as string[], onShow = mock(), onToggle = mock() } = {},
) =>
  render(
    <DiffList
      files={files}
      diffStyle="unified"
      collapsed={new Set(collapsed)}
      shown={new Set(shown)}
      onToggle={onToggle}
      onShow={onShow}
      githubUrl="https://github.com/acme/app/pull/752"
    />,
  );

// Shiki loads once per process; the first highlight is the slow one.
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
const renderedLines = (path: string) =>
  document
    .querySelector(`[data-path="${path}"] diffs-container`)
    ?.shadowRoot?.querySelectorAll("[data-line][data-line-index]").length ?? 0;

describe("the diff list", () => {
  test("renders a file's diff with its header: status, path and counts", async () => {
    renderList([makeFile()]);
    await settle();
    const section = screen.getByTestId("pr-file");
    expect(section.textContent).toContain("src/impacts.ts");
    expect(section.textContent).toContain("+2");
    expect(renderedLines("src/impacts.ts")).toBeGreaterThan(0);
  }, 20_000);

  test("a large file waits behind Load diff, and nothing of it is rendered until asked", async () => {
    const onShow = mock();
    const big = makeFile({
      path: "gen.ts",
      status: "added",
      additions: 1_500,
      deletions: 0,
      patch: addedLines(1_500),
    });
    renderList([big], { onShow });
    await settle();
    expect(screen.getByTestId("pr-file-large").textContent).toContain("1,500 changed lines");
    expect(document.querySelector('[data-path="gen.ts"] diffs-container')).toBeNull();

    fireEvent.click(screen.getByTestId("pr-file-load"));
    expect(onShow).toHaveBeenCalledWith("gen.ts");
  }, 20_000);

  test("a very large file, once shown, is virtualized: only the lines near the view are in the DOM", async () => {
    const lines = 5_000;
    renderList(
      [
        makeFile({
          path: "huge.ts",
          status: "added",
          additions: lines,
          deletions: 0,
          patch: addedLines(lines),
        }),
      ],
      {
        shown: ["huge.ts"],
      },
    );
    await settle();
    const rendered = renderedLines("huge.ts");
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(lines / 10);
  }, 20_000);

  test("binary and rename-only files say so instead of a diff", () => {
    renderList([
      makeFile({ path: "logo.png", status: "added", additions: 0, deletions: 0, patch: null }),
      makeFile({
        path: "b.ts",
        previousPath: "a.ts",
        status: "renamed",
        additions: 0,
        deletions: 0,
        patch: null,
      }),
    ]);
    const notices = screen.getAllByTestId("pr-file-no-patch").map((notice) => notice.textContent);
    expect(notices[0]).toContain("Binary file");
    expect(notices[1]).toBe("File renamed without changes.");
    expect(screen.getAllByTestId("pr-file")[1]?.textContent).toContain("a.ts → b.ts");
  });

  test("a folded file shows only its header; its header folds and unfolds it", () => {
    const onToggle = mock();
    renderList([makeFile()], { collapsed: ["src/impacts.ts"], onToggle });
    expect(screen.getByTestId("pr-file").getAttribute("data-collapsed")).toBe("true");
    expect(document.querySelector("diffs-container")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(onToggle).toHaveBeenCalledWith("src/impacts.ts");
  });
});
