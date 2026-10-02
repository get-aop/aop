import { describe, expect, test } from "bun:test";
import { AOP_BROWSER_PARTITION } from "@aop/common";
import type { WebContents } from "electron";
import { createBrowserHost } from "./browser-host";
import { FakeContents, FakeDownload, fakeBrowserDeps } from "./test-utils";

const keyDown = (code: string, modifiers: Record<string, boolean> = {}) => ({
  type: "keyDown",
  code,
  key: code,
  shift: false,
  control: false,
  alt: false,
  meta: false,
  ...modifiers,
});

const setup = (existing?: string[]) => {
  const fakes = fakeBrowserDeps(existing);
  const host = createBrowserHost(fakes.deps);
  const window = new FakeContents(1, "app://aop/projects/p1/browser");
  host.attachWindow(window as unknown as WebContents);
  const attachGuest = (id = 7) => {
    const guest = new FakeContents(id, "https://meet.example/room");
    guest.hostWebContents = window;
    window.emit("did-attach-webview", {}, guest);
    return guest;
  };
  return { ...fakes, host, window, attachGuest };
};

const event = () => {
  let prevented = false;
  return {
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
};

describe("attaching a page", () => {
  test("hardens a webview on the browser's partition and refuses any other", () => {
    const { window } = setup();
    const ok = event();
    const preferences: Record<string, unknown> = { nodeIntegration: true, preload: "/x.js" };
    window.emit("will-attach-webview", ok, preferences, {
      src: "https://example.com/",
      partition: AOP_BROWSER_PARTITION,
    });
    expect(ok.prevented).toBe(false);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.preload).toBeUndefined();

    const refused = event();
    window.emit("will-attach-webview", refused, {}, { src: "https://example.com/", partition: "" });
    expect(refused.prevented).toBe(true);
  });

  test("refuses every webview once the window shows something other than the dashboard", () => {
    const { window } = setup();
    const refused = event();
    (window as unknown as { getURL: () => string }).getURL = () => "app://desktop/index.html";
    window.emit("will-attach-webview", refused, {}, { partition: AOP_BROWSER_PARTITION });
    expect(refused.prevented).toBe(true);
  });
});

describe("keys", () => {
  test("typed in a page reach the dashboard as shortcuts naming the page; zoom stays in the page", () => {
    const { attachGuest, sent } = setup();
    const guest = attachGuest();

    const reload = event();
    guest.emit("before-input-event", reload, keyDown("KeyR", { meta: true }));
    const zoom = event();
    guest.emit("before-input-event", zoom, keyDown("Equal", { meta: true }));
    const typing = event();
    guest.emit("before-input-event", typing, keyDown("KeyA"));

    expect(reload.prevented).toBe(true);
    expect(zoom.prevented).toBe(true);
    expect(typing.prevented).toBe(false);
    expect(guest.zoom).toBe(1.1);
    expect(sent).toEqual([{ kind: "shortcut", shortcut: "reload", webContentsId: 7 }]);
  });

  test("typed in the app's window go to the browser only while it is shown", () => {
    const { host, window, sent } = setup();

    const hidden = event();
    window.emit("before-input-event", hidden, keyDown("KeyR", { meta: true }));
    expect(hidden.prevented).toBe(false);

    host.setActive(true);
    const shown = event();
    window.emit("before-input-event", shown, keyDown("KeyR", { meta: true }));
    const zoom = event();
    window.emit("before-input-event", zoom, keyDown("Equal", { meta: true }));
    expect(shown.prevented).toBe(true);
    expect(zoom.prevented).toBe(false);
    expect(sent).toEqual([{ kind: "shortcut", shortcut: "reload", webContentsId: null }]);

    window.emit("did-navigate");
    const afterReload = event();
    window.emit("before-input-event", afterReload, keyDown("KeyR", { meta: true }));
    expect(afterReload.prevented).toBe(false);
  });
});

describe("new windows", () => {
  test("a new-tab link becomes a tab; a scripted popup a sandboxed window; a file nothing", () => {
    const { attachGuest, sent } = setup();
    const guest = attachGuest();
    const open = guest.windowOpenHandler as unknown as (details: object) => {
      action: string;
      overrideBrowserWindowOptions?: { webPreferences: Record<string, unknown> };
    };

    expect(open({ url: "https://a.example/", disposition: "foreground-tab" })).toEqual({
      action: "deny",
    });
    expect(sent).toEqual([{ kind: "open-tab", url: "https://a.example/", webContentsId: 7 }]);

    const popup = open({ url: "https://login.example/", disposition: "new-window" });
    expect(popup.action).toBe("allow");
    expect(popup.overrideBrowserWindowOptions?.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });

    expect(open({ url: "file:///etc/hosts", disposition: "new-window" })).toEqual({
      action: "deny",
    });
  });

  test("a page cannot navigate to the machine's files or the app's own pages", () => {
    const { attachGuest } = setup();
    const guest = attachGuest();
    for (const url of ["file:///etc/hosts", "app://aop/"]) {
      const navigation = event();
      guest.emit("will-navigate", navigation, url);
      expect(navigation.prevented).toBe(true);
    }
    const web = event();
    guest.emit("will-navigate", web, "https://example.com/");
    expect(web.prevented).toBe(false);
  });
});

