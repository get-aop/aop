import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { closeAttachRepoDialog, openAttachRepoDialog, resetDialogs } from "../shell/dialog-store";
import { setupDashboardDom } from "../test/setup-dom";
import { type FakeFolder, installFakeHost } from "./attach-repo/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { AttachRepoDialog } = await import("./AttachRepoDialog");

const originalFetch = globalThis.fetch;

// /repos holds a repository, a linked worktree of it, a folder of plain projects and a broken
// checkout (its .git points nowhere, so it is a plain folder to the host).
const TREE: FakeFolder = {
  children: {
    home: { children: { me: { children: { notes: {} } } } },
    repos: {
      children: {
        aop: { git: "repository", children: { src: {} } },
        "aop-feature": { git: "worktree", worktreeOf: "/repos/aop" },
        archive: { children: {} },
        plain: { children: { a: {} } },
        Projects: { children: {} },
      },
    },
  },
};

beforeEach(() => {
  installFakeHost(TREE);
  resetDialogs();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  closeAttachRepoDialog();
});

const open = async (onAttached = mock(() => {})) => {
  render(<AttachRepoDialog onAttached={onAttached} />);
  openAttachRepoDialog();
  return { onAttached, field: await screen.findByTestId("attach-repo-path-input") };
};

const typeInto = (field: HTMLElement, value: string) =>
  fireEvent.change(field, { target: { value } });

const press = (field: HTMLElement, key: string) => fireEvent.keyDown(field, { key });

const folderNames = () => screen.queryAllByTestId("attach-repo-dir").map((row) => row.textContent);

const goTo = async (field: HTMLElement, path: string) => {
  typeInto(field, path);
  press(field, "Enter");
  await waitFor(() =>
    expect((screen.getByTestId("attach-repo-path-input") as HTMLInputElement).value).toBe(path),
  );
};

describe("browsing folders", () => {
  test("marks repositories and worktrees in the list, and says why attach is off in a plain folder", async () => {
    const { field } = await open();
    await goTo(field, "/repos");

    const badges = screen
      .getAllByTestId("attach-repo-dir")
      .map((row) => [row.textContent, row.getAttribute("data-git-kind")]);
    expect(badges).toEqual([
      ["Projects", null],
      ["aopgit", "repository"],
      ["aop-featureworktree", "worktree"],
      ["archive", null],
      ["plain", null],
    ]);
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("attach-repo-hint").textContent).toBe(
      "Open a git repository folder to attach it",
    );
  });

  test("a click opens a folder, and a git repository can then be attached", async () => {
    const host = installFakeHost(TREE);
    const { onAttached, field } = await open();
    await goTo(field, "/repos");

    fireEvent.click(screen.getAllByTestId("attach-repo-dir")[1] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId("attach-repo-git-badge")).toBeTruthy());

    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("attach-repo-confirm"));
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith("repo_1"));
    expect(host.registered).toEqual(["/repos/aop"]);
  });

  test("the up button goes to the parent folder", async () => {
    const { field } = await open();
    await goTo(field, "/repos/plain");

    fireEvent.click(screen.getByTestId("attach-repo-up"));

    await waitFor(() =>
      expect((screen.getByTestId("attach-repo-path-input") as HTMLInputElement).value).toBe(
        "/repos",
      ),
    );
  });
});

describe("a linked worktree", () => {
  test("is attached where it is, and the main repository is offered instead", async () => {
    const host = installFakeHost(TREE);
    const { field } = await open();
    await goTo(field, "/repos/aop-feature");

    expect(screen.getByTestId("attach-repo-git-badge").getAttribute("data-kind")).toBe("worktree");
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("attach-repo-main-instead").textContent).toContain("/repos/aop");

    fireEvent.click(screen.getByTestId("attach-repo-confirm"));
    await waitFor(() => expect(host.registered).toEqual(["/repos/aop-feature"]));
  });

  test("the offer attaches the main repository", async () => {
    const host = installFakeHost(TREE);
    const { onAttached, field } = await open();
    await goTo(field, "/repos/aop-feature");

    fireEvent.click(screen.getByTestId("attach-repo-main-instead"));

    await waitFor(() => expect(onAttached).toHaveBeenCalledWith("repo_1"));
    expect(host.registered).toEqual(["/repos/aop"]);
  });

  test("a repository has no such offer", async () => {
    const { field } = await open();
    await goTo(field, "/repos/aop");

    expect(screen.queryByTestId("attach-repo-main-instead")).toBeNull();
  });
});

