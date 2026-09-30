import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeConfigurationProvider } from "@aop/common";
import { setupDashboardDom } from "../../test/setup-dom";

setupDashboardDom();

const { cleanup, fireEvent, render, screen } = await import("@testing-library/react");
const { useState } = await import("react");
const { ChatComposer } = await import("./ChatComposer");
const { resizeComposerInput } = await import("./composer-shell");

afterEach(() => {
  cleanup();
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
  onRuntimeMenu: mock(() => {}),
  onModelMenu: mock(() => {}),
  onEffortMenu: mock(() => {}),
  onMoreMenu: mock(() => {}),
  onSlashPick: mock((_cmd: string) => {}),
};

const repos = [
  { id: "r1", name: "aop-mono", path: "/tmp/aop-mono" },
  { id: "r2", name: "docs", path: "/tmp/docs" },
];

describe("ChatComposer context chips and typeahead", () => {
  test("composer column uses shared chat-column width (aligned with thread)", () => {
    render(<ChatComposer {...baseProps} />);

    const column = screen.getByTestId("chat-composer-column");
    expect(column.className).toContain("chat-column");
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
    expect(screen.getByTestId("composer-toolbar").className.split(/\s+/)).toContain("gap-3");
    expect(screen.getByTestId("composer-toolbar").className.split(/\s+/)).not.toContain("sm:gap-0");
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
      />,
    );

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

  test("shows only the dedicated command menu when slash is typed", () => {
    render(<ChatComposer {...baseProps} input="/" />);

    expect(screen.getByTestId("slash-command-menu")).toBeTruthy();
    expect(screen.queryByTestId("composer-typeahead")).toBeNull();
    expect(screen.getByText("/goal")).toBeTruthy();
  });

  test("Enter on an exact leading slash command sends instead of completing", () => {
    const onSend = mock(() => {});
    const onSlashPick = mock((_cmd: string) => {});
    render(<ChatComposer {...baseProps} input="/goal" onSend={onSend} onSlashPick={onSlashPick} />);

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
      rerender(<ChatComposer {...baseProps} input={value} onInput={onInput} repos={repos} />);
      inputElement?.setSelectionRange(0, 0);
    });
    const { rerender } = render(<ChatComposer {...baseProps} onInput={onInput} repos={repos} />);
    inputElement = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    inputElement.setSelectionRange(2, 2);

    fireEvent.change(inputElement, { target: { value: "~a", selectionStart: 2 } });

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

  test("the draft placeholder advertises only the surviving ~ and / triggers", () => {
    render(<ChatComposer {...baseProps} />);

    const textarea = screen.getByTestId("chat-composer-input") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe("Ask anything, ~ to mention a repository, or / for commands");
    expect(textarea.readOnly).toBe(false);
  });

  test("picking a slash command writes it into the draft", () => {
    const onInput = mock((_value: string) => {});
    const onSlashPick = mock((_cmd: string) => {});
    render(<ChatComposer {...baseProps} input="/" onInput={onInput} onSlashPick={onSlashPick} />);

    expect(screen.queryByText("/review")).toBeNull();
    expect(screen.queryByText("/workflow")).toBeNull();
    fireEvent.click(screen.getByText("/skill"));

    expect(onInput).toHaveBeenLastCalledWith("/skill ");
    expect(onSlashPick).toHaveBeenLastCalledWith("/skill ");
    expect(screen.queryByTestId("composer-runtime-action-picker")).toBeNull();
  });

  test("opens the ~ repository typeahead and applies the picked repo into onInput", () => {
    const onInput = mock((_value: string) => {});
    let draft = "";
    const handleInput = (value: string) => {
      draft = value;
      onInput(value);
      rerender(<ChatComposer {...baseProps} input={draft} onInput={handleInput} repos={repos} />);
    };
    const { rerender } = render(
      <ChatComposer {...baseProps} input="" onInput={handleInput} repos={repos} />,
    );

    fireEvent.change(screen.getByTestId("chat-composer-input"), {
      target: { value: "look at ~a", selectionStart: 10 },
    });

    const menu = screen.getByTestId("composer-typeahead");
    expect(menu.className).toContain("rounded-[20px]");
    expect(menu.className).toContain("bg-popover/96");
    expect(menu.textContent).toContain("Repositories");
    expect(screen.queryByRole("option", { name: /docs/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /aop-mono/ }));

    expect(onInput).toHaveBeenLastCalledWith("look at ~aop-mono ");
    expect(screen.queryByTestId("composer-typeahead")).toBeNull();
  });

  test("arrow keys and Enter pick a repository; Escape dismisses until the token changes", () => {
    const onInput = mock((_value: string) => {});
    const onSend = mock(() => {});
    const { rerender } = render(
      <ChatComposer {...baseProps} input="~" onInput={onInput} onSend={onSend} repos={repos} />,
    );
    const textarea = screen.getByTestId("chat-composer-input");

    // An untouched suggestion is never applied by Enter: the message sends.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onInput).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onInput).toHaveBeenLastCalledWith("~docs ");
    expect(onSend).toHaveBeenCalledTimes(1);

    rerender(<ChatComposer {...baseProps} input="~d" onInput={onInput} repos={repos} />);
    expect(screen.getByTestId("composer-typeahead")).toBeTruthy();
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByTestId("composer-typeahead")).toBeNull();
  });

  test("the retired % # $ @ sigils no longer open a typeahead", () => {
    const { rerender } = render(<ChatComposer {...baseProps} input="" repos={repos} />);

    for (const draft of ["%a", "#a", "$", "@c"]) {
      rerender(<ChatComposer {...baseProps} input={draft} repos={repos} />);
      expect(screen.queryByTestId("composer-typeahead")).toBeNull();
    }
  });

  test("highlights a known ~repo mention in the draft without changing its text", () => {
    render(<ChatComposer {...baseProps} input="look at ~aop-mono now" repos={repos} />);

    const layer = screen.getByTestId("composer-highlight-layer");
    expect(layer.textContent).toBe("look at ~aop-mono now");
    const mark = layer.querySelector("[data-kind=repo]");
    expect(mark?.textContent).toBe("~aop-mono");
  });

  test("renders the merged-PR bar inside the composer canvas above the input", () => {
    render(
      <ChatComposer {...baseProps} mergedPrBar={<div data-testid="merged-pr-bar">Merged</div>} />,
    );

    const bar = screen.getByTestId("merged-pr-bar");
    const canvas = screen.getByTestId("composer-canvas");
    expect(canvas.contains(bar)).toBe(true);
    const input = screen.getByTestId("chat-composer-input");
    expect(bar.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("queued review comments alone enable sending", () => {
    const comment = {
      id: "c1",
      path: "src/a.ts",
      lineType: "add" as const,
      oldNo: null,
      newNo: 3,
      excerpt: "line 3",
      note: "rename this",
      createdAt: 1,
    };
    const { rerender } = render(<ChatComposer {...baseProps} />);
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      true,
    );

    rerender(
      <ChatComposer
        {...baseProps}
        reviewComments={[comment]}
        onUpdateReviewComment={() => {}}
        onRemoveReviewComment={() => {}}
      />,
    );
    expect(screen.getByTestId("review-queue")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      false,
    );
  });
});
