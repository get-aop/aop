import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { UpdateStatus } from "@aop/common";
import { makeCli } from "../agent-clis/test-utils";
import { mockApi } from "../test/mock-api";
import { setupDashboardDom } from "../test/setup-dom";
import { makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

// Saves go through api/client, which other test files replace with a mock of their own.
const savedSettings: unknown[] = [];
const actualClient = await import("../api/client");
mock.module("../api/client", () => ({
  ...actualClient,
  updateSettings: mock(async (entries: unknown) => {
    savedSettings.push(entries);
  }),
}));

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { resetUpdatesForTests } = await import("../updates/update-store");
const { resetAgentClisForTests } = await import("../agent-clis/agent-cli-store");
const { SettingsUpdates } = await import("./settings-updates");

let api: ReturnType<typeof mockApi>;
let status: UpdateStatus;
let settings: Record<string, string>;

beforeEach(() => {
  savedSettings.length = 0;
  resetUpdatesForTests();
  resetAgentClisForTests();
  status = makeUpdateStatus({
    previous: {
      at: new Date(Date.now() - 3 * 3600_000).toISOString(),
      from: "0.9.50",
      to: "0.9.51",
      ok: true,
      seconds: 9,
      error: null,
    },
  });
  settings = {
    update_install: "ask",
    update_install_window: "01:00-06:00",
    update_background_download: "true",
    agent_cli_check_interval_minutes: "60",
    agent_cli_auto_update: "false",
    host_management: "devices",
  };
  api = mockApi((call) => {
    if (call.path === "/updates") return Response.json(status);
    if (call.path === "/settings" && call.method === "GET") {
      return Response.json({
        settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
      });
    }
    if (call.path === "/settings" && call.method === "PUT") return Response.json({ ok: true });
    if (call.path === "/agent-clis") {
      return Response.json({
        clis: [makeCli()],
        checkIntervalMinutes: 60,
        autoUpdate: false,
        skipPermissions: { enabled: false, blockedReason: null },
      });
    }
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  api.restore();
  resetUpdatesForTests();
  resetAgentClisForTests();
});

// Every control stays disabled until the host has said this viewer may change it.
const clickWhenEnabled = async (testId: string) => {
  await waitFor(() =>
    expect((screen.getByTestId(testId) as HTMLInputElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByTestId(testId));
};

describe("AOP settings › Updates", () => {
  test("shows the host's update, its details, and the last update", async () => {
    render(<SettingsUpdates />);

    const host = within(await screen.findByTestId("settings-updates-host"));
    await waitFor(() => expect(host.getByText("Host soulf")).toBeTruthy());
    expect(host.getByTestId("update-action-update-host")).toBeTruthy();
    expect(host.getByTestId("settings-updates-previous").textContent).toBe(
      "Previous update 3h ago: 0.9.50 → 0.9.51 (took 9 s).",
    );
  });

  test("sets how the host installs updates", async () => {
    render(<SettingsUpdates />);

    await clickWhenEnabled("choice-update_install-window");

    await waitFor(() =>
      expect(savedSettings).toEqual([[{ key: "update_install", value: "window" }]]),
    );
    expect(screen.getByText(/between 01:00 and 06:00 host time/)).toBeTruthy();
  });

  test("a viewer who may not update the host sees every setting read-only, with why", async () => {
    status = makeUpdateStatus({ canUpdate: false, owner: false, hostManagement: "owner" });
    settings.host_management = "owner";
    render(<SettingsUpdates />);

    expect((await screen.findByTestId("settings-updates-readonly")).textContent).toContain(
      "can only be started on soulf itself",
    );
    await waitFor(() =>
      expect((screen.getByTestId("choice-update_install-idle") as HTMLInputElement).disabled).toBe(
        true,
      ),
    );
    expect(
      (screen.getByTestId("choice-host_management-devices") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId("settings-updates-who-readonly").textContent).toBe(
      "Only soulf itself can change this.",
    );
  });

  test("a paired device that may update still cannot change who may", async () => {
    status = makeUpdateStatus({ canUpdate: true, owner: false });
    render(<SettingsUpdates />);

    await waitFor(() =>
      expect((screen.getByTestId("choice-update_install-idle") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    expect((screen.getByTestId("choice-host_management-owner") as HTMLInputElement).disabled).toBe(
      true,
    );
  });

  test("the owner narrows who may update to the host machine", async () => {
    render(<SettingsUpdates />);

    await clickWhenEnabled("choice-host_management-owner");

    await waitFor(() =>
      expect(savedSettings).toEqual([[{ key: "host_management", value: "owner" }]]),
    );
  });
});
