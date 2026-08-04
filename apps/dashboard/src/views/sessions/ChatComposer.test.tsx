import { afterEach, describe, expect, mock, test } from "bun:test";
import type {
  ChatRuntimeActionSelection,
  ChatWorkflowSelection,
  ControlCommandSelection,
  RuntimeConfigurationProvider,
} from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { useState } = await import("react");
const { ChatComposer } = await import("./ChatComposer");
const { createRuntimeAction } = await import("./composer-runtime-actions");
const { resizeComposerInput } = await import("./composer-shell");
const originalConfirm = window.confirm;

afterEach(() => {
  cleanup();
  window.confirm = originalConfirm;
  window.localStorage.removeItem("aop:composer-model-favorites:v1");
});

const baseProps = {
  input: "",
  onInput: mock((_value: string) => {}),
  onSend: mock(() => {}),
  runtime: "claude-code",
  model: "claude-opus-4-8",
  effort: "medium",
  connected: true,
  termOpen: false,
  onRuntimeMenu: mock(() => {}),
  onModelMenu: mock(() => {}),
  onEffortMenu: mock(() => {}),
  onMoreMenu: mock(() => {}),
  onSlashPick: mock((_cmd: string) => {}),
  termLines: [] as [],
  termInput: "",
  onTermInput: mock(() => {}),
  onTermRun: mock(() => {}),
  onTermClose: mock(() => {}),
  repoPath: "/tmp/repo",
};

