import { describe, expect, test } from "bun:test";
import type { RuntimeConfigurationProvider, StepAgent } from "@aop/common";
import {
  applyRuntimeConfiguration,
  selectedRuntimeConfiguration,
} from "./runtime-configuration-selection";

const claudePersonal: RuntimeConfigurationProvider = {
  id: "rtprov_claude_personal",
  name: "Claude Code personal",
  command: "claude-personal",
  driver: "claude-code",
  builtIn: false,
  position: 0,
  supportsFastMode: false,
  models: [
    {
      id: "rtmodel_claude_personal_opus",
      providerId: "rtprov_claude_personal",
      description: "Opus 4.8",
      model: "claude-opus-4-8",
      thinkingLevels: ["low", "medium", "high", "max"],
      builtIn: false,
      position: 0,
      isDefault: false,
      defaultThinkingLevel: null,
    },
    {
      id: "rtmodel_claude_personal_sonnet",
      providerId: "rtprov_claude_personal",
      description: "Sonnet 4.8",
      model: "claude-sonnet-4-8",
      thinkingLevels: ["medium", "high"],
      builtIn: false,
      position: 1,
      isDefault: true,
      defaultThinkingLevel: "high",
    },
  ],
};

describe("runtime configuration selection", () => {
  test("maps a saved Claude Code configuration to its runtime execution settings", () => {
    const agent: StepAgent = {
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "extra-high",
      fastMode: true,
    };

    expect(applyRuntimeConfiguration(agent, claudePersonal)).toEqual({
      provider: "claude-code",
      runtimeConfigurationId: "rtprov_claude_personal",
      runtimeAlias: "claude-personal",
      model: "claude-sonnet-4-8",
      reasoning: "high",
      fastMode: false,
      ultracode: false,
    });
  });

  test("uses a built-in configuration as the fallback for older workflow agents", () => {
    expect(
      selectedRuntimeConfiguration(
        { provider: "claude-code", model: "claude-opus-4-8", reasoning: "medium" },
        [{ ...claudePersonal, id: "claude-code", name: "Claude Code" }],
      )?.name,
    ).toBe("Claude Code");
  });

  test("does not replace a missing explicit configuration with a built-in provider", () => {
    expect(
      selectedRuntimeConfiguration(
        {
          provider: "claude-code",
          runtimeConfigurationId: "rtprov_deleted",
          model: "claude-opus-4-8",
          reasoning: "medium",
        },
        [{ ...claudePersonal, id: "claude-code", name: "Claude Code" }],
      ),
    ).toBeUndefined();
  });
});
