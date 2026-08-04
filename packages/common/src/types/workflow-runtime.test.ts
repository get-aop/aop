import { describe, expect, test } from "bun:test";
import {
  applyWorkflowRuntimeModelChange,
  applyWorkflowRuntimeProviderDefaults,
  formatWorkflowRuntimeModelLabel,
  getDefaultWorkflowRuntimeModel,
  getWorkflowModelOptions,
  getWorkflowThinkingOptions,
  isAllowedWorkflowRuntimeModel,
  isSafeCustomRuntimeModel,
  mapRuntimeReasoningEffort,
  normalizeRuntimeModelForRun,
  parseRuntimeAgentSettings,
  resolveRuntimeAgent,
  supportsFastMode,
  supportsOpenCodeThinking,
  supportsRuntimeAlias,
  supportsThinkingAndFastMode,
  supportsThinkingLevel,
  supportsUltracode,
  validateWorkflowRuntimeAgent,
  WORKFLOW_RUNTIME_LABELS,
} from "./workflow-runtime.ts";

describe("workflow-runtime", () => {
  test("exposes a runtime alias for every workflow runtime", () => {
    expect(WORKFLOW_RUNTIME_LABELS["grok-build"]).toBe("Grok");
    expect(
      ["claude-code", "codex-cli", "grok-build", "opencode", "pi"].map((provider) =>
        supportsRuntimeAlias(provider as Parameters<typeof supportsRuntimeAlias>[0]),
      ),
    ).toEqual([true, true, true, true, true]);
  });

  test("validates claude-code model list", () => {
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-opus-5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-opus-4-8")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-opus-4-7")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-opus-4-6")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-fable-5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-fable-4-6")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-sonnet-4-6")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "claude-haiku-4-5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("claude-code", "default")).toBe(false);
  });

  test("accepts safe custom model identifiers in runtime agents", () => {
    expect(isSafeCustomRuntimeModel("vendor/custom-model:v2")).toBe(true);
    expect(
      validateWorkflowRuntimeAgent({
        provider: "codex-cli",
        model: "vendor/custom-model:v2",
        reasoning: "extra-high",
      }),
    ).toBeUndefined();
    expect(getDefaultWorkflowRuntimeModel("codex-cli", "vendor/custom-model:v2")).toBe(
      "vendor/custom-model:v2",
    );
  });

  test("accepts bracketed context-window variants like Kimi k3[1m]", () => {
    expect(isSafeCustomRuntimeModel("k3[1m]")).toBe(true);
    expect(isSafeCustomRuntimeModel("k3 [1m]")).toBe(false);
  });

  test("rejects unsafe custom model identifiers in runtime agents", () => {
    expect(isSafeCustomRuntimeModel("custom model --dangerous")).toBe(false);
    expect(
      validateWorkflowRuntimeAgent({
        provider: "codex-cli",
        model: "custom model --dangerous",
        reasoning: "medium",
      }),
    ).toContain("not a valid model identifier");
  });

  test("formats the Claude Code Haiku model label", () => {
    expect(formatWorkflowRuntimeModelLabel("claude-haiku-4-5")).toBe("Haiku 4.5");
  });

  test("labels Claude Code Fable model", () => {
    expect(formatWorkflowRuntimeModelLabel("claude-fable-5")).toBe("Fable 5");
  });

  test("uses provider-native thinking labels", () => {
    expect(getWorkflowThinkingOptions("claude-code", "claude-opus-4-8")).toEqual([
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra" },
      { value: "max", label: "Max" },
    ]);
    expect(getWorkflowThinkingOptions("codex-cli", "gpt-5.6-sol")).toEqual([
      { value: "low", label: "Light" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra-High" },
      { value: "max", label: "Ultra" },
    ]);
    expect(getWorkflowThinkingOptions("opencode", "openai/gpt-5.5")).toEqual([
      { value: "low", label: "Light" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra-High" },
      { value: "max", label: "Ultra" },
    ]);
  });

  test("exposes Max thinking for Claude Opus 5, Opus 4.8, and Fable models", () => {
    expect(
      getWorkflowThinkingOptions("claude-code", "claude-opus-5").map((option) => option.value),
    ).toContain("max");
    expect(
      getWorkflowThinkingOptions("claude-code", "claude-opus-4-8").map((option) => option.value),
    ).toContain("max");
    expect(
      getWorkflowThinkingOptions("claude-code", "claude-fable-5").map((option) => option.value),
    ).toContain("max");
    expect(
      getWorkflowThinkingOptions("claude-code", "claude-sonnet-4-6").map((option) => option.value),
    ).not.toContain("max");
    expect(
      getWorkflowThinkingOptions("opencode", "openai/gpt-5.5").map((option) => option.value),
    ).toContain("max");
    expect(supportsThinkingLevel("claude-code", "claude-opus-4-8")).toBe(true);
    expect(supportsThinkingLevel("claude-code", "claude-fable-5")).toBe(true);
    expect(mapRuntimeReasoningEffort("max")).toBe("max");
    expect(parseRuntimeAgentSettings("claude-code", "claude-opus-4-8", "max").reasoning).toBe(
      "max",
    );
  });

  test("validates pi model list", () => {
    expect(getWorkflowModelOptions("pi")).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.6-luna",
      "openai-codex/gpt-5.6-sol",
      "openai-codex/gpt-5.6-terra",
      "kimi-coding/k3",
      "deepseek-v4-flash",
    ]);
    expect(isAllowedWorkflowRuntimeModel("pi", "openai-codex/gpt-5.5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("pi", "openai-codex/gpt-5.6-luna")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("pi", "openai-codex/gpt-5.6-sol")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("pi", "openai-codex/gpt-5.6-terra")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("pi", "kimi-coding/k3")).toBe(true);
    expect(formatWorkflowRuntimeModelLabel("openai-codex/gpt-5.6-luna")).toBe("GPT 5.6 Luna");
    expect(formatWorkflowRuntimeModelLabel("openai-codex/gpt-5.6-sol")).toBe("GPT 5.6 Sol");
    expect(formatWorkflowRuntimeModelLabel("openai-codex/gpt-5.6-terra")).toBe("GPT 5.6 Terra");
    expect(formatWorkflowRuntimeModelLabel("kimi-coding/k3")).toBe("Kimi K3 Max");
    expect(formatWorkflowRuntimeModelLabel("deepseek-v4-flash")).toBe("DeepSeek V4 Flash");
    expect(isAllowedWorkflowRuntimeModel("pi", "deepseek-v4-flash")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("pi", "cursor/kimi-k2.6")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("pi", "default")).toBe(false);
  });

  test("exposes codex-style thinking for PI openai-codex models", () => {
    expect(supportsThinkingLevel("pi", "openai-codex/gpt-5.6-sol")).toBe(true);
    expect(supportsThinkingLevel("pi", "openai-codex/gpt-5.5")).toBe(true);
    expect(getWorkflowThinkingOptions("pi", "openai-codex/gpt-5.6-luna")).toEqual([
      { value: "low", label: "Light" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "extra-high", label: "Extra-High" },
      { value: "max", label: "Ultra" },
    ]);
  });

  test("exposes high and max thinking for PI DeepSeek V4 Flash", () => {
    expect(supportsThinkingLevel("pi", "deepseek-v4-flash")).toBe(true);
    expect(getWorkflowThinkingOptions("pi", "deepseek-v4-flash")).toEqual([
      { value: "high", label: "High" },
      { value: "max", label: "Ultra" },
    ]);
  });

  test("exposes max-only thinking for PI Kimi K3", () => {
    expect(supportsThinkingLevel("pi", "kimi-coding/k3")).toBe(true);
    expect(getWorkflowThinkingOptions("pi", "kimi-coding/k3")).toEqual([
      { value: "max", label: "Max" },
    ]);
    expect(supportsFastMode("pi", "kimi-coding/k3")).toBe(false);
    expect(parseRuntimeAgentSettings("pi", "kimi-coding/k3", "medium").reasoning).toBe("max");
    expect(
      validateWorkflowRuntimeAgent({
        provider: "pi",
        model: "kimi-coding/k3",
        reasoning: "max",
        fastMode: false,
        ultracode: false,
      }),
    ).toBeUndefined();
    expect(
      validateWorkflowRuntimeAgent({
        provider: "pi",
        model: "kimi-coding/k3",
        reasoning: "medium",
        fastMode: false,
        ultracode: false,
      }),
    ).toContain("Thinking");
  });

  test("validates codex and opencode model lists", () => {
    expect(isAllowedWorkflowRuntimeModel("codex-cli", "gpt-5.5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("codex-cli", "gpt-4.1")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("opencode", "openai/gpt-5.5-fast")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("opencode", "openai/gpt-5.5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("opencode", "opencode-go/kimi-k2.6")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("opencode", "opencode-go/kimi-k2.7-code")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("opencode", "zai-coding-plan/glm-5.2")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("opencode", "opencode-go/glm-5.2")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("opencode", "openai/gpt-5.3-codex")).toBe(false);
  });

  test("validates Grok Build models and effort availability", () => {
    expect(getWorkflowModelOptions("grok-build")).toEqual(["grok-4.5", "grok-composer-2.5-fast"]);
    expect(formatWorkflowRuntimeModelLabel("grok-4.5")).toBe("Grok 4.5");
    expect(formatWorkflowRuntimeModelLabel("grok-composer-2.5-fast")).toBe("Composer 2.5 Fast");
    expect(isAllowedWorkflowRuntimeModel("grok-build", "grok-4.5")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("grok-build", "grok-composer-2.5-fast")).toBe(true);
    expect(isAllowedWorkflowRuntimeModel("grok-build", "composer-2.5")).toBe(false);
    expect(isAllowedWorkflowRuntimeModel("grok-build", "grok-4.3")).toBe(false);
    expect(
      getWorkflowThinkingOptions("grok-build", "grok-4.5").map((option) => option.value),
    ).toEqual(["low", "medium", "high"]);
    expect(supportsThinkingLevel("grok-build", "grok-4.5")).toBe(true);
    expect(supportsThinkingLevel("grok-build", "grok-composer-2.5-fast")).toBe(false);
    expect(
      validateWorkflowRuntimeAgent({
        provider: "grok-build",
        model: "grok-4.5",
        reasoning: "extra-high",
      }),
    ).toContain("Thinking");
  });

  test("exposes new OpenCode routes with distinct labels", () => {
    expect(getWorkflowModelOptions("opencode")).toEqual(
      expect.arrayContaining([
        "zai-coding-plan/glm-5.2",
        "opencode-go/glm-5.2",
        "opencode-go/kimi-k2.7-code",
      ]),
    );
    expect(formatWorkflowRuntimeModelLabel("zai-coding-plan/glm-5.2")).toBe(
      "GLM 5.2 (Z.AI Coding Plan)",
    );
    expect(formatWorkflowRuntimeModelLabel("opencode-go/glm-5.2")).toBe("GLM 5.2 (OpenCode Go)");
    expect(formatWorkflowRuntimeModelLabel("opencode-go/kimi-k2.7-code")).toBe("Kimi K2.7 Code");
  });

  test("exposes High and Max thinking for OpenCode GLM 5.2 routes", () => {
    for (const model of ["opencode-go/glm-5.2", "zai-coding-plan/glm-5.2"]) {
      expect(supportsOpenCodeThinking(model)).toBe(true);
      expect(supportsThinkingLevel("opencode", model)).toBe(true);
      expect(getWorkflowThinkingOptions("opencode", model).map((option) => option.value)).toEqual([
        "high",
        "max",
      ]);
      expect(validateWorkflowRuntimeAgent({ provider: "opencode", model, reasoning: "max" })).toBe(
        undefined,
      );
      expect(
        validateWorkflowRuntimeAgent({ provider: "opencode", model, reasoning: "medium" }),
      ).toContain("Thinking");
    }
  });

  test("exposes thinking for OpenCode GPT 5.5 models without fast mode", () => {
    expect(supportsOpenCodeThinking("openai/gpt-5.5-fast")).toBe(true);
    expect(supportsOpenCodeThinking("openai/gpt-5.5")).toBe(true);
    expect(supportsThinkingLevel("opencode", "openai/gpt-5.5-fast")).toBe(true);
    expect(supportsThinkingLevel("opencode", "openai/gpt-5.5")).toBe(true);
    expect(supportsFastMode("opencode", "openai/gpt-5.5-fast")).toBe(false);
    expect(supportsFastMode("opencode", "openai/gpt-5.5")).toBe(false);
    expect(supportsThinkingAndFastMode("opencode", "openai/gpt-5.5-fast")).toBe(false);
    expect(supportsThinkingLevel("opencode", "opencode-go/kimi-k2.7-code")).toBe(false);
    expect(formatWorkflowRuntimeModelLabel("openai/gpt-5.5-fast")).toBe("GPT 5.5 Fast");
    expect(formatWorkflowRuntimeModelLabel("openai/gpt-5.5")).toBe("GPT 5.5");
    expect(supportsThinkingLevel("opencode", "opencode-go/kimi-k2.7-code")).toBe(false);
  });

  test("marks PI Codex models as supporting fast mode", () => {
    expect(supportsFastMode("pi", "openai-codex/gpt-5.6-sol")).toBe(true);
    expect(supportsFastMode("pi", "anthropic/claude-sonnet-4-6")).toBe(false);
    expect(
      validateWorkflowRuntimeAgent({
        provider: "pi",
        model: "openai-codex/gpt-5.6-sol",
        reasoning: "medium",
        fastMode: true,
      }),
    ).toBeUndefined();
  });

  test("enables fast mode only for Claude Opus 5", () => {
    expect(supportsFastMode("claude-code", "claude-opus-5")).toBe(true);
    expect(supportsFastMode("claude-code", "claude-opus-4-8")).toBe(false);
    expect(
      parseRuntimeAgentSettings("claude-code", "claude-opus-5", "max", "false", "", "true"),
    ).toMatchObject({ model: "claude-opus-5", fastMode: true });
  });

  test("normalizes dependent settings when changing models", () => {
    expect(
      applyWorkflowRuntimeModelChange(
        {
          provider: "opencode",
          model: "openai/gpt-5.5",
          reasoning: "max",
          fastMode: true,
          ultracode: true,
        },
        "opencode-go/kimi-k2.7-code",
      ),
    ).toEqual({
      provider: "opencode",
      model: "opencode-go/kimi-k2.7-code",
      reasoning: "extra-high",
      fastMode: false,
      ultracode: false,
    });
  });

  test("applies provider defaults when switching runtimes", () => {
    expect(
      applyWorkflowRuntimeProviderDefaults(
        { provider: "pi", model: "openai-codex/gpt-5.5", reasoning: "medium" },
        "codex-cli",
      ),
    ).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });

    expect(
      applyWorkflowRuntimeProviderDefaults(
        { provider: "codex-cli", model: "gpt-5.5", reasoning: "medium" },
        "pi",
      ),
    ).toEqual({
      provider: "pi",
      model: "openai-codex/gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });

    expect(
      applyWorkflowRuntimeProviderDefaults(
        { provider: "codex-cli", model: "gpt-5.4", reasoning: "medium" },
        "opencode",
      ),
    ).toEqual({
      provider: "opencode",
      model: "opencode-go/kimi-k2.7-code",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });

    expect(
      applyWorkflowRuntimeProviderDefaults(
        {
          provider: "codex-cli",
          model: "gpt-5.5",
          reasoning: "medium",
          runtimeAlias: "cdx",
        },
        "grok-build",
      ),
    ).toEqual({
      provider: "grok-build",
      model: "grok-4.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });
  });

  test("keeps ultracode only on Claude Code agents", () => {
    expect(supportsUltracode("claude-code", "claude-opus-4-8")).toBe(true);
    expect(supportsUltracode("codex-cli", "gpt-5.5")).toBe(false);

    expect(
      applyWorkflowRuntimeProviderDefaults(
        {
          provider: "claude-code",
          model: "claude-opus-4-8",
          reasoning: "extra-high",
          ultracode: true,
        },
        "claude-code",
      ),
    ).toMatchObject({ provider: "claude-code", ultracode: true });

    expect(
      applyWorkflowRuntimeProviderDefaults(
        {
          provider: "claude-code",
          model: "claude-opus-4-8",
          reasoning: "extra-high",
          ultracode: true,
        },
        "codex-cli",
      ),
    ).toMatchObject({ provider: "codex-cli", ultracode: false });

    expect(
      validateWorkflowRuntimeAgent({
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "medium",
        ultracode: true,
      }),
    ).toContain("Ultracode");
  });

  test("keeps control capabilities only on runtimes that support them", () => {
    const codex = applyWorkflowRuntimeProviderDefaults(
      {
        provider: "codex-cli",
        model: "gpt-5.5",
        reasoning: "medium",
        browserControl: true,
        computerControl: true,
      },
      "claude-code",
    );
    expect(codex.browserControl).toBe(true);
    expect(codex.computerControl).toBe(false);

    const opencode = applyWorkflowRuntimeProviderDefaults(codex, "opencode");
    expect(opencode.browserControl).toBe(false);
    expect(opencode.computerControl).toBe(false);
  });

  test("normalizes default model for provider runs", () => {
    expect(normalizeRuntimeModelForRun("pi", "default")).toBeUndefined();
    expect(normalizeRuntimeModelForRun("pi", "openai-codex/gpt-5.5")).toBe("openai-codex/gpt-5.5");
    expect(normalizeRuntimeModelForRun("opencode", "openai/gpt-5.5")).toBe("openai/gpt-5.5");
    expect(normalizeRuntimeModelForRun("codex-cli", "gpt-5.5")).toBe("gpt-5.5");
  });

  test("resolves runtime defaults", () => {
    expect(resolveRuntimeAgent()).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });
    expect(getDefaultWorkflowRuntimeModel("opencode", "invalid")).toBe("invalid");
    expect(getDefaultWorkflowRuntimeModel("opencode", "openai/gpt-5.5/extra-high")).toBe(
      "openai/gpt-5.5/extra-high",
    );
    expect(getDefaultWorkflowRuntimeModel("pi", "invalid")).toBe("invalid");
    expect(getDefaultWorkflowRuntimeModel("claude-code", "invalid")).toBe("invalid");
  });

  test("parses saved runtime agent settings", () => {
    expect(parseRuntimeAgentSettings("opencode", "openai/gpt-5.5", "high")).toEqual({
      provider: "opencode",
      model: "openai/gpt-5.5",
      reasoning: "high",
      fastMode: false,
      ultracode: false,
    });
    expect(
      parseRuntimeAgentSettings("claude-code", "claude-opus-4-8", "extra-high", "true"),
    ).toMatchObject({
      provider: "claude-code",
      model: "claude-opus-4-8",
      ultracode: true,
    });
    expect(parseRuntimeAgentSettings("pi", "openai-codex/gpt-5.5", "high", "true")).toEqual({
      provider: "pi",
      model: "openai-codex/gpt-5.5",
      reasoning: "high",
      fastMode: false,
      ultracode: false,
    });
    expect(parseRuntimeAgentSettings("bogus", "openai/gpt-5.5", "high")).toEqual({
      provider: "codex-cli",
      model: "gpt-5.5",
      reasoning: "medium",
      fastMode: false,
      ultracode: false,
    });
    expect(parseRuntimeAgentSettings("opencode", "invalid-model", "high")).toEqual({
      provider: "opencode",
      model: "invalid-model",
      reasoning: "high",
      fastMode: false,
      ultracode: false,
    });
    expect(
      parseRuntimeAgentSettings("grok-build", "grok-4.5", "high", "false", "grok-work"),
    ).toEqual({
      provider: "grok-build",
      model: "grok-4.5",
      reasoning: "high",
      fastMode: false,
      ultracode: false,
      runtimeAlias: "grok-work",
    });
  });
});
