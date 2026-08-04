import { beforeEach, describe, expect, mock, test } from "bun:test";
import { App } from "./App";
import type { DesktopBackend, SidecarState, WslDistro } from "./backend/types";
import type { DesktopSetupState } from "./setup/types";
import { setupDesktopDom } from "./test/setup-dom";

setupDesktopDom();

const { act, fireEvent, render, waitFor } = await import("@testing-library/react");

describe("App", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("keeps dashboard gated when setup is blocked", async () => {
    const backend = createBackend({ getSetupState: mock(async () => blockedState()) });
    const navigateToDashboard = mock(() => undefined);

    const view = render(<App backend={backend} navigateToDashboard={navigateToDashboard} />);

    expect(view.getByText("Checking desktop setup")).toBeDefined();

    await waitFor(() => expect(view.getByText("Let's get AOP ready")).toBeDefined());
    expect(backend.startAopSidecar).not.toHaveBeenCalled();
    expect(navigateToDashboard).not.toHaveBeenCalled();
  });

  test("opens a setup guide without running the setup action", async () => {
    const backend = createBackend({
      getSetupState: mock(async () => blockedState()),
      openSetupGuide: mock(async () => undefined),
    });
    const navigateToDashboard = mock(() => undefined);

    const view = render(<App backend={backend} navigateToDashboard={navigateToDashboard} />);

    await waitFor(() => expect(view.getByText("Let's get AOP ready")).toBeDefined());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Install Codex" }));
    });
    await waitFor(() =>
      expect(backend.openSetupGuide).toHaveBeenCalledWith("install-runtime-codex"),
    );
    expect(backend.runSetupAction).not.toHaveBeenCalled();
    expect(backend.startAopSidecar).not.toHaveBeenCalled();
    expect(navigateToDashboard).not.toHaveBeenCalled();
  });

  test("starts the sidecar immediately when setup is already healthy", async () => {
    localStorage.setItem("aopDesktopSetupSeen", "true");
    const backend = createBackend({
      getSetupState: mock(async () => healthyState()),
      startAopSidecar: mock(async () => readySidecar()),
    });
    const navigateToDashboard = mock(() => undefined);

    render(<App backend={backend} navigateToDashboard={navigateToDashboard} />);

    await waitFor(() => expect(backend.startAopSidecar).toHaveBeenCalledTimes(1));
    expect(navigateToDashboard).toHaveBeenCalledWith("http://127.0.0.1:25150/");
  });

  test("shows setup on the first desktop launch even when requirements are already healthy", async () => {
    const backend = createBackend({
      getSetupState: mock(async () => healthyState()),
      startAopSidecar: mock(async () => readySidecar()),
    });
    const navigateToDashboard = mock(() => undefined);

    const view = render(<App backend={backend} navigateToDashboard={navigateToDashboard} />);

    await waitFor(() => expect(view.getByText("You're all set")).toBeDefined());
    expect(backend.startAopSidecar).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open dashboard" }));
    });

    await waitFor(() => expect(backend.startAopSidecar).toHaveBeenCalledTimes(1));
    expect(localStorage.getItem("aopDesktopSetupSeen")).toBe("true");
    expect(navigateToDashboard).toHaveBeenCalledWith("http://127.0.0.1:25150/");
  });

  test("shows a recoverable error when sidecar startup fails", async () => {
    localStorage.setItem("aopDesktopSetupSeen", "true");
    const backend = createBackend({
      getSetupState: mock(async () => healthyState()),
      startAopSidecar: mock(async () => failedSidecar()),
    });

    const view = render(<App backend={backend} navigateToDashboard={() => undefined} />);

    await waitFor(() => expect(view.getByText("AOP could not start")).toBeDefined());
    expect(view.getByText("/Users/test/.aop/logs")).toBeDefined();

    fireEvent.click(view.getByRole("button", { name: "Open logs" }));

    expect(backend.openLogsFolder).toHaveBeenCalledTimes(1);
  });

  test("recovers from a transient sidecar health timeout", async () => {
    localStorage.setItem("aopDesktopSetupSeen", "true");
    const startAopSidecar = mock(async () =>
      startAopSidecar.mock.calls.length === 1 ? failedSidecar() : readySidecar(),
    );
    const backend = createBackend({
      getSetupState: mock(async () => healthyState()),
      startAopSidecar,
    });
    const navigateToDashboard = mock(() => undefined);

    const view = render(<App backend={backend} navigateToDashboard={navigateToDashboard} />);

    await waitFor(() => expect(view.getByText("AOP could not start")).toBeDefined());
    await waitFor(() => expect(startAopSidecar).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(navigateToDashboard).toHaveBeenCalledWith("http://127.0.0.1:25150/");
  });

  test("keeps setup gated when opening a guide fails", async () => {
    const backend = createBackend({
      getSetupState: mock(async () => blockedState()),
      openSetupGuide: mock(async () => {
        throw new Error("brew failed");
      }),
    });

    const view = render(<App backend={backend} navigateToDashboard={() => undefined} />);

    await waitFor(() => expect(view.getByText("Let's get AOP ready")).toBeDefined());
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Install Codex" }));
    });
    await waitFor(() => expect(view.getByText("Could not open installation guide")).toBeDefined());
    expect(backend.startAopSidecar).not.toHaveBeenCalled();
  });

  test("quits the desktop app when setup is declined", async () => {
    const backend = createBackend({ getSetupState: mock(async () => blockedState()) });

    const view = render(<App backend={backend} navigateToDashboard={() => undefined} />);

    await waitFor(() => expect(view.getByText("Let's get AOP ready")).toBeDefined());
    fireEvent.click(view.getByRole("button", { name: "Quit setup" }));

    expect(backend.quitApp).toHaveBeenCalledTimes(1);
  });

  test("shows a recoverable error when the sidecar command rejects", async () => {
    localStorage.setItem("aopDesktopSetupSeen", "true");
    const backend = createBackend({
      getSetupState: mock(async () => healthyState()),
      startAopSidecar: mock(async () => {
        throw new Error("sidecar missing");
      }),
    });

    const view = render(<App backend={backend} navigateToDashboard={() => undefined} />);

    await waitFor(() => expect(view.getByText("AOP could not start")).toBeDefined());
    expect(view.getByText("sidecar missing")).toBeDefined();
  });
});

