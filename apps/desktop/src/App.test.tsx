import { beforeEach, describe, expect, test } from "bun:test";
import { makeState } from "./test/fake-backend";
import { setupDesktopDom } from "./test/setup-dom";
import { HOST, remote, showApp } from "./test/show-app";

setupDesktopDom();

const { cleanup } = await import("@testing-library/react");

beforeEach(() => {
  cleanup();
  window.location.hash = "";
});

// Each screen has its own tests next to it (screens/*.test.tsx); these are about which one shows.
describe("the app's address decides the screen", () => {
  test("a fresh install connects, a remote host shows its status, a local one its host screen", async () => {
    const fresh = await showApp();
    expect(fresh.view.getByTestId("connect-screen")).toBeDefined();
    cleanup();

    const client = await showApp(remote({ status: "connecting", host: HOST }));
    expect(client.view.getByTestId("status-screen")).toBeDefined();
    cleanup();

    const local = await showApp(makeState({ mode: "local" }));
    expect(local.view.getByTestId("host-screen")).toBeDefined();
  });

  test("#/host shows the host screen, and a build without host mode falls back to connect", async () => {
    window.location.hash = "#/host";
    const mac = await showApp(makeState({ mode: "remote", remoteUrl: HOST }));
    expect(mac.view.getByTestId("host-screen")).toBeDefined();
    cleanup();

    const windows = await showApp(makeState({ hostModeAvailable: false }));
    expect(windows.view.getByTestId("connect-screen")).toBeDefined();
  });

  test("stops listening for pushed state when the window goes away", async () => {
    const { view, listenerCount } = await showApp();
    expect(listenerCount()).toBe(1);

    view.unmount();

    expect(listenerCount()).toBe(0);
  });
});
