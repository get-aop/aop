import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { LibraryItem } from "@aop/common";
import { type ApiCall, headersOf, mockApi } from "../../test/mock-api";
import { setupDashboardDom } from "../../test/setup-dom";
import { makeEntry, makeProject, makeThread } from "../test-utils";
import { makeItem, makeListing, NOW } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { ConfirmationHost } = await import("../../components/ConfirmationHost");
const { LibraryPanel } = await import("./LibraryPanel");
const { openInLibrary } = await import("../artifact-view/library-link");

const project = makeProject({ id: "p1", name: "Checkout" });
const thread = makeThread({ id: "thr_9", projectId: "p1", title: "Fix the checkout bug" });

let items: LibraryItem[];
let api: ReturnType<typeof mockApi>;
let failList: boolean;
const revealChat = mock(() => {});

const report = () =>
  makeItem({
    id: "lib_report",
    name: "report.md",
    folder: "Artifacts",
    expiresInDays: 2,
    usedIn: { threadId: "thr_9", messageId: null },
  });
const screenshot = () =>
  makeItem({
    id: "lib_shot",
    name: "image-1.png",
    folder: "Sent in chat",
    source: "chat",
    mimeType: "image/png",
    size: 5000,
    expiresInDays: 20,
    usedIn: { threadId: null, messageId: "smsg_1" },
  });
const brief = () =>
  makeItem({
    id: "lib_brief",
    name: "brief.txt",
    folder: "Uploads",
    source: "upload",
    mimeType: "text/plain",
    size: 300,
  });

beforeEach(() => {
  // The items' dates are relative to NOW, so "Removed in 2 days" must not drift with the real clock.
  setSystemTime(new Date(NOW));
  window.localStorage.clear();
  window.history.replaceState(null, "", "/projects/p1/library");
  items = [report(), screenshot(), brief()];
  failList = false;
  revealChat.mockClear();
  api = mockApi(stubHost);
});

// The host's Library over `items`: what the tab reads and every change it makes.
const stubHost = (call: ApiCall): Response | undefined => {
  const itemId = call.path.match(/^\/projects\/p1\/library\/items\/([^/?]+)/)?.[1];
  if (call.method === "GET" && call.path === "/projects/p1/library") {
    return failList
      ? Response.json({ error: "The host is down" }, { status: 500 })
      : Response.json(makeListing(items));
  }
  if (call.method === "POST") return addUpload(call);
  if (!itemId) return undefined;
  if (call.method === "PATCH") {
    items = items.map((item) =>
      item.id === itemId ? { ...item, ...(call.body as Partial<LibraryItem>) } : item,
    );
    return Response.json({ item: items.find((item) => item.id === itemId) });
  }
  if (call.method === "DELETE") {
    items = items.filter((item) => item.id !== itemId);
    return new Response(null, { status: 204 });
  }
  return contentOf(items.find((candidate) => candidate.id === itemId));
};

const addUpload = (call: ApiCall): Response => {
  const file = call.body as File;
  const item = makeItem({
    id: `lib_${items.length + 1}`,
    name: decodeURIComponent(headersOf(call)["X-File-Name"] ?? ""),
    folder: new URL(call.path, "http://x").searchParams.get("folder") ?? "Uploads",
    source: "upload",
    size: file.size,
  });
  items = [item, ...items];
  return Response.json({ item }, { status: 201 });
};

const contentOf = (item: LibraryItem | undefined): Response =>
  item?.mimeType === "image/png"
    ? new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }))
    : new Response(`# Report\n\nAll **good**. ${item?.name}`);

afterEach(() => {
  cleanup();
  api.restore();
  setSystemTime();
});

const renderPanel = async () => {
  render(
    <>
      <LibraryPanel entry={makeEntry(project, [thread])} revealChat={revealChat} />
      <ConfirmationHost />
    </>,
  );
  await screen.findByTestId("library-list");
};

const openFolder = (path: string) =>
  fireEvent.click(
    screen
      .getAllByTestId("library-folder")
      .find((folder) => folder.getAttribute("data-folder") === path) as HTMLElement,
  );

// The test DOM does not submit a form from its button's click; the browser check covers that.
const save = () =>
  fireEvent.submit(screen.getByTestId("library-edit-input").closest("form") as HTMLFormElement);

const rowNames = () =>
  screen.queryAllByTestId("library-item").map((row) => row.getAttribute("data-item-id"));

const openMenu = async (itemId: string) => {
  const row = screen
    .getAllByTestId("library-item")
    .find((candidate) => candidate.getAttribute("data-item-id") === itemId) as HTMLElement;
  fireEvent.pointerDown(within(row).getByTestId("library-item-menu"), {
    button: 0,
    ctrlKey: false,
  });
  return screen.findByTestId("library-item-menu-content");
};

