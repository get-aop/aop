import { describe, expect, mock, test } from "bun:test";
import type { DesktopBackend, WslDistro } from "../backend/types";
import { setupDesktopDom } from "../test/setup-dom";
import { SetupScreen } from "./SetupScreen";
import type { DesktopSetupState } from "./types";

setupDesktopDom();

const { act, fireEvent, render, waitFor } = await import("@testing-library/react");

const createBackend = (overrides: Partial<DesktopBackend> = {}): DesktopBackend => ({
  getSetupState: mock(async () => blockedState()),
  runSetupAction: mock(async () => blockedState()),
  openSetupGuide: mock(async () => undefined),
  startAopSidecar: mock(async () => ({ status: "ready" as const })),
  getSidecarState: mock(async () => ({ status: "ready" as const })),
  openLogsFolder: mock(async () => undefined),
  quitApp: mock(async () => undefined),
  listWslDistros: mock(async () => [] as WslDistro[]),
  getExecHost: mock(async () => "native"),
  setExecHost: mock(async () => undefined),
  ...overrides,
});

const blockedState = (): DesktopSetupState => ({
  ready: false,
  blockingRequirements: ["github-cli", "runtime"],
  requirements: [
    { id: "git", status: "ready", label: "Git", message: "Installed and on your PATH." },
    {
      id: "github-cli",
      status: "needs-auth",
      label: "GitHub CLI",
      message: "Installed, but you're not signed in yet.",
      actions: [
        {
          id: "auth-github-cli",
          label: "Sign in to GitHub",
          requirementId: "github-cli",
          requiresConsent: true,
          description: "Opens your browser to authorize the GitHub CLI on this machine.",
          commandPreview: "gh auth login -h github.com -w",
        },
      ],
    },
    {
      id: "runtime",
      status: "missing",
      label: "Agent runtime",
      message: "Install and sign in to one — you only need a single agent.",
      actions: [
        {
          id: "install-runtime-codex",
          label: "Install Codex",
          requirementId: "runtime",
          requiresConsent: false,
          runtimeId: "codex",
          description: "Installs the Codex CLI from OpenAI's official install script.",
          commandPreview: "sh -lc curl -fsSL https://chatgpt.com/codex/install.sh | sh",
        },
        {
          id: "install-runtime-claude",
          label: "Install Claude Code",
          requirementId: "runtime",
          requiresConsent: false,
          runtimeId: "claude",
        },
        {
          id: "install-runtime-opencode",
          label: "Install OpenCode",
          requirementId: "runtime",
          requiresConsent: false,
          runtimeId: "opencode",
        },
      ],
    },
  ],
  runtimes: [
    {
      id: "codex",
      status: "missing",
      label: "Codex",
      message: "Codex CLI is not installed.",
      recommended: true,
    },
    {
      id: "claude",
      status: "missing",
      label: "Claude Code",
      message: "Claude Code is not installed.",
    },
    { id: "opencode", status: "missing", label: "OpenCode", message: "OpenCode is not installed." },
  ],
});

const healthyState = (): DesktopSetupState => ({
  ready: true,
  blockingRequirements: [],
  requirements: [
    { id: "git", status: "ready", label: "Git", message: "Installed and on your PATH." },
    { id: "github-cli", status: "ready", label: "GitHub CLI", message: "Authenticated and ready." },
    { id: "runtime", status: "ready", label: "Agent runtime", message: "Codex is installed." },
  ],
  runtimes: [
    {
      id: "codex",
      status: "ready",
      label: "Codex",
      message: "Codex CLI is installed.",
      recommended: true,
    },
    {
      id: "claude",
      status: "missing",
      label: "Claude Code",
      message: "Claude Code is not installed.",
    },
    { id: "opencode", status: "missing", label: "OpenCode", message: "OpenCode is not installed." },
  ],
  automationActions: [
    {
      id: "install-codex-browser-plugins",
      label: "Install Codex browser extensions",
      requirementId: "runtime",
      requiresConsent: true,
      commandPreview:
        "codex plugin add browser@openai-bundled && codex plugin add chrome@openai-bundled",
    },
  ],
});

const optionalGitHubState = (): DesktopSetupState => ({
  ...healthyState(),
  requirements: healthyState().requirements.map((requirement) =>
    requirement.id === "github-cli"
      ? {
          ...requirement,
          status: "needs-auth",
          message: "Sign in to enable GitHub pull-request actions.",
          actions: [
            {
              id: "auth-github-cli",
              label: "Sign in to GitHub",
              requirementId: "github-cli",
              requiresConsent: true,
            },
          ],
        }
      : requirement,
  ),
});

const renderScreen = (overrides: { state?: DesktopSetupState; backend?: DesktopBackend } = {}) =>
  render(
    <SetupScreen
      state={overrides.state ?? blockedState()}
      appVersion="0.0.0-test"
      backend={overrides.backend ?? createBackend()}
      onReScan={mock(async () => undefined)}
      onRunAction={mock(async () => undefined)}
      onOpenDashboard={mock(async () => undefined)}
      onOpenLogs={mock(async () => undefined)}
      onDeclineRequiredSetup={mock(() => undefined)}
    />,
  );

