import type { Thread, ToolPart, TurnPart } from "@aop/common";
import { humanizeToolName } from "../chat-session/stream-progress-parse.ts";
import type { LocalServerContext } from "../context.ts";
import type { ChatSession } from "../db/schema.ts";
import { claudeMcpToolName, THREAD_TOOL_NAMES } from "../mcp/availability.ts";
import { recordThreadUpserted } from "../project/events.ts";
import { createThreadRepository } from "./repository.ts";
import { postThreadReport } from "./turn-outcome.ts";

/**
 * Notices a working thread whose AOP tools stopped reaching the host, marks it degraded and tells
 * the coordinator. Two signals, neither of which a long tool call can trip:
 *
 * - The thread's own transcript shows an AOP tool call that failed, and the host never received
 *   that call: the CLI could not reach the host (it was down, or answered with something else).
 * - The host refused a request carrying the session's id, because its token did not match (the
 *   MCP secret was rotated under a running turn).
 *
 * A call that arrives again clears the mark, and so does the end of the turn.
 */
export interface ThreadToolHealth {
  /**
   * The host accepted an MCP request from this session, so its tools reach the host. A tool call
   * passes `toolUseId`, the CLI's id for the call when it sent one.
   */
  accepted: (session: ChatSession, toolCall?: { toolUseId: string | null }) => Promise<void>;
  /** The host refused an MCP request naming this session, for its token. */
  authFailed: (sessionId: string) => Promise<void>;
  /** A thread's turn so far, as clients see it. */
  turnProgress: (session: ChatSession, parts: readonly TurnPart[]) => void;
}

export const createThreadToolHealth = (
  ctx: LocalServerContext,
  wake: (sessionIds: string[]) => Promise<void>,
): ThreadToolHealth => {
  const flag = async (sessionId: string, reason: string): Promise<void> => {
    const woken = await ctx.eventPublisher.transaction(async (tx) => {
      const threads = createThreadRepository(tx.db);
      const thread = await threads.getById(sessionId);
      if (thread?.status !== "working" || thread.degraded) return [];
      const now = new Date().toISOString();
      await threads.update(sessionId, { degraded: { reason, since: now }, lastActivityAt: now });
      await recordThreadUpserted(tx, sessionId);
      return postThreadReport(tx, thread, "needs-you", degradedReport(thread, reason));
    });
    if (woken.length > 0) await wake(woken);
  };

  return {
    accepted: async (session, toolCall) => {
      if (toolCall) noteCall(session.id, toolCall.toolUseId);
      if (session.kind !== "thread" || session.tools_degraded_json === null) return;
      await ctx.eventPublisher.transaction(async (tx) => {
        await createThreadRepository(tx.db).update(session.id, { degraded: null });
        await recordThreadUpserted(tx, session.id);
      });
    },

    authFailed: async (sessionId) => {
      await flag(
        sessionId,
        "The host refused its AOP tool token: the MCP secret was rotated while the turn ran.",
      );
    },

    turnProgress: (session, parts) => {
      if (session.kind !== "thread") return;
      const lost = parts.find((part) => isLostAopCall(session.id, part));
      if (!lost) return;
      void flag(
        session.id,
        `Its call to ${lost.name} failed before it reached the host: the AOP tools cannot reach the host.`,
      );
    },
  };
};

/** How long a call that named no tool use counts as proof that the session's tools work. */
const ANONYMOUS_CALL_WINDOW_MS = 10 * 60_000;
const IDS_KEPT = 200;

/**
 * The calls the host received, per session, by the CLI's tool-use id (Claude Code sends it as
 * `_meta["claudecode/toolUseId"]`). Process-wide like the run registry: a call is received by
 * whichever services answered it, and a host restart starts over, which only means a lost call
 * from before the restart is not judged.
 */
const received = new Map<string, { ids: string[]; anonymousAt: number | null }>();
/** Failed calls already judged, so a turn's progress, reported again and again, flags once. */
const judged = new Map<string, Set<string>>();

const noteCall = (sessionId: string, toolUseId: string | null): void => {
  const calls = received.get(sessionId) ?? { ids: [], anonymousAt: null };
  if (toolUseId) calls.ids = [...calls.ids.slice(-(IDS_KEPT - 1)), toolUseId];
  else calls.anonymousAt = Date.now();
  received.set(sessionId, calls);
};

const wasReceived = (sessionId: string, toolUseId: string): boolean => {
  const calls = received.get(sessionId);
  if (!calls) return false;
  if (calls.ids.includes(toolUseId)) return true;
  return calls.anonymousAt !== null && Date.now() - calls.anonymousAt < ANONYMOUS_CALL_WINDOW_MS;
};

// How a thread's AOP tools are named in its transcript.
const AOP_TOOL_PART_NAMES = new Set(
  THREAD_TOOL_NAMES.map((tool) => humanizeToolName(claudeMcpToolName(tool))),
);

const isLostAopCall = (sessionId: string, part: TurnPart): part is ToolPart => {
  if (part.type !== "tool" || part.status !== "failed" || !AOP_TOOL_PART_NAMES.has(part.name)) {
    return false;
  }
  const seen = judged.get(sessionId) ?? new Set<string>();
  judged.set(sessionId, seen);
  if (seen.has(part.id)) return false;
  seen.add(part.id);
  return !wasReceived(sessionId, part.id);
};

const degradedReport = (thread: Thread, reason: string): string =>
  [
    `Thread report: "${thread.title}" (${thread.id}) lost its AOP tools. ${reason}`,
    "It is still running, but until they come back it cannot report its status, ask the person, or open its pull request through AOP, so it may be stuck on something nobody sees. Tell the person. Stopping it and steering it again starts a new turn with working tools.",
  ].join("\n");

/** Forgets every session's calls (tests). */
export const resetThreadToolHealth = (): void => {
  received.clear();
  judged.clear();
};