const act$ = async (itemId: string, action: string) => {
  await openMenu(itemId);
  fireEvent.click(await screen.findByTestId(`library-action-${action}`));
};

describe("the Library tab", () => {
  test("opens on its folders, and a folder on its files with when retention takes them", async () => {
    await renderPanel();

    expect(
      screen.getAllByTestId("library-folder").map((folder) => folder.getAttribute("data-folder")),
    ).toEqual(["Artifacts", "Sent in chat", "Uploads"]);
    expect(rowNames()).toEqual([]);
    expect(screen.getByTestId("library-usage-project").textContent).toBe("7.2 KB");
    expect(screen.getByTestId("library-usage").textContent).toContain("of 1 GB");
    expect(screen.getByTestId("library-usage-host").textContent).toBe(
      "All projects on this host: 50 MB of 5 GB",
    );

    openFolder("Artifacts");

    expect(rowNames()).toEqual(["lib_report"]);
    const expiry = screen.getByTestId("library-item-expiry");
    expect(expiry.textContent).toMatch(/^Removed in [23] days$/);
    expect(expiry.className).toContain("text-waiting");
    fireEvent.click(screen.getByTestId("library-crumb"));
    expect(screen.getAllByTestId("library-folder")).toHaveLength(3);
  });

  test("search and the type filter show matches from every folder", async () => {
    await renderPanel();

    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "brief" } });
    expect(rowNames()).toEqual(["lib_brief"]);
    expect(screen.queryAllByTestId("library-folder")).toEqual([]);

    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("library-no-matches")).toBeTruthy();
    fireEvent.click(
      within(screen.getByTestId("library-no-matches")).getByText("Clear search and filters"),
    );

    fireEvent.pointerDown(screen.getByTestId("library-type-filter"), { button: 0, ctrlKey: false });
    const images = (await screen.findAllByTestId("library-type-option")).find(
      (option) => option.getAttribute("data-value") === "image",
    ) as HTMLElement;
    fireEvent.click(images);
    expect(rowNames()).toEqual(["lib_shot"]);
    expect(screen.getByTestId("library-type-filter").textContent).toBe("Images");
  });

  test("sorts by size from the column, and switches to a grid that keeps the choice", async () => {
    await renderPanel();
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "." } });

    fireEvent.click(screen.getByTestId("library-sort-size"));
    expect(rowNames()).toEqual(["lib_shot", "lib_report", "lib_brief"]);
    fireEvent.click(screen.getByTestId("library-sort-size"));
    expect(rowNames()).toEqual(["lib_brief", "lib_report", "lib_shot"]);

    fireEvent.click(screen.getByTestId("library-layout-grid"));
    expect(await screen.findByTestId("library-grid")).toBeTruthy();
    expect(await screen.findByTestId("library-thumbnail")).toBeTruthy();
    expect(window.localStorage.getItem("aop:library-layout:v1")).toBe("grid");
  });

  test("Add uploads the chosen files into the folder that is open", async () => {
    await renderPanel();
    openFolder("Artifacts");

    const input = screen.getByTestId("library-file-input") as HTMLInputElement;
    const file = new File(["hello"], "notes v2.md", { type: "text/markdown" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    await waitFor(() => expect(rowNames()).toContain("lib_4"));
    const upload = api.writes()[0];
    expect(upload?.path).toBe("/projects/p1/library?folder=Artifacts");
    expect(headersOf(upload)["X-File-Name"]).toBe("notes%20v2.md");
  });

  test("files dropped on the tab are added, with a drop target while they hover", async () => {
    await renderPanel();
    const panel = screen.getByTestId("library-panel");
    const file = new File(["x"], "dropped.txt", { type: "text/plain" });
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "none" };

    fireEvent.dragEnter(panel, { dataTransfer });
    expect(screen.getByTestId("library-drop-overlay").textContent).toBe("Drop to add to Uploads");
    await act(async () => {
      fireEvent.drop(panel, { dataTransfer });
    });

    expect(screen.queryByTestId("library-drop-overlay") === null).toBe(true);
    await waitFor(() => expect(api.writes()[0]?.path).toBe("/projects/p1/library"));
  });

  test("rename, move and pin through an item's menu", async () => {
    await renderPanel();
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "report" } });

    await act$("lib_report", "rename");
    fireEvent.change(screen.getByTestId("library-edit-input"), { target: { value: "a/b" } });
    expect(screen.getByTestId("library-edit-problem").textContent).toContain("without /");
    fireEvent.change(screen.getByTestId("library-edit-input"), { target: { value: "final.md" } });
    save();
    await waitFor(() => expect(screen.queryByTestId("library-rename-dialog") === null).toBe(true));

    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "final" } });
    await act$("lib_report", "move");
    fireEvent.change(screen.getByTestId("library-edit-input"), { target: { value: "Reports/Q3" } });
    save();
    await waitFor(() => expect(screen.queryByTestId("library-move-dialog") === null).toBe(true));

    await act$("lib_report", "pin");
    await waitFor(() =>
      expect(screen.getAllByTestId("library-item")[0]?.getAttribute("data-pinned")).toBe("true"),
    );
    expect(api.writes().map((call) => call.body)).toEqual([
      { name: "final.md" },
      { folder: "Reports/Q3" },
      { pinned: true },
    ]);
  });

  test("delete asks first, and says a sent image's message will show it as deleted", async () => {
    await renderPanel();
    fireEvent.change(screen.getByTestId("library-search"), { target: { value: "image" } });

    await act$("lib_shot", "delete");
    const confirm = await screen.findByTestId("confirm-dialog-confirm");
    expect(document.body.textContent).toContain("shows the file as deleted");
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(api.writes()).toEqual([
        expect.objectContaining({ method: "DELETE", path: "/projects/p1/library/items/lib_shot" }),
      ]),
    );
    await waitFor(() => expect(rowNames()).toEqual([]));
  });

  test("a preview shows markdown, its facts and its thread, and pins from there", async () => {
    await renderPanel();
    openFolder("Artifacts");

    fireEvent.click(screen.getByTestId("library-item-open"));

    const preview = await screen.findByTestId("library-preview");
    expect(preview.getAttribute("data-kind")).toBe("markdown");
    await within(preview).findByTestId("library-preview-markdown");
    expect(within(preview).getByTestId("library-used-in").textContent).toBe(
      "From thread “Fix the checkout bug”",
    );
    expect(within(preview).getByTestId("library-retention").textContent).toMatch(/Removed in/);

    fireEvent.click(within(preview).getByTestId("library-preview-pin"));
    await waitFor(() =>
      expect(within(preview).getByTestId("library-retention").textContent).toContain("Pinned"),
    );

    fireEvent.click(within(preview).getByTestId("library-used-in"));
    expect(window.location.pathname).toBe("/projects/p1/threads/thr_9");
    expect(screen.queryByTestId("library-preview") === null).toBe(true);
  });

  test("a file opens beside the chat in the artifact view, from its menu or its preview", async () => {
    await renderPanel();
    openFolder("Artifacts");

    await act$("lib_report", "viewer");
    expect(window.location.pathname).toBe("/projects/p1/library/artifacts/lib_report");

    window.history.replaceState(null, "", "/projects/p1/library");
    fireEvent.click(screen.getByTestId("library-item-open"));
    fireEvent.click(await screen.findByTestId("library-preview-viewer"));
    expect(window.location.pathname).toBe("/projects/p1/library/artifacts/lib_report");
    expect(screen.queryByTestId("library-preview")).toBeNull();
  });

  test("Open in Library from the artifact view shows the file in its folder, previewed", async () => {
    window.history.replaceState(null, "", "/projects/p1/artifacts/lib_brief");
    act(() => openInLibrary("p1", "lib_brief"));
    // The artifact view stays open; the panel shows the Library tab.
    expect(window.location.pathname).toBe("/projects/p1/library/artifacts/lib_brief");

    await renderPanel();
    const preview = await screen.findByTestId("library-preview");
    expect(within(preview).getByText("brief.txt")).toBeTruthy();
    expect(rowNames()).toContain("lib_brief");
  });

  test("an image previews as an image; its message link opens the coordinator chat", async () => {
    await renderPanel();
    openFolder("Sent in chat");

    fireEvent.click(screen.getByTestId("library-item-open"));
    const preview = await screen.findByTestId("library-preview");
    await within(preview).findByTestId("library-preview-image");
    expect(within(preview).getByTestId("library-used-in").textContent).toBe(
      "Message in the coordinator chat",
    );

    fireEvent.click(within(preview).getByTestId("library-used-in"));
    expect(revealChat).toHaveBeenCalledTimes(1);
  });

  test("an empty Library explains what lands in it", async () => {
    items = [];
    render(<LibraryPanel entry={makeEntry(project)} revealChat={revealChat} />);

    expect((await screen.findByTestId("library-empty")).textContent).toContain(
      "Nothing in the Library yet",
    );
    expect(screen.getByTestId("library-usage-project").textContent).toBe("0 B");
  });

  test("a Library that cannot load says why and tries again", async () => {
    failList = true;
    render(<LibraryPanel entry={makeEntry(project)} revealChat={revealChat} />);

    expect((await screen.findByTestId("library-error")).textContent).toContain("The host is down");
    failList = false;
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByTestId("library-list")).toBeTruthy();
  });

  test("the tip about agents goes once dismissed", async () => {
    await renderPanel();

    fireEvent.click(screen.getByTestId("library-tip-dismiss"));

    expect(screen.queryByTestId("library-tip") === null).toBe(true);
    expect(window.localStorage.getItem("aop:library-tip-dismissed:v1")).toBe("true");
  });
});