describe("SetupScreen", () => {
  test("allows dashboard entry while optional GitHub authentication is unavailable", async () => {
    const onOpenDashboard = mock(async () => undefined);
    const view = render(
      <SetupScreen
        state={optionalGitHubState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={mock(async () => undefined)}
        onOpenDashboard={onOpenDashboard}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    expect(view.getByRole("button", { name: "Sign in to GitHub" })).toBeDefined();
    const openDashboard = view.getByRole("button", { name: "Open dashboard" });
    expect((openDashboard as HTMLButtonElement).disabled).toBe(false);

    await act(async () => {
      fireEvent.click(openDashboard);
    });

    expect(onOpenDashboard).toHaveBeenCalledTimes(1);
  });

  test("blocks setup with WSL guidance instead of offering native Windows", () => {
    const view = renderScreen({
      state: {
        ready: false,
        requirements: [
          {
            id: "wsl",
            status: "missing",
            label: "WSL 2",
            message: "Install WSL 2 and an Ubuntu distro, restart Windows, then check again.",
          },
        ],
        runtimes: [],
        blockingRequirements: ["wsl"],
      },
    });

    expect(view.getByText("WSL 2")).toBeDefined();
    expect(view.getByText(/Install WSL 2 and an Ubuntu distro/)).toBeDefined();
    expect(view.queryByText("Native Windows")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Open dashboard" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  test("renders the hero, requirements, agent picker, and finish card", () => {
    const view = renderScreen();

    expect(view.getByText("DESKTOP SETUP")).toBeDefined();
    expect(view.getByText("Let's get AOP ready")).toBeDefined();
    expect(view.getByText("Git")).toBeDefined();
    expect(view.getByText("GitHub CLI")).toBeDefined();
    expect(view.getByText("Codex")).toBeDefined();
    expect(view.getByRole("button", { name: "Install Codex" })).toBeDefined();
    expect(view.getByRole("button", { name: "Sign in to GitHub" })).toBeDefined();
    expect(view.getByText(/Almost there/)).toBeDefined();
  });

  test("asks for consent before running a GitHub sign-in action", async () => {
    const onRunAction = mock(async () => undefined);
    const view = renderScreen({ backend: createBackend() });
    view.rerender(
      <SetupScreen
        state={blockedState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={onRunAction}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Sign in to GitHub" }));
    });

    await waitFor(() => {
      expect(view.getByRole("dialog", { name: "Approve setup action" })).toBeDefined();
    });
    expect(view.getByText(/sign in to GitHub CLI/u)).toBeDefined();
    expect(view.getByText("gh auth login -h github.com -w")).toBeDefined();
    expect(onRunAction).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Approve & run/u }));
    });

    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith("auth-github-cli"));
  });

  test("opens the selected agent installation guide directly", async () => {
    const onRunAction = mock(async () => undefined);
    const openSetupGuide = mock(async (_actionId: string) => undefined);
    const backend = { ...createBackend(), openSetupGuide };
    const view = render(
      <SetupScreen
        state={blockedState()}
        appVersion="0.0.0-test"
        backend={backend}
        onReScan={mock(async () => undefined)}
        onRunAction={onRunAction}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Install Codex" }));
    });
    await waitFor(() => expect(openSetupGuide).toHaveBeenCalledWith("install-runtime-codex"));
    expect(onRunAction).not.toHaveBeenCalled();
    expect(view.queryByRole("dialog")).toBeNull();
  });

  test("opens setup install guides directly without a consent dialog", async () => {
    const onRunAction = mock(async () => undefined);
    const openSetupGuide = mock(async (_actionId: string) => undefined);
    const backend = { ...createBackend(), openSetupGuide };
    const state = installGuideState();
    const view = render(
      <SetupScreen
        state={state}
        appVersion="0.0.0-test"
        backend={backend}
        onReScan={mock(async () => undefined)}
        onRunAction={onRunAction}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    for (const [button, actionId] of [
      ["Install Git", "install-git"],
      ["Install GitHub CLI", "install-github-cli"],
      ["Install Codex", "install-runtime-codex"],
    ] as const) {
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: button }));
      });
      expect(openSetupGuide).toHaveBeenLastCalledWith(actionId);
      expect(view.queryByRole("dialog")).toBeNull();
    }

    for (const [runtime, installButton, actionId] of [
      [/^Claude Code/u, "Install Claude Code", "install-runtime-claude"],
      [/^OpenCode/u, "Install OpenCode", "install-runtime-opencode"],
      [/^Pi/u, "Install Pi", "install-runtime-pi"],
    ] as const) {
      fireEvent.click(view.getByRole("button", { name: runtime }));
      await act(async () => {
        fireEvent.click(view.getByRole("button", { name: installButton }));
      });
      expect(openSetupGuide).toHaveBeenLastCalledWith(actionId);
      expect(view.queryByRole("dialog")).toBeNull();
    }
    expect(onRunAction).not.toHaveBeenCalled();
  });

  test("re-runs the checks when the user asks to re-scan", async () => {
    const onReScan = mock(async () => undefined);
    const view = render(
      <SetupScreen
        state={blockedState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={onReScan}
        onRunAction={mock(async () => undefined)}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /Re-run checks/u }));
    });

    await waitFor(() => expect(onReScan).toHaveBeenCalledTimes(1));
  });

  test("opens the dashboard once every check passes", async () => {
    const onOpenDashboard = mock(async () => undefined);
    const view = render(
      <SetupScreen
        state={healthyState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={mock(async () => undefined)}
        onOpenDashboard={onOpenDashboard}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    expect(view.getByText("You're all set")).toBeDefined();
    expect(view.getAllByRole("button", { name: "Open dashboard" })).toHaveLength(1);

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Open dashboard" }));
    });

    await waitFor(() => expect(onOpenDashboard).toHaveBeenCalledTimes(1));
  });

  test("offers runtime automation extensions after an agent is installed", async () => {
    const onRunAction = mock(async () => undefined);
    const view = render(
      <SetupScreen
        state={healthyState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={onRunAction}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Install Codex browser extensions" }));
    fireEvent.click(view.getByRole("button", { name: /Approve & run/u }));
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith("install-codex-browser-plugins"));
  });

  test("quits setup when the user chooses not to continue", () => {
    const onDeclineRequiredSetup = mock(() => undefined);
    const view = render(
      <SetupScreen
        state={blockedState()}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={mock(async () => undefined)}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={onDeclineRequiredSetup}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "Quit setup" }));

    expect(onDeclineRequiredSetup).toHaveBeenCalledTimes(1);
  });

  test("treats manual actions as steps to run yourself (no fake install)", async () => {
    const onRunAction = mock(async () => undefined);
    const writeText = mock(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const manualState: DesktopSetupState = {
      ...blockedState(),
      requirements: [
        { id: "git", status: "ready", label: "Git", message: "Installed." },
        {
          id: "github-cli",
          status: "needs-auth",
          label: "GitHub CLI",
          message: "Sign in needed.",
          actions: [
            {
              id: "auth-github-cli",
              label: "Sign in to GitHub",
              requirementId: "github-cli",
              requiresConsent: true,
              description: "Run gh auth login in your terminal to sign in.",
              commandPreview: "gh auth login -h github.com -w",
              manual: true,
            },
          ],
        },
        { id: "runtime", status: "ready", label: "Agent runtime", message: "Ready." },
      ],
    };

    const view = render(
      <SetupScreen
        state={manualState}
        appVersion="0.0.0-test"
        backend={createBackend()}
        onReScan={mock(async () => undefined)}
        onRunAction={onRunAction}
        onOpenDashboard={mock(async () => undefined)}
        onOpenLogs={mock(async () => undefined)}
        onDeclineRequiredSetup={mock(() => undefined)}
      />,
    );

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Sign in to GitHub" }));
    });

    await waitFor(() =>
      expect(view.getByRole("dialog", { name: "Manual setup step" })).toBeDefined(),
    );
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Copy command" }));
    });
    expect(writeText).toHaveBeenCalledWith("gh auth login -h github.com -w");
    expect(view.getByRole("button", { name: "Command copied" })).toBeDefined();
    expect(view.getByRole("button", { name: /I've done this — re-check/u })).toBeDefined();

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: /I've done this — re-check/u }));
    });

    // Re-probes instead of claiming success.
    await waitFor(() => expect(onRunAction).toHaveBeenCalledWith("auth-github-cli"));
    await waitFor(() => expect(view.getByText("Re-checked setup")).toBeDefined());
  });
});

