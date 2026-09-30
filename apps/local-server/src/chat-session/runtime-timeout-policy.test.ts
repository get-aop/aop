import { describe, expect, test } from "bun:test";
import {
  buildChatRuntimeTimeoutFacts,
  CHAT_RUNTIME_TIMEOUT_POLICY,
} from "./runtime-timeout-policy.ts";

describe("chat runtime timeout policy", () => {
  test("uses one startup deadline for every runtime", () => {
    expect(CHAT_RUNTIME_TIMEOUT_POLICY).toEqual({
      startupTimeoutMs: 30_000,
      policyName: "default_v1",
    });
  });

  test("builds prompt-free structured timeout facts", () => {
    expect(
      buildChatRuntimeTimeoutFacts({
        runtime: "claude-code",
        launch: "resume",
        phase: "startup",
        elapsedMs: 30_500,
        outputBytes: 0,
        sessionIdKnown: true,
      }),
    ).toEqual({
      runtime: "claude-code",
      launch: "resume",
      policyName: "default_v1",
      phase: "startup",
      elapsedMs: 30_500,
      outputBytes: 0,
      sessionIdKnown: true,
    });
  });
});
