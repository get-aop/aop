import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { HostSetup } from "@aop/common";
import { mockApi } from "../test/mock-api";
import { setupDashboardDom } from "../test/setup-dom";
import { makeUpdateStatus } from "../updates/test-utils";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { resetUpdatesForTests } = await import("../updates/update-store");
const { resetHostSetupForTests } = await import("../host-setup/host-setup-store");
const { SettingsHost, hostSummary } = await import("./settings-host");
const { getDialogs, resetDialogs } = await import("../shell/dialog-store");

const SETUP: HostSetup = {
  hostName: "soulf",
  os: "linux",
  channel: "nightly",
  version: "0.10.8-nightly.20261002.17",
  uptimeSeconds: 3 * 3600,
  addresses: ["https://soulf.tailffbdec.ts.net:25650"],
  ready: 4,
  total: 6,
  checks: [
    {
      id: "service",
      state: "ok",
      title: "Runs as a service",
      detail: "systemd user unit aop-nightly-local-server. Starts at boot, restarts after updates.",
      actions: [],
    },
    {
      id: "github",
      state: "error",
      title: "GitHub",
      detail: "gh isn't signed in.",
      actions: [{ kind: "how-to", steps: ["Open a terminal on soulf."], command: "gh auth login" }],
    },
    {
      id: "computer-use",
      state: "warning",
      title: "Computer use",
      detail: "Missing: the virtual screen and its window manager.",
      actions: [{ kind: "fix", label: "Fix" }],
    },
    {
      id: "claude",
      state: "ok",
      title: "Claude Code ready",
      detail: "2.1.288, logged in · default runtime",
      actions: [{ kind: "link", label: "Runtimes", target: "runtimes" }],
    },
    {
      id: "slack-inbox",
      state: "optional",
      title: "Slack Inbox",
      detail: "Not set up: your Slack mentions, DMs and thread replies, in AOP",
      actions: [{ kind: "link", label: "Set up", target: "connections" }],
    },
  ],
};

let api: ReturnType<typeof mockApi>;
let canUpdate: boolean;

beforeEach(() => {
  resetUpdatesForTests();
  resetHostSetupForTests();
  canUpdate = true;
  api = mockApi((call) => {
    if (call.path === "/host/setup") return Response.json(SETUP);
    if (call.path === "/host/setup/computer-use/fix") {
      return Response.json({
        ...SETUP,
        checks: SETUP.checks.map((check) =>
          check.id === "computer-use" ? { ...check, state: "ok", actions: [] } : check,
        ),
      });
    }
    if (call.path === "/updates") return Response.json(makeUpdateStatus({ canUpdate }));
    if (call.path === "/auth/me") return Response.json({ kind: "owner" });
    if (call.path === "/auth/devices") return Response.json({ devices: [] });
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  api.restore();
  resetHostSetupForTests();
  resetUpdatesForTests();
  resetDialogs();
});

describe("AOP settings › Host", () => {
  test("the optional Slack Inbox row opens Settings › Connections", async () => {
    render(<SettingsHost />);
    fireEvent.click(await screen.findByTestId("setup-link-slack-inbox"));
    expect(getDialogs().settings).toEqual({ open: true, section: "connections" });
  });

  test("sums the host up", () => {
    expect(hostSummary(SETUP)).toBe(
      "Linux · AOP Nightly 0.10.8-nightly.20261002.17 · up 3 h · 4 of 6 ready",
    );
  });

  test("lists each check with what it found, a How to with the command, and a Fix that runs on the host", async () => {
    render(<SettingsHost />);

    const github = within(await screen.findByTestId("setup-check-github"));
    expect(github.getByTestId("setup-check-detail").textContent).toBe("gh isn't signed in.");
    fireEvent.click(github.getByTestId("setup-howto-github"));
    expect(github.getByTestId("setup-howto-command").textContent).toBe("gh auth login");

    fireEvent.click(screen.getByTestId("setup-fix-computer-use"));
    await waitFor(() =>
      expect(screen.getByTestId("setup-check-computer-use").getAttribute("data-state")).toBe("ok"),
    );
    expect(
      api.calls.some(
        (call) => call.method === "POST" && call.path === "/host/setup/computer-use/fix",
      ),
    ).toBe(true);
    expect(screen.getByTestId("host-addresses").textContent).toContain("soulf.tailffbdec.ts.net");
  });

  test("a viewer who may not manage the host gets no Fix, and is told why", async () => {
    canUpdate = false;
    render(<SettingsHost />);

    const cu = within(await screen.findByTestId("setup-check-computer-use"));
    await waitFor(() => expect(cu.getByTestId("setup-check-blocked")).toBeTruthy());
    expect(cu.queryByTestId("setup-fix-computer-use")).toBeNull();
  });
});
