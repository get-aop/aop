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

export const CHAT_RUNTIME_TIMEOUT_POLICY: ChatRuntimeTimeoutPolicy = {
  startupTimeoutMs: 30_000,
  policyName: "default_v1",
};

export const buildChatRuntimeTimeoutFacts = (
  input: ChatRuntimeTimeoutFactsInput,
): ChatRuntimeTimeoutFacts => ({
  ...input,
  policyName: CHAT_RUNTIME_TIMEOUT_POLICY.policyName,
});
