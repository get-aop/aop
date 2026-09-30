import { describe, expect, test } from "bun:test";
import { formatRuntimeDelegationMarker, parseRuntimeDelegation } from "./runtime-delegation.ts";

describe("parseRuntimeDelegation", () => {
  test("preserves prompt indentation when removing the delegation marker", () => {
    const prompt = [
      "Fix this:",
      "    if (ready) {",
      "\t\trun();",
      "    } $DELEGATE_CLAUDE[claude-opus-4-8;high]",
    ].join("\n");

    expect(parseRuntimeDelegation(prompt)).toMatchObject({
      prompt: ["Fix this:", "    if (ready) {", "\t\trun();", "    }"].join("\n"),
    });
  });

  test("parses the Claude marker case-insensitively", () => {
    expect(parseRuntimeDelegation("Investigate this $delegate_claude")).toMatchObject({
      runtime: "claude-code",
      prompt: "Investigate this",
    });
  });

  test("ignores ordinary runtime words and markers of runtimes outside the catalog", () => {
    expect(parseRuntimeDelegation("Ask claude about codex")).toBeNull();
    for (const marker of ["CODEX", "PI", "OMP", "OPENCODE", "GROK"]) {
      expect(parseRuntimeDelegation(`$DELEGATE_${marker} investigate`)).toBeNull();
    }
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
      parseRuntimeDelegation("$DELEGATE_CLAUDE[claude-sonnet-4-6;extra-high] review the diff"),
    ).toMatchObject({
      runtime: "claude-code",
      model: "claude-sonnet-4-6",
      reasoning: "extra-high",
      prompt: "review the diff",
    });
  });

  test("drops invalid payload values instead of failing the delegation", () => {
    const badModel = parseRuntimeDelegation("$DELEGATE_CLAUDE[not a model!!;high] fix it");
    expect(badModel).toMatchObject({ runtime: "claude-code", prompt: "fix it" });
    expect(badModel && "model" in badModel ? badModel.model : undefined).toBeUndefined();

    const badReasoning = parseRuntimeDelegation(
      "$DELEGATE_CLAUDE[claude-opus-4-8;warp-speed] fix it",
    );
    expect(badReasoning).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-4-8",
      prompt: "fix it",
    });
    expect(
      badReasoning && "reasoning" in badReasoning ? badReasoning.reasoning : undefined,
    ).toBeUndefined();
  });

  test("keeps plain markers working without a payload", () => {
    const plain = parseRuntimeDelegation("$DELEGATE_CLAUDE check ci");
    expect(plain).toMatchObject({ runtime: "claude-code", prompt: "check ci" });
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
      id: "claude",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
    });
    expect(withFast).toBe("$DELEGATE_CLAUDE[claude-opus-5;high;fast]");
    expect(parseRuntimeDelegation(`ship it ${withFast}`)).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
      prompt: "ship it",
    });

    const withoutFast = formatRuntimeDelegationMarker({
      id: "claude",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: false,
    });
    expect(withoutFast).toBe("$DELEGATE_CLAUDE[claude-opus-5;high]");
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
      id: "claude",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_work_claude",
    });
    expect(withFastAndConfig).toBe(
      "$DELEGATE_CLAUDE[claude-opus-5;high;fast;cfg:rtprov_work_claude]",
    );
    expect(parseRuntimeDelegation(withFastAndConfig)).toMatchObject({
      runtime: "claude-code",
      model: "claude-opus-5",
      reasoning: "high",
      fastMode: true,
      runtimeConfigurationId: "rtprov_work_claude",
    });
  });
});