describe("the path field", () => {
  test("typing a folder's name narrows the folders to those that begin with it, in any case", async () => {
    const host = installFakeHost(TREE);
    const { field } = await open();
    await goTo(field, "/repos");
    host.listed.length = 0;

    typeInto(field, "/repos/A");

    expect(folderNames()).toEqual(["aopgit", "aop-featureworktree", "archive"]);
    typeInto(field, "/repos/aop-");
    expect(folderNames()).toEqual(["aop-featureworktree"]);
    typeInto(field, "/repos/zzz");
    expect(screen.getByText("No folder starts with “zzz”")).toBeTruthy();
    // The folder being narrowed is already on show: no new listing for each letter.
    expect(host.listed).toEqual([]);
  });

  test("typing a slash lists the folder just named", async () => {
    const host = installFakeHost(TREE);
    const { field } = await open();
    await goTo(field, "/repos");

    typeInto(field, "/repos/plain/");

    await waitFor(() => expect(folderNames()).toEqual(["a"]));
    expect(host.listed.at(-1)).toBe("/repos/plain");
    // Typing went on: the text is still what was typed, not the folder's resolved path.
    expect((field as HTMLInputElement).value).toBe("/repos/plain/");
  });

  test("a listing still on its way is dropped when the text goes back to the folder on show", async () => {
    const { field } = await open();
    await goTo(field, "/repos");

    typeInto(field, "/repos/plain/");
    typeInto(field, "/repos/pl");
    await Bun.sleep(20);

    expect(folderNames()).toEqual(["plain"]);
    expect(screen.getByTestId("attach-repo-path-input")).toBe(field);
    expect((field as HTMLInputElement).value).toBe("/repos/pl");
  });

  test("Enter goes to the typed folder, and ~ is the home folder", async () => {
    const host = installFakeHost(TREE);
    const { field } = await open();

    typeInto(field, "~/notes");
    press(field, "Enter");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("/home/me/notes"));
    expect(host.listed.at(-1)).toBe("~/notes");
  });

  test("a path that is not a folder shows an error and keeps the last listing", async () => {
    const { field } = await open();
    await goTo(field, "/repos");

    typeInto(field, "/nowhere");
    press(field, "Enter");

    const error = await screen.findByTestId("attach-repo-error");
    expect(error.textContent).toBe("Path not found");
    expect(folderNames()).toContain("plain");
    expect((field as HTMLInputElement).value).toBe("/nowhere");
  });

  test("while the text names a folder other than the one on show, nothing can be attached", async () => {
    const { field } = await open();
    await goTo(field, "/repos/aop-feature");
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(false);

    typeInto(field, "/nowhere");
    press(field, "Enter");
    await screen.findByTestId("attach-repo-error");
    // The worktree is still on show, but the field no longer names it.
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("attach-repo-main-instead")).toBeNull();

    // A half-typed subfolder of a repository on show: Enter opens it, the button does not attach.
    await goTo(field, "/repos/aop");
    typeInto(field, "/repos/aop/s");
    expect(folderNames()).toEqual(["src"]);
    expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("attach-repo-hint").textContent).toBe(
      "Press Enter to open the path you typed",
    );

    typeInto(field, "/repos/aop-feature");
    press(field, "Enter");
    await waitFor(() =>
      expect((screen.getByTestId("attach-repo-confirm") as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByTestId("attach-repo-main-instead")).toBeTruthy();
  });

  test("an unknown folder typed before a slash is reported while typing", async () => {
    const { field } = await open();
    await goTo(field, "/repos");

    typeInto(field, "/repos/missing/x");

    expect((await screen.findByTestId("attach-repo-error")).textContent).toBe("Path not found");
    expect(folderNames()).toContain("plain");
  });

  test("Tab completes the first folder that matches", async () => {
    const { field } = await open();
    await goTo(field, "/repos");
    typeInto(field, "/repos/pl");

    press(field, "Tab");

    expect((field as HTMLInputElement).value).toBe("/repos/plain/");
    await waitFor(() => expect(folderNames()).toEqual(["a"]));
  });

  test("the arrows pick a folder in the narrowed list, and Enter opens it", async () => {
    const { field } = await open();
    await goTo(field, "/repos");
    typeInto(field, "/repos/a");

    press(field, "ArrowDown");
    press(field, "ArrowDown");
    const picked = screen.getAllByTestId("attach-repo-dir")[1] as HTMLElement;
    expect(picked.getAttribute("data-highlighted")).toBe("true");
    press(field, "Enter");

    await waitFor(() => expect((field as HTMLInputElement).value).toBe("/repos/aop-feature"));
    expect(screen.getByTestId("attach-repo-git-badge").getAttribute("data-kind")).toBe("worktree");
  });

  test("→ at the end of the text completes the highlighted folder", async () => {
    const { field } = await open();
    await goTo(field, "/repos");
    typeInto(field, "/repos/a");
    press(field, "ArrowDown");
    press(field, "ArrowDown");
    press(field, "ArrowDown");

    (field as HTMLInputElement).setSelectionRange(8, 8);
    press(field, "ArrowRight");

    expect((field as HTMLInputElement).value).toBe("/repos/archive/");
  });

  test("a long path is cut from the start when the field is not in use, and shows once", async () => {
    const deep = `/${Array.from({ length: 9 }, (_, i) => `a-very-long-folder-name-${i}`).join("/")}`;
    const tree: FakeFolder = { children: {} };
    let folder = tree;
    for (const name of deep.split("/").filter(Boolean)) {
      const next: FakeFolder = { children: {} };
      folder.children = { [name]: next };
      folder = next;
    }
    installFakeHost(tree);
    const { field } = await open();
    await goTo(field, deep);

    fireEvent.blur(field);

    const shown = await screen.findByTestId("attach-repo-path");
    expect(shown.getAttribute("title")).toBe(deep);
    expect(shown.firstElementChild?.getAttribute("dir")).toBe("rtl");
    // The footer says why attaching is off; it does not repeat the path.
    expect(within(screen.getByTestId("attach-repo-dialog")).getAllByText(deep)).toHaveLength(1);
    // Fixed width at any length: the dialog's width is its own, never the path's.
    expect(screen.getByTestId("attach-repo-dialog").className).toContain("w-[560px]");
    expect(screen.getByTestId("attach-repo-dialog").className).toContain(
      "grid-cols-[minmax(0,1fr)]",
    );
  });
});
