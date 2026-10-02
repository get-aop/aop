import { describe, expect, test } from "bun:test";
import { AOP_BROWSER_PARTITION } from "@aop/common";
import {
  downloadFileName,
  type GuestPreferences,
  hardenGuestPreferences,
  isBlockedNavigation,
  isGuestAttachAllowed,
  permissionCheck,
  permissionDecision,
  popupDecision,
} from "./policy";

describe("which webviews may attach", () => {
  test("only the dashboard's, on the browser's partition, at a web address or blank", () => {
    const ok = { partition: AOP_BROWSER_PARTITION };
    expect(isGuestAttachAllowed({ ...ok, src: "https://example.com/" }, true)).toBe(true);
    expect(isGuestAttachAllowed({ ...ok, src: "http://localhost:5173/" }, true)).toBe(true);
    expect(isGuestAttachAllowed({ ...ok, src: "about:blank" }, true)).toBe(true);
    expect(isGuestAttachAllowed(ok, true)).toBe(true);
  });

  test("refuses another page, another partition, and other schemes", () => {
    const src = "https://example.com/";
    expect(isGuestAttachAllowed({ src, partition: AOP_BROWSER_PARTITION }, false)).toBe(false);
    expect(isGuestAttachAllowed({ src, partition: undefined }, true)).toBe(false);
    expect(isGuestAttachAllowed({ src, partition: "persist:other" }, true)).toBe(false);
    for (const bad of ["file:///etc/passwd", "app://aop/", "javascript:alert(1)", "chrome://gpu"]) {
      expect(isGuestAttachAllowed({ src: bad, partition: AOP_BROWSER_PARTITION }, true)).toBe(
        false,
      );
    }
  });

  test("pins the guest sandboxed and isolated whatever the element asked for", () => {
    const preferences: GuestPreferences = {
      preload: "/tmp/evil.js",
      preloadURL: "file:///tmp/evil.js",
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false,
      allowRunningInsecureContent: true,
      webviewTag: true,
      enableBlinkFeatures: "Something",
    };
    hardenGuestPreferences(preferences);
    expect(preferences).toEqual({
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    });
  });
});

describe("navigations a page starts", () => {
  test("stops the machine's files, the app's pages and Chromium's internals", () => {
    for (const url of [
      "file:///Users/me/.ssh/id_rsa",
      "app://aop/projects",
      "chrome://settings",
      "devtools://devtools/bundled/inspector.html",
      "view-source:https://example.com",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isBlockedNavigation(url)).toBe(true);
    }
  });

  test("lets the web through, and leaves other apps' links to the permission prompt", () => {
    for (const url of [
      "https://example.com/",
      "http://localhost:3000/",
      "mailto:a@b.c",
      "zoommtg://x",
    ]) {
      expect(isBlockedNavigation(url)).toBe(false);
    }
  });
});

describe("new windows", () => {
  test("a scripted popup opens a window, so sign-in flows can post back to their opener", () => {
    expect(popupDecision({ url: "https://accounts.example.com/", disposition: "new-window" })).toBe(
      "popup",
    );
    expect(popupDecision({ url: "about:blank", disposition: "new-window" })).toBe("popup");
  });

  test("a new-tab link opens a tab of the AOP Browser", () => {
    for (const disposition of ["foreground-tab", "background-tab", "default", "other"]) {
      expect(popupDecision({ url: "https://example.com/", disposition })).toBe("tab");
    }
  });

  test("anything that is not the web is refused", () => {
    expect(popupDecision({ url: "file:///etc/hosts", disposition: "new-window" })).toBe("deny");
    expect(popupDecision({ url: "javascript:1", disposition: "foreground-tab" })).toBe("deny");
    expect(popupDecision({ url: "about:blank", disposition: "foreground-tab" })).toBe("deny");
  });
});

describe("permission requests", () => {
  test("asks the person for devices, location, notifications and other apps", () => {
    expect(permissionDecision("media", { mediaTypes: ["video"] })).toEqual({
      decision: "ask",
      ask: "camera",
    });
    expect(permissionDecision("media", { mediaTypes: ["audio"] })).toEqual({
      decision: "ask",
      ask: "microphone",
    });
    expect(permissionDecision("media", { mediaTypes: ["audio", "video"] })).toEqual({
      decision: "ask",
      ask: "camera-and-microphone",
    });
    expect(permissionDecision("geolocation")).toEqual({ decision: "ask", ask: "geolocation" });
    expect(permissionDecision("notifications")).toEqual({ decision: "ask", ask: "notifications" });
    expect(permissionDecision("openExternal", { externalURL: "mailto:a@b.c" })).toEqual({
      decision: "ask",
      ask: "open-external",
    });
  });

  test("grants the harmless ones and denies everything else", () => {
    expect(permissionDecision("clipboard-sanitized-write")).toEqual({ decision: "allow" });
    expect(permissionDecision("fullscreen")).toEqual({ decision: "allow" });
    for (const permission of [
      "clipboard-read",
      "midi",
      "midiSysex",
      "display-capture",
      "hid",
      "serial",
      "usb",
      "local-fonts",
      "unknown",
    ]) {
      expect(permissionDecision(permission)).toEqual({ decision: "deny" });
    }
    expect(permissionDecision("media", { mediaTypes: [] })).toEqual({ decision: "deny" });
  });

  test("never hands a file, the app's pages or a web link to another app", () => {
    for (const externalURL of ["file:///etc/passwd", "app://aop/", "https://example.com/", ""]) {
      expect(permissionDecision("openExternal", { externalURL })).toEqual({ decision: "deny" });
    }
  });

  test("a check says granted only for the always-allowed, or what the person allowed", () => {
    const allowed = new Set(["camera", "notifications"]);
    const granted = (ask: string) => allowed.has(ask);
    expect(permissionCheck("fullscreen", undefined, granted)).toBe(true);
    expect(permissionCheck("notifications", undefined, granted)).toBe(true);
    expect(permissionCheck("geolocation", undefined, granted)).toBe(false);
    expect(permissionCheck("media", "video", granted)).toBe(true);
    expect(permissionCheck("media", "audio", granted)).toBe(false);
    expect(permissionCheck("usb", undefined, () => true)).toBe(false);
  });
});

describe("download names", () => {
  test("keeps the page's name without any folder or control characters", () => {
    const none = () => false;
    expect(downloadFileName("report.pdf", none)).toBe("report.pdf");
    expect(downloadFileName("../../.ssh/authorized_keys", none)).toBe("authorized_keys");
    expect(downloadFileName("..\\windows\\evil.exe", none)).toBe("evil.exe");
    expect(downloadFileName("a\u0000b\u001fc:d.txt", none)).toBe("abcd.txt");
    expect(downloadFileName(".bashrc", none)).toBe("bashrc");
    expect(downloadFileName("", none)).toBe("download");
  });

  test("numbers a name that is taken, before its extension", () => {
    const taken = new Set(["report.pdf", "report (1).pdf", "notes"]);
    expect(downloadFileName("report.pdf", (name) => taken.has(name))).toBe("report (2).pdf");
    expect(downloadFileName("notes", (name) => taken.has(name))).toBe("notes (1)");
  });
});