describe("permission requests", () => {
  const request = (session: ReturnType<typeof setup>["session"], guest: FakeContents) => {
    const answers: boolean[] = [];
    session.requestHandler?.(
      guest as never,
      "media" as never,
      ((allow: boolean) => answers.push(allow)) as never,
      { mediaTypes: ["video"], requestingUrl: "https://meet.example/room" } as never,
    );
    return answers;
  };

  test("go to the dashboard as a question, and the person's answer settles them", () => {
    const { host, session, attachGuest, sent } = setup();
    const guest = attachGuest();

    const answers = request(session, guest);
    expect(answers).toEqual([]);
    expect(sent).toEqual([
      {
        kind: "prompt",
        prompt: { id: "id1", webContentsId: 7, origin: "https://meet.example", ask: "camera" },
      },
    ]);

    host.answerPrompt("id1", true);
    expect(answers).toEqual([true]);
    expect(sent.at(-1)).toEqual({ kind: "prompt-closed", id: "id1" });
    const check = session.checkHandler as unknown as (...args: unknown[]) => boolean;
    expect(check(guest, "media", "https://meet.example", { mediaType: "video" })).toBe(true);
    expect(check(guest, "media", "https://other.example", { mediaType: "video" })).toBe(false);
  });

  test("are refused when the page moves on, or when they come from a popup", () => {
    const { session, attachGuest, sent } = setup();
    const guest = attachGuest();
    const answers = request(session, guest);

    guest.emit("did-navigate");
    expect(answers).toEqual([false]);
    expect(sent.at(-1)).toEqual({ kind: "prompt-closed", id: "id1" });

    const popup = new FakeContents(9, "https://login.example/");
    expect(request(session, popup)).toEqual([false]);
  });

  test("devices (USB, serial, HID) are never granted", () => {
    const { session } = setup();
    expect((session.deviceHandler as unknown as () => boolean)()).toBe(false);
  });
});

describe("downloads", () => {
  test("go straight into Downloads under a free name and are reported to the dashboard", () => {
    const { host, session, attachGuest, sent, revealed } = setup([
      "/Users/me/Downloads/report.pdf",
    ]);
    const guest = attachGuest();
    const item = new FakeDownload("report.pdf");

    session.emit("will-download", {}, item, guest);
    expect(item.savePath).toBe("/Users/me/Downloads/report (1).pdf");
    expect(sent.at(-1)).toEqual({
      kind: "download",
      download: {
        id: "id1",
        webContentsId: 7,
        filename: "report (1).pdf",
        state: "progressing",
        receivedBytes: 4,
        totalBytes: 8,
      },
    });

    host.downloadAction("id1", "reveal");
    expect(revealed).toEqual([]);
    item.state = "completed";
    item.emit("done", {}, "completed");
    expect(sent.at(-1)).toMatchObject({ kind: "download", download: { state: "completed" } });
    host.downloadAction("id1", "reveal");
    expect(revealed).toEqual(["/Users/me/Downloads/report (1).pdf"]);
  });

  test("two at once never share a name, and one can be cancelled", () => {
    const { host, session, attachGuest } = setup();
    const guest = attachGuest();
    const first = new FakeDownload("a.zip");
    const second = new FakeDownload("a.zip");

    session.emit("will-download", {}, first, guest);
    session.emit("will-download", {}, second, guest);
    expect(second.savePath).toBe("/Users/me/Downloads/a (1).zip");

    host.downloadAction("id2", "cancel");
    expect(second.cancelled).toBe(true);
    host.downloadAction("unknown", "cancel");
    expect(first.cancelled).toBe(false);
  });
});

describe("the window's link menu", () => {
  test("opens a web link in the AOP Browser through the dashboard", () => {
    const fakes = fakeBrowserDeps();
    const menus: { label?: string; click?: () => void }[][] = [];
    fakes.deps.popupMenu = (template) => void menus.push(template as never);
    const host = createBrowserHost(fakes.deps);
    const window = new FakeContents(1, "app://aop/projects/p1");
    host.attachWindow(window as unknown as WebContents);

    window.emit(
      "context-menu",
      {},
      {
        linkURL: "http://localhost:5173/",
        srcURL: "",
        mediaType: "none",
        isEditable: false,
        selectionText: "",
        editFlags: { canCut: false, canCopy: false, canPaste: false, canSelectAll: false },
      },
    );
    menus[0]?.find((item) => item.label === "Open in AOP Browser")?.click?.();

    expect(fakes.sent).toEqual([
      { kind: "open-tab", url: "http://localhost:5173/", webContentsId: null },
    ]);
  });
});
