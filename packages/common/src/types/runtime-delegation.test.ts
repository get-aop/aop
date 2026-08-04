import { describe, expect, test } from "bun:test";
import type { RuntimeConfigurationProvider } from "./runtime-configuration.ts";
import {
  defaultDelegationSelectionFromConfiguration,
  formatRuntimeDelegationMarker,
  parseRuntimeDelegation,
} from "./runtime-delegation.ts";

describe("parseRuntimeDelegation", () => {
  test("preserves prompt indentation when removing the delegation marker", () => {
    const prompt = [
      "Fix this:",
      "    if (ready) {",
      "\t\trun();",
      "    } $DELEGATE_CODEX[gpt-5.5;high]",
    ].join("\n");

    expect(parseRuntimeDelegation(prompt)).toMatchObject({
      prompt: ["Fix this:", "    if (ready) {", "\t\trun();", "    }"].join("\n"),
    });
  });

  test("parses every canonical runtime marker case-insensitively", () => {
    expect(parseRuntimeDelegation("Investigate this $delegate_claude")).toMatchObject({
      runtime: "claude-code",
      prompt: "Investigate this",
    });
    expect(parseRuntimeDelegation("$DELEGATE_OPENCODE investigate")).toMatchObject({
      runtime: "opencode",
    });
    expect(parseRuntimeDelegation("$DELEGATE_GROK investigate")).toMatchObject({
      runtime: "grok-build",
    });
    expect(parseRuntimeDelegation("$DELEGATE_CODEX investigate")).toMatchObject({
      runtime: "codex-cli",
    });
    expect(parseRuntimeDelegation("$DELEGATE_PI investigate")).toMatchObject({ runtime: "pi" });
    expect(parseRuntimeDelegation("$DELEGATE_OMP investigate")).toMatchObject({
      runtime: "pi",
      runtimeAlias: "omp",
    });
  });

  test("rejects multiple delegates and ignores ordinary runtime words", () => {
    expect(parseRuntimeDelegation("Ask claude about codex")).toBeNull();
    expect(parseRuntimeDelegation("$DELEGATE_CLAUDE $DELEGATE_PI compare")).toEqual({
      error: "Choose one delegated runtime per message.",
    });
  });

  test("parses model and thinking from the marker payload", () => {
    expect(
      parseRuntimeDelegation("Fix tests $DELEGATE_CLAUDE[claude-opus-4-8;high]"),
    ).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-4-8",
      reasoning: "high",
      prompt: "Fix tests",
    });
    expect(
      parseRuntimeDelegation("$DELEGATE_OPENCODE[openai/gpt-5.6-sol;extra-high] review the diff"),
    ).toMatchObject({
      runtime: "opencode",
      model: "openai/gpt-5.6-sol",
      reasoning: "extra-high",
      prompt: "review the diff",
    });
  });

  test("drops invalid payload values instead of failing the delegation", () => {
    const badModel = parseRuntimeDelegation("$DELEGATE_CODEX[not a model!!;high] fix it");
    expect(badModel).toMatchObject({ runtime: "codex-cli", prompt: "fix it" });
    expect(badModel && "model" in badModel ? badModel.model : undefined).toBeUndefined();

    const badReasoning = parseRuntimeDelegation("$DELEGATE_CODEX[gpt-5.5;warp-speed] fix it");
    expect(badReasoning).toMatchObject({
      runtime: "codex-cli",
      model: "gpt-5.5",
      prompt: "fix it",
    });
    expect(
      badReasoning && "reasoning" in badReasoning ? badReasoning.reasoning : undefined,
    ).toBeUndefined();
  });

  test("keeps plain markers working without a payload", () => {
    const plain = parseRuntimeDelegation("$DELEGATE_GROK check ci");
    expect(plain).toMatchObject({ runtime: "grok-build", prompt: "check ci" });
    expect(plain && "model" in plain ? plain.model : undefined).toBeUndefined();
  });

  test("formats a marker that round-trips through the parser", () => {
    const marker = formatRuntimeDelegationMarker({
      id: "claude",
      model: "claude-opus-4-8",
      reasoning: "max",
    });
    expect(marker).toBe("$DELEGATE_CLAUDE[claude-opus-4-8;max]");
    expect(parseRuntimeDelegation(`do the thing ${marker}`)).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-4-8",
      reasoning: "max",
      prompt: "do the thing",
    });
  });

  test("round-trips optional Fast mode without breaking older markers", () => {
    const withFast = formatRuntimeDelegationMarker({
      id: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
    });
    expect(withFast).toBe("$DELEGATE_CODEX[gpt-5.5;high;fast]");
    expect(parseRuntimeDelegation(`ship it ${withFast}`)).toMatchObject({
      runtime: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
      prompt: "ship it",
    });

    const withoutFast = formatRuntimeDelegationMarker({
      id: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: false,
    });
    expect(withoutFast).toBe("$DELEGATE_CODEX[gpt-5.5;high]");
    const parsed = parseRuntimeDelegation(withoutFast);
    expect(parsed && "fastMode" in parsed ? parsed.fastMode : undefined).toBeUndefined();
  });

  test("normalizes Fast mode off when the resolved runtime/model does not support it", () => {
    const incompatible = parseRuntimeDelegation(
      "check this $DELEGATE_CLAUDE[claude-opus-4-8;high;fast]",
    );
    expect(incompatible).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-4-8",
      reasoning: "high",
      prompt: "check this",
    });
    expect(
      incompatible && "fastMode" in incompatible ? incompatible.fastMode : undefined,
    ).toBeUndefined();

    // Invalid model is dropped; the new default Claude Opus 5 model keeps Fast mode.
    const badModelWithFast = parseRuntimeDelegation("$DELEGATE_CLAUDE[not a model!!;high;fast]");
    expect(badModelWithFast).toMatchObject({ runtime: "claude-code" });
    expect(
      badModelWithFast && "fastMode" in badModelWithFast ? badModelWithFast.fastMode : undefined,
    ).toBe(true);
  });

  test("defaults delegation from runtime configuration model and thinking preferences", () => {
    const configurations: RuntimeConfigurationProvider[] = [
      {
        id: "rtprov_claude_personal",
        name: "Claude Code personal",
        command: "claude-personal",
        driver: "claude-code",
        builtIn: false,
        position: 0,
        supportsFastMode: true,
        models: [
          {
            id: "m1",
            providerId: "rtprov_claude_personal",
            description: "Opus",
            model: "claude-opus-4-8",
            thinkingLevels: ["low", "high", "max"],
            builtIn: false,
            position: 0,
            isDefault: true,
            defaultThinkingLevel: "high",
          },
        ],
      },
    ];
    expect(defaultDelegationSelectionFromConfiguration("claude", { configurations })).toEqual({
      id: "claude",
      model: "claude-opus-4-8",
      reasoning: "high",
      fastMode: false,
      runtimeConfigurationId: "rtprov_claude_personal",
    });
  });

  test("round-trips optional runtime configuration id with and without Fast mode", () => {
    const withConfig = formatRuntimeDelegationMarker({
      id: "claude",
      model: "claude-opus-4-8",
      reasoning: "high",
      runtimeConfigurationId: "rtprov_claude_personal",
    });
    expect(withConfig).toBe("$DELEGATE_CLAUDE[claude-opus-4-8;high;cfg:rtprov_claude_personal]");
    expect(parseRuntimeDelegation(`do the thing ${withConfig}`)).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-4-8",
      reasoning: "high",
      runtimeConfigurationId: "rtprov_claude_personal",
      prompt: "do the thing",
    });

    const withFastAndConfig = formatRuntimeDelegationMarker({
      id: "codex",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_work_codex",
    });
    expect(withFastAndConfig).toBe("$DELEGATE_CODEX[gpt-5.5;high;fast;cfg:rtprov_work_codex]");
    expect(parseRuntimeDelegation(withFastAndConfig)).toMatchObject({
      runtime: "codex-cli",
      model: "gpt-5.5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_work_codex",
    });
  });
});
