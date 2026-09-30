export const CHAT_MID_RUN_MODES = ["queue", "steer"] as const;
export type ChatMidRunMode = (typeof CHAT_MID_RUN_MODES)[number];
export const isChatMidRunMode = (value: unknown): value is ChatMidRunMode =>
  typeof value === "string" && (CHAT_MID_RUN_MODES as readonly string[]).includes(value);