const createBackend = (overrides: Partial<DesktopBackend> = {}): DesktopBackend => ({
  getSetupState: mock(async () => healthyState()),
  runSetupAction: mock(async () => healthyState()),
  openSetupGuide: mock(async () => undefined),
  startAopSidecar: mock(async () => readySidecar()),
  getSidecarState: mock(async () => readySidecar()),
  openLogsFolder: mock(async () => undefined),
  quitApp: mock(async () => undefined),
  listWslDistros: mock(async () => [] as WslDistro[]),
  getExecHost: mock(async () => "native"),
  setExecHost: mock(async () => undefined),
  ...overrides,
});

const blockedState = (): DesktopSetupState => ({
  ready: false,
  blockingRequirements: ["runtime"],
  requirements: [
    { id: "git", status: "ready", label: "Git", message: "Git is installed." },
    { id: "github-cli", status: "ready", label: "GitHub CLI", message: "Authenticated." },
    {
      id: "runtime",
      status: "missing",
      label: "Agent runtime",
      message: "Install and sign in to one.",
      actions: [
        {
          id: "install-runtime-codex",
          label: "Install Codex",
          requirementId: "runtime",
          requiresConsent: false,
          runtimeId: "codex",
        },
      ],
    },
  ],
  runtimes: [
    {
      id: "codex",
      status: "missing",
      label: "Codex",
      message: "Not installed.",
      recommended: true,
    },
  ],
});

const healthyState = (): DesktopSetupState => ({
  ready: true,
  blockingRequirements: [],
  requirements: [
    { id: "git", status: "ready", label: "Git", message: "Git is installed." },
    { id: "github-cli", status: "ready", label: "GitHub CLI", message: "Authenticated." },
    { id: "runtime", status: "ready", label: "Agent runtime", message: "Codex is available." },
  ],
  runtimes: [
    { id: "codex", status: "ready", label: "Codex", message: "Installed.", recommended: true },
  ],
});

const readySidecar = (): SidecarState => ({
  status: "ready",
  dashboardUrl: "http://127.0.0.1:25150/",
  message: "AOP is ready.",
});

const failedSidecar = (): SidecarState => ({
  status: "failed",
  logPath: "/Users/test/.aop/logs",
  message: "The AOP local server exited before it became healthy.",
});
