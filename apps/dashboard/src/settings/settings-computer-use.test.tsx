import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type CuaLeaseState, type CuaStatus, EMPTY_CUA_LEASE } from "@aop/common";
import { makeLease } from "../live-view/test-utils";
import { mockApi } from "../test/mock-api";
import { setupDashboardDom } from "../test/setup-dom";
import { makeCuaStatus } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { SettingsComputerUse } = await import("./settings-computer-use");
const { resetLiveViewForTests } = await import("../live-view/live-view-store");

let api: ReturnType<typeof mockApi>;
let cua: CuaStatus;
let lease: CuaLeaseState;
let owner: boolean;

beforeEach(() => {
  resetLiveViewForTests();
  cua = makeCuaStatus();
  lease = EMPTY_CUA_LEASE;
  owner = true;
  api = mockApi((call) => {
    const path = call.path.split("?")[0];
    if (path === "/auth/me") {
      return Response.json(
        owner ? { kind: "owner" } : { kind: "device", device: { id: "d1", name: "Laptop" } },
      );
    }
    if (path === "/computer-use/cua") return Response.json(cua);
    if (path === "/computer-use/live") {
      return Response.json({
        mode: "remote",
        viewer: "owner",
        shown: false,
        sessions: [],
        capture: { state: "idle", detail: null },
        lease,
      });
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  resetLiveViewForTests();
  api.restore();
});

const renderSection = async () => {
  render(<SettingsComputerUse />);
  await act(async () => {});
  return screen.getByTestId("settings-computer-use");
};

const status = () => screen.getByTestId("settings-cu-status");

describe("Settings › Computer use", () => {
  test("says the host is not ready and why, with each check as a row", async () => {
    await renderSection();

    await waitFor(() => expect(status().dataset.status).toBe("not-ready"));
    expect(status().textContent).toBe("Not ready: No X display is up for CUA Driver to drive.");
    expect(screen.getByTestId("settings-cu-host").textContent).toContain(
      "CUA Driver 0.31.0 on build-box",
    );
    const rows = within(screen.getByTestId("settings-cu-checks")).getAllByRole("listitem");
    expect(rows.map((row) => row.dataset.state)).toEqual(["ok", "missing", "unchecked"]);
    const display = screen.getByTestId("settings-cu-check-display");
    expect(display.textContent).toContain("DISPLAY is not set");
    expect(within(display).getByTestId("settings-cu-check-state").textContent).toBe("Missing");
    expect(
      within(screen.getByTestId("settings-cu-check-browser")).getByTestId("settings-cu-check-state")
        .textContent,
    ).toBe("Not checked");
  });

  test("ready and not installed read as such", async () => {
    cua = makeCuaStatus({ status: "ready", reason: "ready" });
    await renderSection();
    await waitFor(() => expect(status().textContent).toBe("Ready"));

    cleanup();
    cua = makeCuaStatus({ status: "not-installed", reason: "not-installed", version: null });
    await renderSection();
    await waitFor(() => expect(status().textContent).toBe("Not installed"));
    expect(screen.getByTestId("settings-cu-host").textContent).toContain("No CUA Driver");
  });

  test("gives the sudo command and the setup command to copy, and the pinned version", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void copied.push(text) },
    });
    await renderSection();

    const sudo = await screen.findByTestId("settings-cu-fix-sudo-command");
    expect(sudo.textContent).toBe("sudo apt-get install -y xvfb openbox");
    expect(sudo.parentElement?.textContent).toContain("Needs sudo");
    expect(screen.getByTestId("settings-cu-fix-setup-command").textContent).toBe(
      "aop-nightly computer-use setup",
    );
    expect(screen.getByTestId("settings-cu-missing").textContent).toBe(
      "Missing: Xvfb, a window manager",
    );
    expect(screen.getByTestId("settings-cu-pinned").textContent).toBe(
      "AOP installs and updates CUA Driver 0.32.0 by itself. This host has 0.31.0.",
    );
    expect(screen.getByTestId("settings-cu-where").textContent).toContain(
      "Run on this machine, build-box: it is the AOP host.",
    );

    fireEvent.click(screen.getByTestId("settings-cu-fix-sudo-copy"));
    await waitFor(() => expect(copied).toEqual(["sudo apt-get install -y xvfb openbox"]));
  });

  test("a paired device is told to run the commands on the host", async () => {
    owner = false;
    await renderSection();

    await waitFor(() =>
      expect(screen.getByTestId("settings-cu-where").textContent).toContain(
        "Run on the AOP host, build-box, not on this device.",
      ),
    );
  });

  test("with nothing to fix, says so", async () => {
    cua = makeCuaStatus({
      status: "ready",
      reason: "ready",
      version: "0.32.0",
      fix: { command: null, sudoCommand: null, missing: [], pinnedVersion: "0.32.0" },
    });
    await renderSection();

    expect((await screen.findByTestId("settings-cu-nothing-to-fix")).textContent).toBe(
      "Nothing to install.",
    );
    expect(screen.getByTestId("settings-cu-pinned").textContent).toBe(
      "AOP installs and updates CUA Driver 0.32.0 by itself.",
    );
  });

  test("Check again asks the host to probe afresh", async () => {
    await renderSection();
    await waitFor(() => expect(status().dataset.status).toBe("not-ready"));

    cua = makeCuaStatus({ status: "ready", reason: "ready" });
    fireEvent.click(screen.getByTestId("settings-cu-recheck"));

    await waitFor(() => expect(status().textContent).toBe("Ready"));
    expect(api.calls.map((call) => call.path)).toContain("/computer-use/cua?fresh=1");
  });

  test("shows who holds the lease and who waits, in line order", async () => {
    lease = makeLease({ threadId: "thr_1", title: "Check the login page" }, [
      { threadId: "thr_2", title: "Fix the footer" },
      { threadId: "thr_3", title: "Screenshot the docs" },
    ]);
    await renderSection();

    const holder = await screen.findByTestId("settings-cu-lease-holder");
    expect(holder.dataset.holder).toBe("thr_1");
    expect(holder.textContent).toContain("In use by Check the login page since");
    expect(within(holder).getByRole("link").getAttribute("href")).toBe(
      "/projects/prj_1/threads/thr_1",
    );
    const waiters = screen.getAllByTestId("settings-cu-lease-waiter");
    expect(waiters.map((waiter) => waiter.textContent)).toEqual([
      "next in lineFix the footer",
      "2nd in lineScreenshot the docs",
    ]);
  });

  test("says when nobody uses it", async () => {
    await renderSection();

    const holder = await screen.findByTestId("settings-cu-lease-holder");
    expect(holder.textContent).toBe("Nobody is using computer use.");
    expect(screen.queryAllByTestId("settings-cu-lease-waiter").length).toBe(0);
  });
});
