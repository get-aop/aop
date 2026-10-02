import { describe, expect, mock, test } from "bun:test";
import { type ContextMenuInput, pageContextMenu, windowContextMenu } from "./context-menus";

const input = (overrides: Partial<ContextMenuInput> = {}): ContextMenuInput => ({
  linkURL: "",
  srcURL: "",
  mediaType: "none",
  isEditable: false,
  selectionText: "",
  editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: true },
  ...overrides,
});

const labels = (items: { label?: string; role?: string; type?: string }[]) =>
  items.map((item) => item.label ?? item.role ?? item.type);

describe("a right click in the app's window", () => {
  test("on a web link offers the AOP Browser, the default browser and a copy", () => {
    const actions = { openInBrowser: mock(), openExternal: mock(), copyText: mock() };
    const menu = windowContextMenu(input({ linkURL: "http://localhost:5173/" }), actions);

    expect(labels(menu)).toEqual(["Open in AOP Browser", "Open in Default Browser", "Copy Link"]);
    menu[0]?.click?.({} as never, undefined, {} as never);
    expect(actions.openInBrowser).toHaveBeenCalledWith("http://localhost:5173/");
  });

  test("on anything else is the usual editing menu, or nothing", () => {
    const actions = { openInBrowser: mock(), openExternal: mock(), copyText: mock() };
    expect(windowContextMenu(input({ linkURL: "mailto:a@b.c" }), actions)).toEqual([]);
    expect(labels(windowContextMenu(input({ isEditable: true }), actions))).toEqual([
      "cut",
      "copy",
      "paste",
      "selectAll",
    ]);
    expect(labels(windowContextMenu(input({ selectionText: "some text" }), actions))).toEqual([
      "copy",
    ]);
  });
});

describe("a right click in a page", () => {
  const actions = () => ({
    canGoBack: true,
    canGoForward: false,
    back: mock(),
    forward: mock(),
    reload: mock(),
    openInNewTab: mock(),
    copyText: mock(),
    copyImage: mock(),
    inspect: mock(),
  });

  test("on a link and an image offers tabs and copies, then Inspect", () => {
    const menu = pageContextMenu(
      input({
        linkURL: "https://a.example/",
        srcURL: "https://a.example/i.png",
        mediaType: "image",
      }),
      actions(),
    );
    expect(labels(menu)).toEqual([
      "Open Link in New Tab",
      "Copy Link Address",
      "separator",
      "Open Image in New Tab",
      "Copy Image",
      "separator",
      "Back",
      "Forward",
      "Reload",
      "separator",
      "Inspect",
    ]);
  });

  test("on the page itself offers back, forward as far as it can go, reload and Inspect", () => {
    const menu = pageContextMenu(input(), actions());
    expect(labels(menu)).toEqual(["Back", "Forward", "Reload", "separator", "Inspect"]);
    expect(menu[1]?.enabled).toBe(false);
  });
});
