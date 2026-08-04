export interface ChatRuntimeTimeoutPolicy {
  startupTimeoutMs: number;
  policyName: string;
}

interface ChatRuntimeTimeoutFactsInput {
  runtime: string;
  launch: "fresh" | "resume";
  phase: "startup" | "inactivity";
  elapsedMs: number;
  outputBytes: number;
  sessionIdKnown: boolean;
}

export type ChatRuntimeTimeoutFacts = Record<string, unknown> &
  ChatRuntimeTimeoutFactsInput & { policyName: string };

const DEFAULT_POLICY: ChatRuntimeTimeoutPolicy = {
  startupTimeoutMs: 30_000,
  policyName: "default_v1",
};

const GROK_POLICY: ChatRuntimeTimeoutPolicy = {
  startupTimeoutMs: 120_000,
  policyName: "grok_slow_start_v1",
};

export const resolveChatRuntimeTimeoutPolicy = (runtime: string): ChatRuntimeTimeoutPolicy =>
  runtime === "grok-build" || runtime === "grok" ? GROK_POLICY : DEFAULT_POLICY;

export const buildChatRuntimeTimeoutFacts = (
  input: ChatRuntimeTimeoutFactsInput,
): ChatRuntimeTimeoutFacts => ({
  ...input,
  policyName: resolveChatRuntimeTimeoutPolicy(input.runtime).policyName,
});