const installGuideState = (): DesktopSetupState =>
  ({
    ready: false,
    blockingRequirements: ["git", "runtime"],
    requirements: [
      {
        id: "git",
        status: "missing",
        label: "Git",
        message: "Git is required.",
        actions: [
          {
            id: "install-git",
            label: "Install Git",
            requirementId: "git",
            requiresConsent: false,
          },
        ],
      },
      {
        id: "github-cli",
        status: "missing",
        label: "GitHub CLI",
        message: "GitHub CLI is optional.",
        actions: [
          {
            id: "install-github-cli",
            label: "Install GitHub CLI",
            requirementId: "github-cli",
            requiresConsent: false,
          },
        ],
      },
      {
        id: "runtime",
        status: "missing",
        label: "Agent runtime",
        message: "Install one runtime.",
        actions: [
          ["codex", "Codex"],
          ["claude", "Claude Code"],
          ["opencode", "OpenCode"],
          ["pi", "Pi"],
        ].map(([runtimeId, label]) => ({
          id: `install-runtime-${runtimeId}`,
          label: `Install ${label}`,
          requirementId: "runtime",
          requiresConsent: false,
          runtimeId,
        })),
      },
    ],
    runtimes: [
      { id: "codex", status: "missing", label: "Codex", message: "Missing.", recommended: true },
      { id: "claude", status: "missing", label: "Claude Code", message: "Missing." },
      { id: "opencode", status: "missing", label: "OpenCode", message: "Missing." },
      { id: "pi", status: "missing", label: "Pi", message: "Missing." },
    ],
  }) as unknown as DesktopSetupState;
