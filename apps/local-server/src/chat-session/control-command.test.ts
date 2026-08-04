import { describe, expect, test } from "bun:test";
import {
  CONTROL_COMMANDS,
  controlCommandLabel,
  defaultControlSelection,
  formatControlCommandMarker,
  parseControlCommand,
  rewriteControlCommandMarker,
} from "@aop/common";

describe("controlCommandLabel", () => {
  test("returns provider + capability descriptions without technical ids", () => {
    expect(CONTROL_COMMANDS.map(controlCommandLabel)).toEqual([
      "Claude Browser",
      "Codex Browser",
      "Claude Computer",
      "Codex Computer",
    ]);
  });
});

describe("parseControlCommand", () => {
  test("parses a Claude browser command and removes its marker", () => {
    expect(parseControlCommand("$CC_BROWSER_USE Sign in and inspect the billing page")).toEqual({
      command: { provider: "claude-code", capability: "browser" },
      prompt: "Sign in and inspect the billing page",
    });
  });

  test("parses model and thinking payload from the control marker", () => {
    expect(parseControlCommand("$CX_BROWSER_USE[gpt-5.5;high] inspect the page")).toMatchObject({
      command: {
        provider: "codex-cli",
        capability: "browser",
        model: "gpt-5.5",
        reasoning: "high",
      },
      prompt: "inspect the page",
    });
  });

  test("parses fast mode from the optional third payload field", () => {
    expect(
      parseControlCommand("$CX_COMPUTER_USE[gpt-5.5;medium;fast] open Settings"),
    ).toMatchObject({
      command: {
        provider: "codex-cli",
        capability: "computer",
        model: "gpt-5.5",
        reasoning: "medium",
        fastMode: true,
      },
    });
  });

  test("parses a Codex computer command placed after the request", () => {
    expect(parseControlCommand("Open System Settings $CX_COMPUTER_USE")).toEqual({
      command: { provider: "codex-cli", capability: "computer" },
      prompt: "Open System Settings",
    });
  });

  test.each([
    ["$CX_BROWSER_USE inspect the page", "codex-cli", "browser"],
    ["$CC_COMPUTER_USE open System Settings", "claude-code", "computer"],
  ])("parses %s", (prompt, provider, capability) => {
    expect(parseControlCommand(prompt)).toMatchObject({
      command: { provider, capability },
    });
  });

  test("rejects competing control commands", () => {
    expect(parseControlCommand("$CC_BROWSER_USE $CX_BROWSER_USE Compare both results")).toEqual({
      error: "Use one computer or browser control command per message.",
    });
  });

  test("leaves ordinary browser wording as a normal runtime prompt", () => {
    expect(parseControlCommand("Please use the browser to investigate this")).toBeNull();
  });
});

describe("control command selection helpers", () => {
  test("formats and rewrites markers with model and thinking", () => {
    const selection = {
      id: "CX_BROWSER_USE" as const,
      model: "gpt-5.5",
      reasoning: "high" as const,
      fastMode: false,
    };
    expect(formatControlCommandMarker(selection)).toBe("$CX_BROWSER_USE[gpt-5.5;high]");
    expect(rewriteControlCommandMarker("check billing $CX_BROWSER_USE", selection)).toBe(
      "check billing $CX_BROWSER_USE[gpt-5.5;high]",
    );
  });

  test("default selection picks a valid model for the control provider", () => {
    const selection = defaultControlSelection("CC_BROWSER_USE");
    expect(selection?.id).toBe("CC_BROWSER_USE");
    expect(selection?.model).toBeTruthy();
    expect(selection?.reasoning).toBeTruthy();
    expect(selection?.fastMode).toBe(false);
  });

  test("default selection uses runtime configuration defaults when provided", () => {
    const configs = [
      {
        id: "rtprov_claude_code",
        name: "Claude Code",
        command: "claude",
        driver: "claude-code" as const,
        builtIn: true,
        position: 0,
        supportsFastMode: false,
        models: [
          {
            id: "m0",
            providerId: "rtprov_claude_code",
            description: "Sonnet",
            model: "claude-sonnet-4-6",
            thinkingLevels: ["low", "medium"] as Array<"low" | "medium">,
            builtIn: true,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "medium" as const,
          },
        ],
      },
      {
        id: "rtprov_claude_personal",
        name: "Claude Code personal",
        command: "claude-personal",
        driver: "claude-code" as const,
        builtIn: false,
        position: 1,
        supportsFastMode: true,
        models: [
          {
            id: "m1",
            providerId: "rtprov_claude_personal",
            description: "Opus",
            model: "claude-opus-4-8",
            thinkingLevels: ["low", "high", "max"] as Array<"low" | "high" | "max">,
            builtIn: false,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "high" as const,
          },
        ],
      },
    ];
    expect(defaultControlSelection("CC_BROWSER_USE", configs)).toEqual({
      id: "CC_BROWSER_USE",
      model: "claude-sonnet-4-6",
      reasoning: "medium",
      fastMode: false,
      runtimeConfigurationId: "rtprov_claude_code",
    });
    // Session bound to personal profile is preferred when drivers match.
    expect(defaultControlSelection("CC_BROWSER_USE", configs, "rtprov_claude_personal")).toEqual({
      id: "CC_BROWSER_USE",
      model: "claude-opus-4-8",
      reasoning: "high",
      fastMode: false,
      runtimeConfigurationId: "rtprov_claude_personal",
    });
    // Preferring a codex session config must not leak into Claude control.
    expect(
      defaultControlSelection("CC_BROWSER_USE", configs, "rtprov_work_codex")
        ?.runtimeConfigurationId,
    ).toBe("rtprov_claude_code");
  });

  test("round-trips runtime configuration id on control markers", () => {
    const marker = formatControlCommandMarker({
      id: "CX_BROWSER_USE",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_work_codex",
    });
    expect(marker).toBe("$CX_BROWSER_USE[gpt-5.5;high;fast;cfg:rtprov_work_codex]");
    expect(parseControlCommand(`inspect ${marker}`)).toMatchObject({
      command: {
        provider: "codex-cli",
        capability: "browser",
        model: "gpt-5.5",
        reasoning: "high",
        fastMode: true,
        runtimeConfigurationId: "rtprov_work_codex",
      },
      prompt: "inspect",
    });
  });
});
