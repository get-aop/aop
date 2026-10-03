import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AgentCliStatus, AppUpdateState, UpdateStatus } from "@aop/common";
import { makeCli } from "../agent-clis/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { makeUpdateStatus } from "./test-utils";

setupDashboardDom();

const { act, cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { setPopoverOpen, UpdatesButton } = await import("./UpdatesButton");
const { UpdateDialogs } = await import("./UpdateDialogs");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { resetUpdatesForTests } = await import("./update-store");
const { resetAgentClisForTests } = await import("../agent-clis/agent-cli-store");
const { resetAppUpdatesForTests } = await import("./app-update-store");

interface FakeHost {
  status: UpdateStatus;
  clis: AgentCliStatus[];
  calls: string[];
  bodies: Record<string, unknown>;
}

const originalFetch = globalThis.fetch;
let host: FakeHost;

const installHost = (status: Partial<UpdateStatus> = {}, clis: AgentCliStatus[] = []) => {
  host = { status: makeUpdateStatus(status), clis, calls: [], bodies: {} };
  globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace(/^.*\/api/, "");
    const method = init?.method ?? "GET";
    host.calls.push(`${method} ${path}`);
    if (init?.body) host.bodies[`${method} ${path}`] = JSON.parse(String(init.body));
    return answer(method, path);
  }) as unknown as typeof fetch;
};

const answer = (method: string, path: string): Response => {
  if (path === "/updates" || path === "/updates/check") return Response.json(host.status);
  if (method === "POST" && path === "/updates/apply") {
    const queued = (host.bodies["POST /updates/apply"] as { when: string }).when === "idle";
    return Response.json({ ok: true, queued }, { status: 202 });
  }
  if (method === "DELETE" && path === "/updates/apply") return new Response(null, { status: 204 });
  if (path === "/updates/log")
    return Response.json({ path: "update.log", lines: ["Downloading AOP 0.10.0", "Rolled back"] });
  if (path === "/agent-clis") {
    return Response.json({
      clis: host.clis,
      checkIntervalMinutes: 60,
      autoUpdate: false,
      skipPermissions: { enabled: false, blockedReason: null },
    });
  }
  if (path === "/health") return Promise.reject(new TypeError("restarting")) as never;
  return Response.json({});
};

const renderButton = () =>
  render(
    <>
      <UpdatesButton />
      <UpdateDialogs />
      <ConfirmationHost />
    </>,
  );

const openPopover = async () => {
  fireEvent.click(await screen.findByTestId("updates-button"));
  return within(await screen.findByTestId("updates-popover"));
};

beforeEach(() => {
  window.localStorage.clear();
  setPopoverOpen(false);
  resetUpdatesForTests({ onHostBack: () => {}, pollMs: 5_000, giveUpMs: 60_000 });
  resetAgentClisForTests(10);
  resetAppUpdatesForTests();
});

afterEach(() => {
  cleanup();
  resetUpdatesForTests();
  resetAgentClisForTests();
  resetAppUpdatesForTests();
  delete (window as Window & { aopDesktop?: unknown }).aopDesktop;
  globalThis.fetch = originalFetch;
});