describe("ChatComposer context chips and typeahead", () => {
  test("composer column uses shared chat-column width (aligned with thread)", () => {
    render(<ChatComposer {...baseProps} sessionId="s1" />);

    const column = screen.getByTestId("chat-composer-column");
    expect(column.className).toContain("chat-column");
    expect(column.className).not.toContain("chat-column--with-delegations");
  });

  test("does not offer delegation for ordinary runtime words", () => {
    render(<ChatComposer {...baseProps} input="Ask PI and OpenCode to compare approaches" />);

    expect(screen.queryByTestId("composer-delegation-action")).toBeNull();
    expect(screen.queryByText(/Delegate to/)).toBeNull();
  });

  test("Confirm collapses the header chip into a yellow summary and restores caret", async () => {
    render(
      <ChatComposer
        {...baseProps}
        input="codex"
        runtimeDelegation={{
          id: "codex",
          model: "gpt-5.5",
          reasoning: "medium",
          tokenStart: 0,
          tokenEnd: 5,
        }}
      />,
    );

    expect(screen.getByTestId("composer-delegation-action").getAttribute("data-tone")).toBe(
      "config",
    );
    expect(screen.queryByTestId("composer-delegation-token")).toBeNull();
    fireEvent.click(screen.getByTestId("composer-delegation-confirm"));
    expect(screen.getByTestId("composer-delegation-action").getAttribute("data-tone")).toBe(
      "armed",
    );
    expect(screen.getByTestId("composer-delegation-summary").textContent).toContain(
      "Will delegate to ‘Codex’",
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  test("shows armed config with model, thinking, and removable selection", async () => {
    const onRuntimeDelegationChange = mock((_value: unknown) => {});
    render(
      <ChatComposer
        {...baseProps}
        input="codex fix the build"
        runtimeDelegation={{ id: "codex", model: "gpt-5.5", reasoning: "medium", fastMode: false }}
        onRuntimeDelegationChange={onRuntimeDelegationChange}
      />,
    );

    const action = screen.getByTestId("composer-delegation-action");
    expect(action.getAttribute("data-tone")).toBe("config");
    expect(action.textContent).toContain("Codex");
    expect(screen.queryByTestId("composer-delegation-token")).toBeNull();

    const model = screen.getByRole("combobox", { name: "Delegation model" });
    expect(model.textContent).toContain("GPT 5.5");
    fireEvent.pointerDown(model, { button: 0, ctrlKey: false });
    fireEvent.click(model);
    fireEvent.click(await screen.findByRole("option", { name: "gpt-5.4" }));
    expect(onRuntimeDelegationChange).toHaveBeenLastCalledWith({
      id: "codex",
      model: "gpt-5.4",
      reasoning: "medium",
      fastMode: false,
    });

    const thinking = screen.getByRole("combobox", { name: "Delegation thinking" });
    fireEvent.pointerDown(thinking, { button: 0, ctrlKey: false });
    fireEvent.click(thinking);
    fireEvent.click(await screen.findByRole("option", { name: "Extra-High" }));
    expect(onRuntimeDelegationChange).toHaveBeenLastCalledWith({
      id: "codex",
      model: "gpt-5.5",
      reasoning: "extra-high",
      fastMode: false,
    });

    expect(screen.getByTestId("composer-delegation-confirm")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Cancel Codex delegation"));
    expect(onRuntimeDelegationChange).toHaveBeenLastCalledWith(null);
  });

  test("keeps the armed header chip when the provider word is edited away", () => {
    render(
      <ChatComposer
        {...baseProps}
        input="fix the build"
        runtimeDelegation={{ id: "codex", model: "gpt-5.5", reasoning: "high", fastMode: false }}
      />,
    );

    const action = screen.getByTestId("composer-delegation-action");
    expect(action.getAttribute("data-tone")).toBe("config");
    expect(action.textContent).toContain("Codex");
  });

  test("animates the conversation divider only while the assistant is active", () => {
    const { rerender } = render(<ChatComposer {...baseProps} assistantActive />);

    expect(screen.getByTestId("chat-composer").className).toContain("chat-composer-divider-active");

    rerender(<ChatComposer {...baseProps} assistantActive={false} />);
    expect(screen.getByTestId("chat-composer").className).not.toContain(
      "chat-composer-divider-active",
    );
  });

  test("shows the selected runtime configuration name", () => {
    render(<ChatComposer {...baseProps} runtimeConfigurationName="Claude Code Personal" />);

    expect(screen.getByTestId("composer-runtime-config").textContent).toContain(
      "Claude Code Personal",
    );
  });

  test("renders the ＋ menu with attach actions when configured", async () => {
    const onAttachImage = mock(() => {});
    render(
      <ChatComposer {...baseProps} plusMenu={{ onAttachImage, onAttachDocument: () => {} }} />,
    );

    const plus = screen.getByTestId("composer-plus");
    fireEvent.pointerDown(plus, { button: 0, ctrlKey: false });
    fireEvent.click(plus);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Attach image" }));
    expect(onAttachImage).toHaveBeenCalled();
  });

  test("hides the ＋ menu when no attach actions are configured", () => {
    render(<ChatComposer {...baseProps} />);

    expect(screen.queryByRole("button", { name: "Add to message" })).toBeNull();
    expect(screen.queryByTestId("composer-plus")).toBeNull();
  });

  test("transforms the single send action into stop while a conversation is active", () => {
    const onAbort = mock(() => {});
    const { rerender } = render(<ChatComposer {...baseProps} onAbort={onAbort} />);

    const action = screen.getByTestId("composer-conversation-action");
    expect(screen.getByRole("button", { name: "Send message" })).toBe(action);

    rerender(<ChatComposer {...baseProps} assistantActive onAbort={onAbort} />);
    expect(screen.getByTestId("composer-conversation-action")).toBe(action);
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop conversation" }));
    expect(onAbort).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAbort).toHaveBeenCalledTimes(2);

    rerender(<ChatComposer {...baseProps} assistantActive={false} onAbort={onAbort} />);
    expect(screen.queryByRole("button", { name: "Stop conversation" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onAbort).toHaveBeenCalledTimes(2);
  });

  test("renders fast mode as a t3code footer trait when supported", () => {
    render(
      <ChatComposer
        {...baseProps}
        supportsFastMode
        fastMode={false}
        onToggleFastMode={() => undefined}
      />,
    );

    expect(screen.getByTestId("composer-fast-mode")).toBeTruthy();
    expect(screen.getByTestId("composer-runtime-config")).toBeTruthy();
  });

  test("does not surface AOP default worker or workflow pills in the T3Code composer", () => {
    render(
      <ChatComposer
        {...baseProps}
        workers={[
          { id: "w1", name: "Ada" },
          { id: "w2", name: "Bob" },
        ]}
        workflows={["aop-default-gpt", "simple"]}
        defaultWorkerId="w1"
        defaultWorkflowId="aop-default-gpt"
        worktreePath="/workspace/aop-mono"
      />,
    );

    expect(screen.queryByTestId("composer-worker-chip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear @Ada" })).toBeNull();
    expect(screen.queryByText("#aop-default-gpt")).toBeNull();
  });

  test("uses distinct t3-style model, effort, and access dropdowns without Build or Plan", async () => {
    const runtimeConfigurations: RuntimeConfigurationProvider[] = [
      {
        id: "rtprov_claude",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code",
        builtIn: true,
        position: 0,
        supportsFastMode: false,
        models: [
          {
            id: "rtmodel_opus",
            providerId: "rtprov_claude",
            description: "Opus 4.8",
            model: "claude-opus-4-8",
            thinkingLevels: ["low", "medium", "high"],
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium",
          },
        ],
      },
      {
        id: "rtprov_codex",
        name: "Codex",
        command: "codex",
        driver: "codex-cli",
        builtIn: true,
        position: 1,
        supportsFastMode: true,
        models: [
          {
            id: "rtmodel_gpt",
            providerId: "rtprov_codex",
            description: "GPT-5.5",
            model: "gpt-5.5",
            thinkingLevels: ["low", "medium", "high"],
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium",
          },
        ],
      },
      {
        id: "rtprov_custom",
        name: "Custom E2E",
        command: "custom-e2e",
        driver: "custom",
        builtIn: false,
        position: 2,
        supportsFastMode: false,
        models: [
          {
            id: "rtmodel_custom",
            providerId: "rtprov_custom",
            description: "Custom model",
            model: "custom-model",
            thinkingLevels: [],
            builtIn: false,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: null,
          },
        ],
      },
    ];
    const onModelChange = mock((_model: string) => {});
    const onEffortChange = mock((_effort: string) => {});
    const onRuntimeAccessModeChange = mock((_mode: string) => {});
    render(
      <ChatComposer
        {...baseProps}
        runtimeConfigurationName="Claude Code"
        sessionRuntimeConfigurationId="rtprov_claude"
        runtimeConfigurations={runtimeConfigurations}
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
        onRuntimeAccessModeChange={onRuntimeAccessModeChange}
        workers={[{ id: "w1", name: "Ada" }]}
        workflows={["wf"]}
      />,
    );

    expect(screen.queryByTestId("composer-worker-chip")).toBeNull();
    expect(screen.queryByTestId("composer-workflow-chip")).toBeNull();
    expect(screen.queryByRole("button", { name: "Interaction mode" })).toBeNull();
    expect(screen.queryByText("Build")).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();

    const modelTrigger = screen.getByRole("button", { name: "Model" });
    expect(modelTrigger.querySelector('[data-provider-icon="claude-code"]')).toBeTruthy();
    fireEvent.click(modelTrigger);
    expect(screen.getByPlaceholderText("Search models...")).toBeTruthy();
    expect(screen.getByTestId("model-picker-sidebar")).toBeTruthy();
    const modelPicker = screen.getByTestId("model-picker-content");
    expect(modelPicker.className).toContain("max-h-96");
    expect(modelPicker.className).not.toContain("border-white");
    expect(screen.getByTestId("model-picker-model-list").className).toContain("overflow-y-auto");
    expect(
      screen
        .getByRole("button", { name: "Claude Code" })
        .querySelector('[data-provider-icon="claude-code"]'),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Custom E2E" })).toBeNull();
    const searchInput = screen.getByPlaceholderText("Search models...");
    fireEvent.change(searchInput, { target: { value: "GPT-5.5" } });
    expect(screen.queryByTestId("model-picker-sidebar")).toBeNull();
    expect(screen.getByRole("option", { name: /GPT-5.5/ })).toBeTruthy();
    fireEvent.change(searchInput, { target: { value: "" } });
    expect(screen.getByTestId("model-picker-sidebar")).toBeTruthy();
    const modelOption = screen.getByRole("option", { name: /Opus 4.8/ });
    fireEvent.click(screen.getByRole("button", { name: "Add to favorites" }));
    expect(screen.getByRole("button", { name: "Remove from favorites" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Favorites" }));
    expect(screen.getByRole("option", { name: /Opus 4.8/ })).toBeTruthy();
    fireEvent.click(modelOption);
    expect(onModelChange).toHaveBeenCalledWith("claude-opus-4-8", "rtprov_claude");

    const effortTrigger = screen.getByRole("button", { name: "Reasoning effort" });
    fireEvent.pointerDown(effortTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(effortTrigger);
    const high = await screen.findByRole("menuitemradio", { name: /High/ });
    expect(high).toBeTruthy();
    fireEvent.click(high);
    expect(onEffortChange).toHaveBeenCalledWith("high");
    fireEvent.keyDown(document, { key: "Escape" });

    const accessTrigger = screen.getByLabelText("Runtime mode");
    fireEvent.pointerDown(accessTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(accessTrigger);
    expect(await screen.findByRole("menuitem", { name: /Full access/ })).toBeTruthy();
    const autoAccept = screen.getByRole("menuitem", { name: /Auto-accept edits/ });
    fireEvent.click(autoAccept);
    expect(onRuntimeAccessModeChange).toHaveBeenCalledWith("auto-accept-edits");
  });

  test("locks the model picker once the session has started", async () => {
    const onModelChange = mock((_model: string) => {});
    const onEffortChange = mock((_effort: string) => {});
    render(
      <ChatComposer
        {...baseProps}
        modelLocked
        onModelChange={onModelChange}
        onEffortChange={onEffortChange}
      />,
    );

    const modelTrigger = screen.getByRole("button", { name: "Model" });
    expect(modelTrigger.getAttribute("data-locked")).toBe("true");
    fireEvent.click(modelTrigger);
    expect(screen.queryByPlaceholderText("Search models...")).toBeNull();
    expect(screen.queryByTestId("model-picker-content")).toBeNull();
    expect(onModelChange).not.toHaveBeenCalled();

    // effort stays changeable while the model is locked
    const effortTrigger = screen.getByRole("button", { name: "Reasoning effort" });
    fireEvent.pointerDown(effortTrigger, { button: 0, ctrlKey: false });
    fireEvent.click(effortTrigger);
    const high = await screen.findByRole("menuitemradio", { name: /High/ });
    fireEvent.click(high);
    expect(onEffortChange).toHaveBeenCalledWith("high");
  });

  test("shows access controls for every built-in runtime driver", () => {
    const drivers = ["claude-code", "codex-cli", "grok-build", "opencode", "pi"] as const;

    for (const [position, driver] of drivers.entries()) {
      const id = `rtprov_${driver}`;
      const runtime: RuntimeConfigurationProvider = {
        id,
        name: driver,
        command: driver,
        driver,
        builtIn: true,
        position,
        supportsFastMode: false,
        models: [
          {
            id: `rtmodel_${driver}`,
            providerId: id,
            description: `${driver} model`,
            model: `${driver}-model`,
            thinkingLevels: ["medium"],
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium",
          },
        ],
      };

      render(
        <ChatComposer
          {...baseProps}
          runtime={driver}
          model={`${driver}-model`}
          sessionRuntimeConfigurationId={id}
          runtimeConfigurations={[runtime]}
        />,
      );
      expect(screen.getByLabelText("Runtime mode")).toBeTruthy();
      cleanup();
    }
  });

  test("hides access controls for a custom runtime", () => {
    const customRuntime: RuntimeConfigurationProvider = {
      id: "rtprov_custom",
      name: "My custom runtime",
      command: "my-runtime",
      driver: "custom",
      builtIn: false,
      position: 0,
      supportsFastMode: false,
      models: [
        {
          id: "rtmodel_custom",
          providerId: "rtprov_custom",
          description: "Custom model",
          model: "custom-model",
          thinkingLevels: [],
          builtIn: false,
          position: 0,
          isDefault: true,
          defaultThinkingLevel: null,
        },
      ],
    };

    render(
      <ChatComposer
        {...baseProps}
        runtime="custom"
        model="custom-model"
        runtimeConfigurationName="My custom runtime"
        sessionRuntimeConfigurationId={customRuntime.id}
        runtimeConfigurations={[customRuntime]}
      />,
    );

    expect(screen.queryByLabelText("Runtime mode")).toBeNull();
    expect(screen.queryByText("Full access")).toBeNull();
  });

  test("shows the current checkout and branch in the footer strip", () => {
    render(
      <ChatComposer {...baseProps} worktreePath="/tmp/repo" branch="feature/session-location" />,
    );

    const footer = screen.getByTestId("composer-footer-strip");
    expect(footer.textContent).toContain("Local checkout");
    expect(footer.textContent).toContain("feature/session-location");
  });

  test("collapses an active worktree, diffstat, and long branch into one clean footer row", () => {
    render(
      <ChatComposer
        {...baseProps}
        worktreePath="/tmp/aop/worktrees/isess_very_long_session_identifier"
        branch="revamp-sessions-page-port-t3code-sidebar-chat-composer"
        gitDiffstat={{ filesChanged: 12, additions: 12011, deletions: 2204 }}
      />,
    );

    const footer = screen.getByTestId("composer-footer-strip");
    expect(footer.textContent).toContain("Current worktree");
    expect(footer.textContent).not.toContain("isess_very_long_session_identifier");
    expect(footer.textContent).toContain("+12011");
    expect(footer.textContent).toContain("−2204");
    expect(footer.className).toContain("max-w-3xl");
    expect(screen.getByTestId("composer-footer-branch").className).toContain("min-w-0");
  });

  test("opens the branch picker, filters refs, and switches branches", async () => {
    const onListBranches = mock(async () => ({
      branches: [
        {
          name: "feature/current",
          isCurrent: true,
          isDefault: false,
          worktreePath: "/tmp/current",
        },
        { name: "main", isCurrent: false, isDefault: true, worktreePath: "/tmp/repo" },
        {
          name: "feature/other-worktree",
          isCurrent: false,
          isDefault: false,
          worktreePath: "/tmp/other",
        },
      ],
    }));
    const onBranchChange = mock(async (_branch: string) => {});
    render(
      <ChatComposer
        {...baseProps}
        worktreePath="/tmp/current"
        branch="feature/current"
        onListBranches={onListBranches}
        onBranchChange={onBranchChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Branch" }));
    const search = await screen.findByPlaceholderText("Search refs…");
    await waitFor(() => expect(onListBranches).toHaveBeenCalledTimes(1));
    const picker = await screen.findByTestId("branch-picker-content");
    expect(await within(picker).findByText("feature/current")).toBeTruthy();
    expect(within(picker).getByText("main")).toBeTruthy();

    fireEvent.change(search, { target: { value: "other" } });
    expect(within(picker).queryByText("main")).toBeNull();
    fireEvent.click(await within(picker).findByText("feature/other-worktree"));

    await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith("feature/other-worktree"));
  });

  test("disables branch switching while the assistant is active", () => {
    render(
      <ChatComposer
        {...baseProps}
        assistantActive
        worktreePath="/tmp/current"
        branch="feature/current"
        onListBranches={mock(async () => ({ branches: [] }))}
        onBranchChange={mock(async () => {})}
      />,
    );

    expect((screen.getByRole("button", { name: "Branch" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  test("hides the diffstat chip when the working tree is clean", () => {
    render(
      <ChatComposer
        {...baseProps}
        worktreePath="/workspace/aop-mono"
        branch="main"
        gitDiffstat={null}
      />,
    );

    expect(screen.queryByTestId("session-git-diffstat")).toBeNull();
  });

  test("shows diffstat in the checkout strip when files changed", () => {
    const onDiffstatClick = mock(() => {});
    render(
      <ChatComposer
        {...baseProps}
        worktreePath="/workspace/aop-mono"
        branch="feature/dirty"
        gitDiffstat={{ filesChanged: 3, additions: 12, deletions: 4 }}
        onDiffstatClick={onDiffstatClick}
      />,
    );

    const diffstat = screen.getByTestId("session-git-diffstat");
    expect(diffstat.textContent).toContain("+12");
    expect(diffstat.textContent).toContain("−4");
    fireEvent.click(diffstat);
    expect(onDiffstatClick).toHaveBeenCalledTimes(1);
  });

  test("does not show a location strip without a worktree path", () => {
    render(
      <ChatComposer {...baseProps} gitDiffstat={{ filesChanged: 2, additions: 1, deletions: 0 }} />,
    );

    expect(screen.queryByTestId("composer-session-location")).toBeNull();
    expect(screen.queryByTestId("session-git-diffstat")).toBeNull();
  });

  test("shows worktree creation in the bottom checkout strip", () => {
    render(
      <ChatComposer
        {...baseProps}
        suggestedWorktreeBranch="aop/fix-auth-abc123"
        onCreateWorktree={mock(async () => {})}
      />,
    );

    expect(screen.getByTestId("composer-footer-strip")).toBeTruthy();
    expect(screen.getByTestId("composer-worktree")).toBeTruthy();
    fireEvent.click(screen.getByTestId("composer-worktree"));
    expect(screen.getByTestId("composer-worktree-branch")).toBeTruthy();
  });

  test("closes the bottom worktree menu after creation and reports failures", async () => {
    const onCreateWorktree = mock(async () => {});
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        suggestedWorktreeBranch="aop/fix-auth-abc123"
        onCreateWorktree={onCreateWorktree}
      />,
    );

    const worktreeTrigger = screen.getByTestId("composer-worktree");
    fireEvent.click(worktreeTrigger);
    const newWorktree = screen.getByTestId("composer-worktree-branch");
    fireEvent.pointerDown(newWorktree);
    fireEvent.pointerUp(newWorktree);
    fireEvent.click(newWorktree);
    await waitFor(() => expect(worktreeTrigger.getAttribute("aria-expanded")).toBe("false"));
    expect(onCreateWorktree).toHaveBeenCalledWith("aop/fix-auth-abc123");

    rerender(
      <ChatComposer
        {...baseProps}
        suggestedWorktreeBranch="aop/fix-auth-abc123"
        onCreateWorktree={mock(async () => {
          throw new Error("Branch already exists");
        })}
      />,
    );
    fireEvent.click(screen.getByTestId("composer-worktree"));
    const failingWorktree = screen.getByTestId("composer-worktree-branch");
    fireEvent.pointerDown(failingWorktree);
    fireEvent.pointerUp(failingWorktree);
    fireEvent.click(failingWorktree);
    expect((await screen.findByRole("alert")).textContent).toContain("Branch already exists");
    expect(screen.getByTestId("composer-worktree-branch")).toBeTruthy();
  });

  test("keeps commit and terminal actions in the t3code chat header", () => {
    render(
      <ChatComposer {...baseProps} onCommit={mock(async () => {})} onToggleTerm={mock(() => {})} />,
    );

    expect(screen.queryByTestId("composer-commit")).toBeNull();
    expect(screen.queryByTestId("composer-terminal")).toBeNull();
  });

  test("hides commit control when no commit callback is supplied", () => {
    render(<ChatComposer {...baseProps} onToggleTerm={mock(() => {})} />);
    expect(screen.queryByTestId("composer-commit")).toBeNull();
  });

  test("uses the scira rounded composer surface, ghost controls, and circular send action", () => {
    render(<ChatComposer {...baseProps} />);

    expect(screen.getByTestId("composer-canvas-frame").className).toContain("rounded-[22px]");
    const canvas = screen.getByTestId("composer-canvas");
    expect(canvas.className).toContain("rounded-composer");
    expect(canvas.className).toContain("bg-input-surface");
    expect(canvas.className).toContain("border-border-strong");

    const actionButton = screen.getByTestId("composer-conversation-action") as HTMLButtonElement;
    expect(actionButton.className).toContain("rounded-full");
    expect(actionButton.className).toContain("h-9");
    expect(actionButton.className).toContain("w-9");
    expect(actionButton.className).toContain("sm:h-8");
    expect(actionButton.className).toContain("sm:w-8");

    const modelButton = screen.getByTestId("composer-runtime-config") as HTMLButtonElement;
    expect(modelButton.className).toContain("border-transparent");
    expect(modelButton.className).toContain("rounded-lg");
  });

  test("does not duplicate the chat-header worktree popover inside the composer", () => {
    render(
      <ChatComposer
        {...baseProps}
        suggestedWorktreeBranch="aop/fix-auth-abc123"
        onCreateWorktree={mock(async () => {})}
      />,
    );

    expect(screen.queryByTestId("composer-worktree-popover")).toBeNull();
    expect(screen.queryByTestId("composer-worktree-create")).toBeNull();
  });

  test("shows a header control chip for explicit $control tokens without draft highlights", () => {
    const ControlledComposer = () => {
      const [selection, setSelection] = useState<ControlCommandSelection | null>(null);
      return (
        <ChatComposer
          {...baseProps}
          input="$CX_BROWSER_USE inspect the page"
          controlSelection={selection}
          onControlSelectionChange={setSelection}
        />
      );
    };
    render(<ControlledComposer />);

    expect(screen.queryByTestId("composer-control-warning")).toBeNull();
    expect(screen.getByTestId("composer-control-action").getAttribute("data-tone")).toBe("config");
    expect(screen.getByRole("combobox", { name: "Control model" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Control thinking" })).toBeTruthy();
    expect(screen.getByText("Codex Browser")).toBeTruthy();
    expect(
      screen.getByTestId("composer-highlight-layer").querySelector("[data-kind=control]"),
    ).toBeNull();
  });

  test("confirming control collapses to a yellow summary; dismiss clears the $token", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("$CX_BROWSER_USE inspect the page");
      const [selection, setSelection] = useState<ControlCommandSelection | null>({
        id: "CX_BROWSER_USE",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: false,
      });
      return (
        <ChatComposer
          {...baseProps}
          input={input}
          onInput={setInput}
          controlSelection={selection}
          onControlSelectionChange={setSelection}
        />
      );
    };
    render(<ControlledComposer />);

    fireEvent.click(screen.getByTestId("composer-control-confirm"));
    expect(screen.getByTestId("composer-control-action").getAttribute("data-tone")).toBe("armed");
    expect(screen.getByTestId("composer-control-summary").textContent).toContain(
      "Will use Codex Browser",
    );

    fireEvent.click(screen.getByLabelText("Remove Codex Browser control"));
    expect(screen.queryByTestId("composer-control-action")).toBeNull();
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("inspect the page");
  });

  test("clearing a control preserves draft indentation", () => {
    const input = ["$CX_BROWSER_USE Inspect this:", "    if (ready) {", "\t\trun();", "    }"].join(
      "\n",
    );
    const ControlledComposer = () => {
      const [draft, setDraft] = useState(input);
      const [selection, setSelection] = useState<ControlCommandSelection | null>({
        id: "CX_BROWSER_USE",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: false,
      });
      return (
        <ChatComposer
          {...baseProps}
          input={draft}
          onInput={setDraft}
          controlSelection={selection}
          onControlSelectionChange={setSelection}
        />
      );
    };
    render(<ControlledComposer />);

    fireEvent.click(screen.getByLabelText("Remove Codex Browser control"));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      ["Inspect this:", "    if (ready) {", "\t\trun();", "    }"].join("\n"),
    );
  });

  test("shows only the dedicated command menu when slash is typed", () => {
    render(<ChatComposer {...baseProps} input="/" />);

    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    expect(screen.queryByTestId("composer-typeahead")).toBeNull();
    expect(screen.getByText("/goal")).toBeTruthy();
  });

  test("turns /review into a configured header card without leaving command text", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("/");
      const [runtimeActions, setRuntimeActions] = useState<ChatRuntimeActionSelection[]>([]);
      return (
        <ChatComposer
          {...baseProps}
          input={input}
          onInput={setInput}
          runtimeActions={runtimeActions}
          onRuntimeActionsChange={setRuntimeActions}
          runtimeConfigurations={[
            {
              id: "codex-personal",
              name: "Codex Personal",
              command: "codex",
              driver: "codex-cli",
              builtIn: false,
              position: 0,
              supportsFastMode: true,
              models: [
                {
                  id: "codex-model",
                  providerId: "codex-personal",
                  description: "GPT 5.6",
                  model: "gpt-5.6",
                  thinkingLevels: ["high"],
                  builtIn: false,
                  position: 0,
                  isDefault: true,
                  defaultThinkingLevel: "high",
                },
              ],
            },
          ]}
        />
      );
    };
    render(<ControlledComposer />);

    fireEvent.click(screen.getByText("/review"));
    expect(screen.getByTestId("composer-runtime-action-picker")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Codex Personal/ }));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByTestId("composer-runtime-action-review").textContent).toContain(
      "Codex Personal will review",
    );
    expect(screen.getByTestId("composer-runtime-action-review").textContent).not.toContain("fast");

    fireEvent.click(screen.getByRole("button", { name: "Configure review action" }));
    expect(screen.getByLabelText("Quick Action model")).toBeTruthy();
    expect(screen.getByLabelText("Quick Action thinking")).toBeTruthy();
    expect((screen.getByLabelText("Quick Action fast mode") as HTMLInputElement).checked).toBe(
      false,
    );
    fireEvent.click(screen.getByLabelText("Quick Action fast mode"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm review action" }));
    expect(screen.getByTestId("composer-runtime-action-review").textContent).toContain("fast");
  });

  test("keeps the selected runtime configuration name on a Quick Action", () => {
    const configuration: RuntimeConfigurationProvider = {
      id: "codex-personal",
      name: "Codex Personal",
      command: "codex",
      driver: "codex-cli",
      builtIn: false,
      position: 0,
      supportsFastMode: true,
      models: [
        {
          id: "codex-model",
          providerId: "codex-personal",
          description: "GPT 5.6",
          model: "gpt-5.6",
          thinkingLevels: ["high"],
          builtIn: false,
          position: 0,
          isDefault: true,
          defaultThinkingLevel: "high",
        },
      ],
    };

    expect(createRuntimeAction("review", configuration)).toMatchObject({
      runtimeConfigurationId: "codex-personal",
      runtimeConfigurationName: "Codex Personal",
      provider: "codex-cli",
    });
  });

  test("turns a selected #workflow into the §6.4 rail and removes its token", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("please #aop fix this");
      const [selection, setSelection] = useState<ChatWorkflowSelection | null>(null);
      return (
        <ChatComposer
          {...baseProps}
          input={input}
          onInput={setInput}
          workflowSelection={selection}
          onWorkflowSelectionChange={setSelection}
          workflows={[
            {
              id: "workflow-1",
              name: "aop-default-gpt",
              stepCount: 4,
              stepTypes: ["implement", "review"],
              steps: [
                {
                  id: "implement",
                  type: "implement",
                  provider: "codex-cli",
                  model: "gpt-5.6",
                  reasoning: "high",
                  fastMode: true,
                },
                {
                  id: "review",
                  type: "review",
                  provider: "claude-code",
                  model: "opus-4.8",
                  reasoning: "max",
                },
              ],
            },
          ]}
        />
      );
    };
    render(<ControlledComposer />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.setSelectionRange(11, 11);
    fireEvent.select(textarea);
    fireEvent.click(screen.getByText("aop-default-gpt"));

    expect(textarea.value).toBe("please  fix this");
    const rail = screen.getByTestId("composer-workflow-selection");
    expect(rail.textContent).toContain("aop-default-gpt");
    // Step chips render inline (provider marks + model short labels).
    expect(rail.querySelectorAll('[data-testid="workflow-step-chip"]').length).toBe(2);
    expect(rail.textContent).toContain("gpt-5.6");
    // The Studio deep link is gone.
    expect(screen.queryByRole("link", { name: "Open in Workflow Studio" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove workflow aop-default-gpt" }));
    expect(screen.queryByTestId("composer-workflow-selection")).toBeNull();
  });

  test("renders a Legacy chip for selections without step detail", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("please #aop");
      const [selection, setSelection] = useState<ChatWorkflowSelection | null>({
        workflowId: "legacy-1",
        name: "Legacy flow",
        stepCount: 7,
      });
      return (
        <ChatComposer
          {...baseProps}
          input={input}
          onInput={setInput}
          workflowSelection={selection}
          onWorkflowSelectionChange={setSelection}
          workflows={[{ id: "legacy-1", name: "Legacy flow", stepCount: 7 }]}
        />
      );
    };
    render(<ControlledComposer />);

    const rail = screen.getByTestId("composer-workflow-selection");
    expect(rail.textContent).toContain("7 steps · Legacy");
    expect(screen.queryByTestId("composer-workflow-legacy")).toBeTruthy();
  });

  test("keeps the workflow token when replacing Quick Actions is cancelled", () => {
    const confirm = mock(() => false);
    window.confirm = confirm;
    const ControlledComposer = () => {
      const [input, setInput] = useState("please #aop");
      const [runtimeActions, setRuntimeActions] = useState<ChatRuntimeActionSelection[]>([
        {
          id: "review-1",
          intent: "review",
          runtimeConfigurationId: "codex-personal",
          provider: "codex-cli",
          model: "gpt-5.6",
          reasoning: "high",
          fastMode: false,
          phase: "post-work",
        },
      ]);
      return (
        <ChatComposer
          {...baseProps}
          input={input}
          onInput={setInput}
          runtimeActions={runtimeActions}
          onRuntimeActionsChange={setRuntimeActions}
          onWorkflowSelectionChange={() => {}}
          workflows={[
            {
              id: "workflow-1",
              name: "aop-default-gpt",
              stepCount: 2,
              stepTypes: ["implement", "review"],
            },
          ]}
        />
      );
    };
    render(<ControlledComposer />);

    fireEvent.click(screen.getByText("aop-default-gpt"));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("please #aop");
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("opens @ runtime typeahead and arms delegation on pick", () => {
    const onInput = mock((_value: string) => {});
    const onRuntimeDelegationChange = mock((_value: unknown) => {});
    render(
      <ChatComposer
        {...baseProps}
        input="please @co"
        onInput={onInput}
        onRuntimeDelegationChange={onRuntimeDelegationChange}
      />,
    );

    const menu = screen.getByTestId("composer-typeahead");
    expect(menu.className).toContain("rounded-[20px]");
    expect(menu.className).toContain("bg-popover/96");
    expect(menu.textContent).toContain("Runtimes");
    expect(menu.textContent).toContain("Codex");
    fireEvent.click(screen.getByText("Codex"));
    expect(onInput).toHaveBeenCalledWith("please Codex ");
    expect(onRuntimeDelegationChange).toHaveBeenCalledWith({
      id: "codex",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      tokenStart: 7,
      tokenEnd: 12,
    });
  });

  test("keeps a custom runtime configuration bound when picked with @", () => {
    const onInput = mock((_value: string) => {});
    const onRuntimeDelegationChange = mock((_value: unknown) => {});
    const ccPersonal: RuntimeConfigurationProvider = {
      id: "rtprov_cc_personal",
      name: "CC Personal",
      command: "cpe",
      driver: "claude-code",
      builtIn: false,
      position: 0,
      supportsFastMode: false,
      models: [
        {
          id: "rtmodel_cc_personal_fable",
          providerId: "rtprov_cc_personal",
          description: "Fable 5",
          model: "claude-fable-5",
          thinkingLevels: ["low", "medium", "high"],
          builtIn: false,
          position: 0,
          isDefault: true,
          defaultThinkingLevel: "low",
        },
      ],
    };
    render(
      <ChatComposer
        {...baseProps}
        input="please @cc"
        onInput={onInput}
        onRuntimeDelegationChange={onRuntimeDelegationChange}
        runtimeConfigurations={[ccPersonal]}
      />,
    );

    fireEvent.click(screen.getByText("CC Personal"));

    expect(onInput).toHaveBeenCalledWith("please CC Personal ");
    expect(onRuntimeDelegationChange).toHaveBeenCalledWith({
      id: "claude",
      model: "claude-fable-5",
      reasoning: "low",
      fastMode: false,
      runtimeConfigurationId: "rtprov_cc_personal",
      tokenStart: 7,
      tokenEnd: 18,
    });
  });

  test("Enter on an exact leading slash command sends instead of completing", () => {
    const onSend = mock(() => {});
    const onSlashPick = mock((_cmd: string) => {});
    render(
      <ChatComposer {...baseProps} input="/status" onSend={onSend} onSlashPick={onSlashPick} />,
    );

    const textarea = screen.getByRole("textbox");
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalled();
    expect(onSlashPick).not.toHaveBeenCalled();
  });

  test("keeps the slash menu dismissed until the input changes", () => {
    const { rerender } = render(<ChatComposer {...baseProps} input="/" />);
    const textarea = screen.getByRole("textbox");

    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();

    rerender(<ChatComposer {...baseProps} input="/g" />);
    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
  });

  test("clears a selected draft and closes its command menu", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("/goal review this");
      return <ChatComposer {...baseProps} input={input} onInput={setInput} />;
    };
    render(<ControlledComposer />);
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    textarea.focus();
    fireEvent.keyDown(textarea, { key: "a", metaKey: true });
    textarea.setSelectionRange(0, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "Backspace" });
    fireEvent.input(textarea, { target: { value: "" } });

    expect(textarea.value).toBe("");
    expect(screen.queryByTestId("slash-command-menu")).toBeNull();
    expect(screen.queryByTestId("composer-typeahead")).toBeNull();
  });

  test("renders and removes document filename pills", () => {
    const onRemoveDocument = mock((_id: string) => {});
    render(
      <ChatComposer
        {...baseProps}
        documents={[
          {
            id: "doc1",
            fileName: "login-form.md",
            mimeType: "text/markdown",
            dataBase64: "IyBQbGFu",
          },
        ]}
        onRemoveDocument={onRemoveDocument}
      />,
    );

    const documentCard = screen.getByTestId("chat-composer-document");
    expect(documentCard.textContent).toContain("login-form.md");
    expect(screen.getByTestId("chat-composer-attachments").contains(documentCard)).toBe(true);
    expect(screen.getByTestId("composer-toolbar-right")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove login-form.md" }));
    expect(onRemoveDocument).toHaveBeenCalledWith("doc1");
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  test("visually distinguishes document attachments from runtime configuration", () => {
    render(
      <ChatComposer
        {...baseProps}
        documents={[
          {
            id: "doc1",
            fileName: "browser-control.md",
            mimeType: "text/markdown",
            dataBase64: "IyBHdWlkZQ==",
          },
        ]}
      />,
    );

    const modelButton = screen.getByTestId("composer-runtime-config");
    const documentCard = screen.getByTestId("chat-composer-document");
    expect(documentCard.className).toContain("border-border");
    expect(documentCard.className).toContain("font-mono");
    expect(modelButton.className).toContain("border-transparent");
    expect(documentCard.className).not.toContain("border-transparent");
  });

  test("shows a queue action beside Stop while a draft is active", () => {
    const onSend = mock(() => {});
    render(
      <ChatComposer
        {...baseProps}
        input="follow up"
        assistantActive
        onAbort={() => undefined}
        onSend={onSend}
      />,
    );

    expect(screen.getByRole("button", { name: "Stop conversation" })).toBeTruthy();
    const queue = screen.getByRole("button", { name: "Queue message" });
    expect(queue.textContent).toContain("Queue");
    fireEvent.click(queue);
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test("shows queued-count helper text with singular and plural labels", () => {
    const { rerender } = render(<ChatComposer {...baseProps} queueCount={1} />);
    expect(screen.getByTestId("queued-message-helper").textContent).toBe(
      "1 queued message will send automatically.",
    );

    rerender(<ChatComposer {...baseProps} queueCount={2} />);
    expect(screen.getByTestId("queued-message-helper").textContent).toBe(
      "2 queued messages will send automatically.",
    );
  });

  test("grows the textarea upward with its content before using an internal scrollbar", () => {
    render(<ChatComposer {...baseProps} input="A long draft" />);
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    Object.defineProperty(input, "scrollHeight", { configurable: true, value: 432 });

    fireEvent.change(input, { target: { value: "A much longer draft" } });

    expect(input.style.height).toBe("432px");
    expect(input.style.overflowY).toBe("hidden");
    expect(input.style.overflowX).toBe("hidden");
  });

  test("does not reset textarea selection when unrelated props rerender the composer", () => {
    const { rerender } = render(<ChatComposer {...baseProps} input="typing with accents" />);
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    const setSelectionRange = mock(input.setSelectionRange.bind(input));
    input.setSelectionRange = setSelectionRange;

    rerender(<ChatComposer {...baseProps} input="typing with accents" assistantActive />);

    expect(setSelectionRange).not.toHaveBeenCalled();
  });

  test("does not restore selection when resizing leaves the caret in place", () => {
    render(<ChatComposer {...baseProps} input="draft" />);
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    input.setSelectionRange(3, 3);
    const setSelectionRange = mock(input.setSelectionRange.bind(input));
    input.setSelectionRange = setSelectionRange;

    resizeComposerInput(input);

    expect(setSelectionRange).not.toHaveBeenCalled();
  });

  test("defers textarea resizing until text composition ends", () => {
    const ControlledComposer = () => {
      const [input, setInput] = useState("caf");
      return <ChatComposer {...baseProps} input={input} onInput={setInput} />;
    };
    render(<ControlledComposer />);
    const input = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    let scrollHeightReads = 0;
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => {
        scrollHeightReads += 1;
        return 42;
      },
    });

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "café", selectionStart: 4 } });
    expect(scrollHeightReads).toBe(0);

    fireEvent.compositionEnd(input);
    expect(scrollHeightReads).toBe(1);
  });

  test("keeps the caret layer and highlight layer on the shared text surface", () => {
    render(<ChatComposer {...baseProps} input="hello caret" />);
    const input = screen.getByTestId("chat-composer-input");
    const highlight = screen.getByTestId("composer-highlight-layer");

    expect(input.className).toContain("composer-input");
    expect(input.className).toContain("composer-text-surface");
    expect(highlight.className).toContain("composer-highlight-layer");
    expect(highlight.className).toContain("composer-text-surface");
    expect(input.parentElement?.className).toContain("composer-input-stack");
    expect(highlight.textContent).toBe("hello caret");
  });

  test("captures the typed caret before controlled input updates can move it", () => {
    let inputElement: HTMLTextAreaElement | null = null;
    const onInput = mock((value: string) => {
      rerender(
        <ChatComposer
          {...baseProps}
          input={value}
          onInput={onInput}
          workers={[{ id: "w1", name: "Ada" }]}
        />,
      );
      inputElement?.setSelectionRange(0, 0);
    });
    const { rerender } = render(
      <ChatComposer {...baseProps} onInput={onInput} workers={[{ id: "w1", name: "Ada" }]} />,
    );
    inputElement = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    inputElement.setSelectionRange(2, 2);

    fireEvent.change(inputElement, { target: { value: "@a", selectionStart: 2 } });

    expect(screen.getByTestId("composer-typeahead")).toBeTruthy();
  });

  test("sends pasted image-only messages and disables the primary action offline", () => {
    const onPasteImages = mock(() => {});
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        images={[
          {
            id: "img1",
            mimeType: "image/png",
            dataBase64: "abc",
            previewUrl: "blob:preview-1",
          },
        ]}
        onPasteImages={onPasteImages}
      />,
    );
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      false,
    );
    const item = {
      type: "image/png",
      getAsFile: () => new File(["image"], "clip.png", { type: "image/png" }),
    } as DataTransferItem;
    fireEvent.paste(screen.getByTestId("chat-composer-input"), {
      clipboardData: { items: [item] },
    });
    expect(onPasteImages).toHaveBeenCalled();
    rerender(<ChatComposer {...baseProps} connected={false} />);
    expect(
      screen.getByRole("button", { name: "Environment disconnected" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  test("collapses large text pastes into [paste #N +lines] tokens", () => {
    let draft = "prefix ";
    let pastes: Array<{ id: string; index: number; lineCount: number; content: string }> = [];
    const onInput = mock((value: string) => {
      draft = value;
    });
    const onPastesChange = mock(
      (next: Array<{ id: string; index: number; lineCount: number; content: string }>) => {
        pastes = next;
      },
    );
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        input={draft}
        onInput={onInput}
        pastes={pastes}
        onPastesChange={onPastesChange}
      />,
    );
    const bigPaste = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join("\n");
    fireEvent.paste(screen.getByTestId("chat-composer-input"), {
      clipboardData: {
        items: [],
        getData: (type: string) => (type === "text/plain" ? bigPaste : ""),
      },
    });
    expect(onPastesChange).toHaveBeenCalledTimes(1);
    expect(onInput).toHaveBeenCalled();
    const nextInput = onInput.mock.calls.at(-1)?.[0] as string;
    expect(nextInput).toContain("[paste #1 +8 lines]");
    expect(nextInput).not.toContain("line 2");
    pastes = onPastesChange.mock.calls[0]?.[0] as typeof pastes;
    draft = nextInput;
    rerender(
      <ChatComposer
        {...baseProps}
        input={draft}
        onInput={onInput}
        pastes={pastes}
        onPastesChange={onPastesChange}
      />,
    );
    expect(screen.getByTestId("composer-highlight-layer").textContent).toContain(
      "[paste #1 +8 lines]",
    );
  });

  test("shows $ control typeahead with descriptions instead of technical ids", () => {
    let draft = "";
    const handleInput = (value: string) => {
      draft = value;
      rerender(<ChatComposer {...baseProps} input={draft} onInput={handleInput} />);
    };
    const { rerender } = render(<ChatComposer {...baseProps} input="" onInput={handleInput} />);

    fireEvent.change(screen.getByTestId("chat-composer-input"), {
      target: { value: "$", selectionStart: 1 },
    });

    const menu = screen.getByTestId("composer-typeahead");
    expect(menu).toBeTruthy();
    expect(screen.getByRole("option", { name: /Claude Browser/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Codex Computer/i })).toBeTruthy();
    expect(menu.textContent).not.toContain("CC_BROWSER_USE");
    expect(menu.textContent).not.toContain("CX_COMPUTER_USE");
    expect(menu.textContent).toContain("Controls");
    expect(menu.textContent).toContain("browser control");
  });

  test("shows typeahead popover for %worker tokens and applies pick into onInput", () => {
    const onInput = mock((_value: string) => {});
    const onDefaultWorkerChange = mock((_id: string | null) => {});
    let draft = "";
    const handleInput = (value: string) => {
      draft = value;
      onInput(value);
      rerender(
        <ChatComposer
          {...baseProps}
          input={draft}
          onInput={handleInput}
          workers={[{ id: "w1", name: "Ada" }]}
          onDefaultWorkerChange={onDefaultWorkerChange}
        />,
      );
    };

    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        input=""
        onInput={handleInput}
        workers={[{ id: "w1", name: "Ada" }]}
        onDefaultWorkerChange={onDefaultWorkerChange}
      />,
    );

    const input = screen.getByTestId("chat-composer-input");
    fireEvent.change(input, { target: { value: "%a" } });

    expect(screen.getByTestId("composer-typeahead")).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Ada/ }));
    expect(onInput).toHaveBeenCalled();
    expect(onDefaultWorkerChange).not.toHaveBeenCalled();
    expect(
      draft.includes("Ada") || onInput.mock.calls.some((call) => String(call[0]).includes("Ada")),
    ).toBe(true);
  });

  test("armed workflow chip: sibling clear button, no nested interactive elements", () => {
    const onDefaultWorkflowChange = mock((_id: string | null) => {});
    const { rerender } = render(
      <ChatComposer
        {...baseProps}
        sessionId="s1"
        workflows={["wf-1"]}
        defaultWorkflowId="wf-1"
        onDefaultWorkflowChange={onDefaultWorkflowChange}
      />,
    );

    const chip = screen.getByTestId("composer-workflow-chip");
    // F2: the armed chip must not nest <button> inside <button>.
    expect(chip.querySelector("button button")).toBeNull();
    expect(chip.querySelectorAll("button").length).toBe(2);
    expect(screen.getByLabelText("Workflow").textContent).toContain("wf-1");

    fireEvent.click(screen.getByLabelText("Clear workflow"));
    expect(onDefaultWorkflowChange).toHaveBeenCalledWith(null);

    // A cleared selection drops the × control once the parent re-renders.
    rerender(
      <ChatComposer
        {...baseProps}
        sessionId="s1"
        workflows={["wf-1"]}
        defaultWorkflowId={null}
        onDefaultWorkflowChange={onDefaultWorkflowChange}
      />,
    );
    expect(screen.queryByTestId("composer-workflow-clear")).toBeNull();
    expect(screen.getByTestId("composer-workflow-chip").querySelectorAll("button").length).toBe(1);
  });
});
