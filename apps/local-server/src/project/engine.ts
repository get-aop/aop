import type { createChatSessionService } from "../chat-session/service.ts";

/** The chat engine that runs a session's turns; project services drive it and never reimplement it. */
export type ChatEngine = ReturnType<typeof createChatSessionService>;
