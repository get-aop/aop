import type { ComponentProps } from "react";
import type { ChatThread } from "./ChatThread";

export const chatThreadProps = (
  overrides: Partial<ComponentProps<typeof ChatThread>> = {},
): ComponentProps<typeof ChatThread> => ({
  repoName: "aop-mono",
  runtime: "claude-code",
  model: "claude-opus-4-8",
  effort: "medium",
  alias: null,
  messages: [],
  typing: false,
  workerNames: [],
  workerColors: {},
  onAction: () => {},
  ...overrides,
});
