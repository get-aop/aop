export const AOP_PLATFORM_INSTRUCTIONS = [
  "For AOP platform actions (workflows), prefer the `aop` MCP tools.",
  "If you create or switch to a Git worktree, immediately bind this chat to it with `aop_set_chat_workspace` using AOP_CHAT_SESSION_ID and the absolute path. If MCP is unavailable, run `aop session workspace set <session-id> <absolute-path>`.",
] as const;