describe("the Updates button", () => {
  test("is absent while everything is current", async () => {
    installHost({ available: false, latest: "0.9.51" }, [makeCli({ updateAvailable: false })]);
    renderButton();
    await waitFor(() => expect(host.calls).toContain("GET /agent-clis"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByTestId("updates-button")).toBeNull();
  });

  test("shows a dot for news until the popover is opened", async () => {
    installHost();
    renderButton();
    expect(await screen.findByTestId("updates-dot")).toBeTruthy();
    await openPopover();
    expect(screen.queryByTestId("updates-dot")).toBeNull();
  });

  test("Update host starts at once when no turn runs, and every device then reads Updating host…", async () => {
    installHost();
    renderButton();
    const popover = await openPopover();
    const row = within(popover.getByTestId("update-row-host"));
    expect(row.getByText("Host soulf")).toBeTruthy();
    expect(row.getByTestId("update-row-status").textContent).toBe("Update available");

    fireEvent.click(row.getByTestId("update-action-update-host"));

    await waitFor(() => expect(host.bodies["POST /updates/apply"]).toEqual({ when: "now" }));
    expect(await screen.findByTestId("updates-host-chip")).toBeTruthy();
  });

  test("with turns running it asks first, and Update when they finish queues it on the host", async () => {
    installHost({
      runningTurns: [
        { title: "Design: one clear UX…", kind: "thread" },
        { title: "Umbral CI retest", kind: "thread" },
      ],
    });
    renderButton();
    const popover = await openPopover();
    fireEvent.click(popover.getByTestId("update-action-update-host"));

    const dialog = within(await screen.findByTestId("update-turns-dialog"));
    expect(dialog.getByText("Update host soulf now?")).toBeTruthy();
    expect(dialog.getByTestId("update-turns-running").textContent).toBe(
      "2 turns are running on soulf: “Design: one clear UX…” and “Umbral CI retest”.",
    );
    fireEvent.click(dialog.getByTestId("update-turns-later"));

    await waitFor(() => expect(host.bodies["POST /updates/apply"]).toEqual({ when: "idle" }));
    expect(screen.queryByTestId("updates-host-chip")).toBeNull();
  });

  test("asks about turns that started after the page last read the host", async () => {
    installHost();
    renderButton();
    const popover = await openPopover();
    host.status = { ...host.status, runningTurns: [{ title: "Late turn", kind: "thread" }] };

    fireEvent.click(popover.getByTestId("update-action-update-host"));

    expect(await screen.findByTestId("update-turns-dialog")).toBeTruthy();
    expect(host.bodies["POST /updates/apply"]).toBeUndefined();
  });

  test("a queued update reads Waiting for N turns, with Update now and Cancel", async () => {
    installHost({
      queued: {
        since: "2026-10-03T10:00:00.000Z",
        version: "0.10.0",
        waitingFor: 2,
        by: "person",
        expired: false,
      },
    });
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-host"));
    expect(row.getByTestId("update-row-status").textContent).toBe("Waiting for 2 turns");

    fireEvent.click(row.getByTestId("update-action-cancel-queued"));

    await waitFor(() => expect(host.calls).toContain("DELETE /updates/apply"));
  });

  test("a viewer who may not update the host is told why and where, with no button", async () => {
    installHost({ canUpdate: false, owner: false, hostManagement: "owner" });
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-host"));

    expect(row.queryByTestId("update-action-update-host")).toBeNull();
    expect(row.getByTestId("update-row-blocked").textContent).toBe(
      "Updates for this host can only be started on soulf itself (AOP settings › Updates › Who can update this host).",
    );
  });

  test("a failed update says why and shows the log", async () => {
    installHost({
      state: "failed",
      updateError: "AOP 0.10.0 did not start. Rolled back to 0.9.51.",
    });
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-host"));
    expect(row.getByTestId("update-row-note").textContent).toBe(
      "AOP 0.10.0 did not start. Rolled back to 0.9.51.",
    );

    fireEvent.click(row.getByTestId("update-action-show-log"));

    expect((await screen.findByTestId("update-log")).textContent).toContain("Rolled back");
  });

  test("an agent CLI updates from its row, without a restart", async () => {
    installHost({ available: false, latest: "0.9.51" }, [makeCli()]);
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-cli:claude-code"));
    expect(row.getByTestId("update-row-note").textContent).toBe(
      "No restart. The next turn uses it.",
    );

    fireEvent.click(row.getByTestId("update-action-update-cli"));

    await waitFor(() => expect(host.calls).toContain("POST /agent-clis/claude-code/update"));
  });
});

describe("This app, inside the desktop app", () => {
  const installApp = (update: AppUpdateState) => {
    const bridge = {
      getAppInfo: mock(async () => ({
        name: "AOP Nightly",
        version: "0.10.8-nightly.20261002.17",
        platform: "darwin",
        autoDownload: true,
      })),
      getUpdateState: mock(async () => update),
      onUpdateStateChanged: mock(() => () => {}),
      restartToUpdate: mock(async () => {}),
      onOpenUpdates: mock(() => () => {}),
    };
    (window as Window & { aopDesktop?: unknown }).aopDesktop = bridge;
    return bridge;
  };

  test("a downloaded build reads Ready, and Restart to update restarts the app", async () => {
    installHost({ available: false, latest: "0.9.51" });
    const bridge = installApp({
      status: "ready",
      version: "0.10.8-nightly.20261003.4",
      releaseUrl: null,
    });
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-app"));
    expect(row.getByTestId("update-row-meta").textContent).toBe(
      "AOP Nightly for macOS · …1002.17 → …1003.4",
    );

    fireEvent.click(row.getByTestId("update-action-restart-app"));

    await waitFor(() => expect(bridge.restartToUpdate).toHaveBeenCalledTimes(1));
  });

  test("asks first when a composer holds unsent text", async () => {
    installHost({ available: false, latest: "0.9.51" });
    window.localStorage.setItem("aop:draft:v1:thread-1", "half a thought");
    const bridge = installApp({ status: "ready", version: "0.10.9", releaseUrl: null });
    renderButton();
    const row = within((await openPopover()).getByTestId("update-row-app"));

    fireEvent.click(row.getByTestId("update-action-restart-app"));
    expect(await screen.findByText("Restart to update this app?")).toBeTruthy();
    expect(bridge.restartToUpdate).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByTestId("confirm-dialog-confirm")));
    await waitFor(() => expect(bridge.restartToUpdate).toHaveBeenCalledTimes(1));
  });
});
