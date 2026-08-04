import { describe, expect, test } from "bun:test";
import {
  buildChatRuntimeTimeoutFacts,
  resolveChatRuntimeTimeoutPolicy,
} from "./runtime-timeout-policy.ts";

describe("resolveChatRuntimeTimeoutPolicy", () => {
  test("allows Grok a slow start while keeping the shared inactivity deadline", () => {
    expect(resolveChatRuntimeTimeoutPolicy("grok-build")).toEqual({
      startupTimeoutMs: 120_000,
      inactivityTimeoutMs: 300_000,
      policyName: "grok_slow_start_v1",
    });
    expect(resolveChatRuntimeTimeoutPolicy("grok")).toEqual(
      resolveChatRuntimeTimeoutPolicy("grok-build"),
    );
  });

  test("uses the default policy for other providers", () => {
    expect(resolveChatRuntimeTimeoutPolicy("codex-cli")).toEqual({
      startupTimeoutMs: 30_000,
      inactivityTimeoutMs: 300_000,
      policyName: "default_v1",
    });
  });

  test("builds prompt-free structured timeout facts", () => {
    expect(
      buildChatRuntimeTimeoutFacts({
        runtime: "grok-build",
        launch: "resume",
        phase: "startup",
        elapsedMs: 120_500,
        outputBytes: 0,
        sessionIdKnown: true,
      }),
    ).toEqual({
      runtime: "grok-build",
      launch: "resume",
      policyName: "grok_slow_start_v1",
      phase: "startup",
      elapsedMs: 120_500,
      outputBytes: 0,
      sessionIdKnown: true,
    });
  });
});
