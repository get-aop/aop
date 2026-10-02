import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { makeState, stubLiveProjects } from "../projects/test-utils";
import { setupDashboardDom } from "../test/setup-dom";
import { installFakeCliHost } from "./test-utils";

setupDashboardDom();
// Each test waits on several host round trips (owner check, status, save, re-read); under the
// full suite's load they can pass bun's 5 s default, and a timed-out test would read the next one's page.
setDefaultTimeout(15_000);

const { cleanup, fireEvent, render, screen, waitFor } = await import("@testing-library/react");
const { AgentCliPanel } = await import("./AgentCliPanel");
const { ConfirmationHost } = await import("../components/ConfirmationHost");
const { ShellStatus } = await import("../shell/ShellStatus");
const { ProjectsProvider } = await import("../projects/ProjectsProvider");
const { resetAgentClisForTests } = await import("./agent-cli-store");

const originalFetch = globalThis.fetch;
const SETTING = "PUT /settings/agent_cli_skip_permissions";

beforeEach(() => resetAgentClisForTests(10));

afterEach(() => {
  cleanup();
  resetAgentClisForTests();
  globalThis.fetch = originalFetch;
});

const renderPanel = () =>
  render(
    <>
      <AgentCliPanel />
      <ConfirmationHost />
    </>,
  );

// The owner check answers after the first read, and the switch waits for it.
const bypassSwitch = (): Promise<HTMLElement> =>
  waitFor(() => screen.getByTestId("permission-bypass-switch"));

describe("Skip permission checks", () => {
  test("is off by default, with no warning or badge", async () => {
    installFakeCliHost();
    renderPanel();

    const control = await bypassSwitch();

    expect(control.getAttribute("data-state")).toBe("unchecked");
    expect(screen.queryByTestId("permission-bypass-warning")).toBeNull();
    expect(screen.queryByTestId("permission-bypass-badge")).toBeNull();
  });

  test("turning it on asks first, and cancelling changes nothing on the host", async () => {
    const host = installFakeCliHost();
    renderPanel();

    fireEvent.click(await bypassSwitch());
    await waitFor(() => expect(screen.getByTestId("confirm-dialog-confirm")).toBeTruthy());
    expect(document.body.textContent).toContain("run any command and edit any file as you");
    fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));

    await waitFor(() => expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull());
    expect(host.calls).not.toContain(SETTING);
    expect(host.bypass.enabled).toBe(false);
  });

  test("confirmed, it is saved on the host and the row, the heading and the top bar say it is on", async () => {
    const host = installFakeCliHost();
    render(
      <>
        <AgentCliPanel />
        <ConfirmationHost />
        <ProjectsProvider live={stubLiveProjects(makeState([])).live}>
          <ShellStatus testId="status" />
        </ProjectsProvider>
      </>,
    );

    fireEvent.click(await bypassSwitch());
    fireEvent.click(await waitFor(() => screen.getByTestId("confirm-dialog-confirm")));

    await waitFor(() => expect(screen.getByTestId("permission-bypass-warning")).toBeTruthy());
    expect(host.calls).toContain(SETTING);
    expect(host.bypass.enabled).toBe(true);
    expect(screen.getByTestId("permission-bypass-switch").getAttribute("data-state")).toBe(
      "checked",
    );
    expect(screen.getByTestId("permission-bypass-badge").textContent).toBe("Permission checks off");
    expect(screen.getByTestId("permission-bypass-notice").getAttribute("aria-label")).toBe(
      "Permission checks off",
    );
  });

  test("turning it off needs no confirmation and the indicators go", async () => {
    const host = installFakeCliHost({ bypass: { enabled: true, blockedReason: null } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("permission-bypass-badge")).toBeTruthy());

    fireEvent.click(await bypassSwitch());

    await waitFor(() => expect(screen.queryByTestId("permission-bypass-badge")).toBeNull());
    expect(screen.queryByTestId("confirm-dialog-confirm")).toBeNull();
    expect(host.bypass.enabled).toBe(false);
    expect(screen.queryByTestId("permission-bypass-warning")).toBeNull();
  });

  test("a paired device sees the state but has no switch", async () => {
    const host = installFakeCliHost({
      owner: false,
      bypass: { enabled: true, blockedReason: null },
    });
    renderPanel();

    await waitFor(() =>
      expect(screen.getByTestId("permission-bypass-state").textContent).toBe("On"),
    );
    expect(screen.getByTestId("permission-bypass-owner-only")).toBeTruthy();
    expect(screen.getByTestId("permission-bypass-warning")).toBeTruthy();
    expect(screen.queryByTestId("permission-bypass-switch")).toBeNull();
    expect(host.calls).not.toContain(SETTING);
  });

  test("on a host where it cannot apply, the row says why, the switch cannot turn it on, and nothing claims it is on", async () => {
    const reason = "AOP runs as root on this host, and Claude Code refuses it.";
    installFakeCliHost({ bypass: { enabled: false, blockedReason: reason } });
    renderPanel();

    const control = await bypassSwitch();

    expect(screen.getByTestId("permission-bypass-blocked").textContent).toBe(reason);
    expect((control as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("permission-bypass-badge")).toBeNull();
  });

  test("left on where it cannot apply, the row shows the error instead of the warning", async () => {
    const reason = "AOP runs as root on this host, and Claude Code refuses it.";
    installFakeCliHost({ bypass: { enabled: true, blockedReason: reason } });
    renderPanel();

    await waitFor(() => expect(screen.getByTestId("permission-bypass-blocked")).toBeTruthy());
    expect(screen.queryByTestId("permission-bypass-warning")).toBeNull();
    expect(screen.queryByTestId("permission-bypass-badge")).toBeNull();
    // The owner can still turn it off.
    expect((screen.getByTestId("permission-bypass-switch") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
