import { describe, expect, test } from "bun:test";
import type { RuntimeConfigurationProvider } from "@aop/common";
import { isRunnableRuntimeConfiguration } from "./runtime-configuration-selection";

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

describe("isRunnableRuntimeConfiguration", () => {
  test("accepts a configuration with at least one model", () => {
    expect(isRunnableRuntimeConfiguration(claudePersonal)).toBe(true);
  });

  test("rejects a configuration with no models", () => {
    expect(isRunnableRuntimeConfiguration({ ...claudePersonal, models: [] })).toBe(false);
  });
});
