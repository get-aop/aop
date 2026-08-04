import { afterEach, describe, expect, mock, test } from "bun:test";
import type { RuntimeConfigurationProvider } from "@aop/common";
import { setupDashboardDom } from "../test/setup-dom";

setupDashboardDom();

const mockGetRuntimeConfiguration = mock();
const actualClientModule = await import("../api/client");
mock.module("../api/client", () => ({
  ...actualClientModule,
  getRuntimeConfiguration: mockGetRuntimeConfiguration,
}));

const { render, screen, cleanup, waitFor } = await import("@testing-library/react");
const { SettingsRuntimes } = await import("./settings-runtimes.tsx");

afterEach(() => {
  cleanup();
  mockGetRuntimeConfiguration.mockReset();
});

const builtInClaudeCode: RuntimeConfigurationProvider = {
  id: "claude-code",
  name: "claude-code",
  command: "claude",
  driver: "claude-code",
  builtIn: true,
  position: 0,
  supportsFastMode: false,
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

const customRuntime: RuntimeConfigurationProvider = {
  id: "rtprov_custom_1",
  name: "my-claude",
  command: "my-claude-bin",
  driver: "custom",
  builtIn: false,
  position: 1,
  supportsFastMode: false,
  models: [
    {
      id: "rtmodel_custom_1",
      providerId: "rtprov_custom_1",
      description: "My model",
      model: "my-model",
      thinkingLevels: ["low", "medium", "high"],
      builtIn: false,
      position: 0,
      isDefault: true,
      defaultThinkingLevel: "medium",
    },
  ],
};

describe("SettingsRuntimes", () => {
  test("lists only custom runtimes, hiding the built-in catalog", async () => {
    mockGetRuntimeConfiguration.mockResolvedValue([builtInClaudeCode, customRuntime]);

    render(<SettingsRuntimes />);

    await waitFor(() => expect(screen.getByTestId("runtime-row")).toBeTruthy());
    expect(screen.getByText("my-claude")).toBeTruthy();
    expect(screen.queryByText("claude-code")).toBeNull();
  });

  test("shows the empty state when only built-in runtimes exist", async () => {
    mockGetRuntimeConfiguration.mockResolvedValue([builtInClaudeCode]);

    render(<SettingsRuntimes />);

    await waitFor(() => expect(screen.getByText("No custom runtimes")).toBeTruthy());
    expect(screen.queryByTestId("runtime-row")).toBeNull();
  });
});
