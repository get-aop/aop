import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeConfigurationProvider } from "@aop/common";
import type { WorkflowSummary } from "../api/client";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetRuntimeConfiguration = mock();
const mockGetWorkflowDetails = mock();
const mockSaveWorkflow = mock();
const actualClientModule = await import("../api/client");
mock.module("../api/client", () => ({
  ...actualClientModule,
  getRuntimeConfiguration: mockGetRuntimeConfiguration,
  getWorkflowDetails: mockGetWorkflowDetails,
  saveWorkflow: mockSaveWorkflow,
  deleteWorkflow: mock(async () => undefined),
}));

const { cleanup, fireEvent, render, screen, waitFor, within } = await import(
  "@testing-library/react"
);
const { RuntimeConfigurationProvider: RuntimeConfigProvider } = await import(
  "../hooks/runtime-configuration"
);
const { SectionWorkflows } = await import("./section-workflows");
const { compileSimpleWorkflow } = await import("./simple-workflow");

afterEach(() => {
  cleanup();
  mockGetRuntimeConfiguration.mockReset();
  mockGetWorkflowDetails.mockReset();
  mockSaveWorkflow.mockReset();
});

/** Built-in Claude runtime. */
const builtInClaudeCode: RuntimeConfigurationProvider = {
  id: "claude-code",
  name: "Claude code",
  command: "claude",
  driver: "claude-code",
  builtIn: true,
  position: 0,
  supportsFastMode: true,
  models: [
    {
      id: "builtin_claude-code_opus-4-8",
      providerId: "claude-code",
      description: "Claude Opus 4.8",
      model: "opus-4.8",
      thinkingLevels: ["low", "medium", "high", "extra-high", "max"],
      builtIn: true,
      position: 0,
      isDefault: true,
      defaultThinkingLevel: "medium",
    },
  ],
};

/** Custom runtime sharing the claude-code driver: the CC Persona alias. */
const ccPersona: RuntimeConfigurationProvider = {
  id: "rtprov_cc_persona",
  name: "CC Persona",
  command: "cc-persona",
  driver: "claude-code",
  builtIn: false,
  position: 1,
  supportsFastMode: true,
  models: [
    {
      id: "rtmodel_cc_persona",
      providerId: "rtprov_cc_persona",
      description: "Persona Sonnet",
      model: "sonnet-persona",
      thinkingLevels: ["low", "medium", "high"],
      builtIn: false,
      position: 0,
      isDefault: true,
      defaultThinkingLevel: "high",
    },
  ],
};

const asSummarySteps = (
  compiled: import("../api/client").WorkflowStepSaveInput[],
): WorkflowSummary["steps"] =>
  compiled.map((step) => ({
    id: step.id!,
    type: step.skillId,
    promptTemplate:
      {
        implement: "implement.md.hbs",
        code_review: "code-review-step.md.hbs",
        "run-tests": "run-tests.md.hbs",
        browser_control: "browser-control.md.hbs",
        "debug-failures": "debug-systematic.md.hbs",
        "fix-issues": "fix-issues.md.hbs",
      }[step.skillId] ?? "unknown.md.hbs",
    maxAttempts: 1,
    transitions: step.transitions ?? [],
    agent: step.agent,
  }));

const implementSummary = (): WorkflowSummary => {
  const compiled = compileSimpleWorkflow({
    name: "Ship it",
    steps: [
      {
        kind: "implement",
        agent: { provider: "claude-code", model: "opus-4.8", reasoning: "medium" },
      },
    ],
  });
  return {
    id: "wf-1",
    name: "Ship it",
    version: 1,
    active: true,
    source: "user",
    stepCount: compiled.length,
    steps: asSummarySteps(compiled),
  };
};

const renderSection = async (workflows: WorkflowSummary[]) => {
  mockGetWorkflowDetails.mockResolvedValue(workflows);
  mockGetRuntimeConfiguration.mockResolvedValue([builtInClaudeCode, ccPersona]);
  render(
    <RuntimeConfigProvider>
      <SectionWorkflows />
    </RuntimeConfigProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("workflow-row")).toBeTruthy());
};

const openEditor = async () => {
  const trigger = screen.getByTestId("workflow-row-menu");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit" }));
  return screen.findByTestId("workflow-editor");
};

const openProviderDropdown = async (editor: HTMLElement) => {
  const trigger = within(editor).getAllByRole("combobox")[0]!;
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  return screen.findAllByRole("option");
};

describe("SectionWorkflows editor provider select", () => {
  test("checks only the active runtime when two share the same driver", async () => {
    await renderSection([implementSummary()]);
    const editor = await openEditor();

    const options = await openProviderDropdown(editor);
    const labels = options.map((option) => option.textContent);
    expect(labels).toContain("Claude code");
    expect(labels).toContain("CC Persona");
    expect(
      options.filter((option) => option.getAttribute("data-state") === "checked"),
    ).toHaveLength(1);
  });

  test("switching to the persona runtime applies its configuration id, default model and thinking", async () => {
    await renderSection([implementSummary()]);
    const editor = await openEditor();

    fireEvent.click(
      (await openProviderDropdown(editor)).find((option) =>
        option.textContent?.includes("CC Persona"),
      )!,
    );
    const modelTrigger = within(editor).getAllByRole("combobox")[1]!;
    expect(modelTrigger.textContent).toContain("Persona Sonnet");

    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveWorkflow).toHaveBeenCalled());
    const saved = mockSaveWorkflow.mock.calls[0]?.[0] as { steps: Array<{ agent: unknown }> };
    expect(saved.steps[0]?.agent).toMatchObject({
      provider: "claude-code",
      runtimeConfigurationId: "rtprov_cc_persona",
      model: "sonnet-persona",
      reasoning: "high",
    });
  });

  test("switching back to the built-in runtime clears the persona configuration id", async () => {
    await renderSection([implementSummary()]);
    const editor = await openEditor();

    fireEvent.click(
      (await openProviderDropdown(editor)).find((option) =>
        option.textContent?.includes("CC Persona"),
      )!,
    );
    fireEvent.click(
      (await openProviderDropdown(editor)).find((option) =>
        option.textContent?.includes("Claude code"),
      )!,
    );

    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mockSaveWorkflow).toHaveBeenCalled());
    const saved = mockSaveWorkflow.mock.calls[0]?.[0] as { steps: Array<{ agent: unknown }> };
    expect(saved.steps[0]?.agent).toMatchObject({
      provider: "claude-code",
      runtimeConfigurationId: "claude-code",
      model: "opus-4.8",
    });
  });
});
