import type { LiveViewSession } from "@aop/common";
import { CUA_MCP_SERVER_NAME } from "./service.ts";

/**
 * Which threads are using CUA Driver right now, heard from their own tool calls: every
 * `mcp__cua-driver__*` call a thread's Claude Code writes to its run log. Nothing else counts
 * (not the CUA lock directory threads take by convention, not the project's setting), so a
 * thread is "using CUA" only while it really drives the screen.
 *
 * A thread's CUA session ends when it calls `end_session`, when its turn ends (the driver's MCP
 * server goes with the run), or when it has made no CUA call for `IDLE_MS` (it moved on to a
 * test suite and never said so). An ended session stays listed, marked `ending`, for `LINGER_MS`,
 * so a viewer sees the last frame before the view goes away.
 */
export interface CuaActivity {
  /** Hears one line of a thread's run log. Costs a substring check unless it names a CUA tool. */
  observeLine: (thread: CuaThread, line: string) => void;
  /** The thread's turn ended: its CUA session, if any, ended with it. */
  runEnded: (threadId: string) => void;
  /** Most recently active first; drops sessions whose linger is over. */
  sessions: () => LiveViewSession[];
  /** Whether any session is active and not ending. */
  anyActive: () => boolean;
}

export interface CuaThread {
  id: string;
  projectId: string;
  title: string;
}

export const IDLE_MS = 3 * 60_000;
export const LINGER_MS = 10_000;

const TOOL_PREFIX = `mcp__${CUA_MCP_SERVER_NAME}__`;
const END_TOOL = `${TOOL_PREFIX}end_session`;

interface Entry {
  thread: CuaThread;
  startedAt: number;
  lastCallAt: number;
  /** When the CUA session ended; null while it runs. */
  endedAt: number | null;
}

export const createCuaActivity = (now: () => number = Date.now): CuaActivity => {
  const entries = new Map<string, Entry>();

  const endedAt = (entry: Entry): number | null =>
    entry.endedAt ?? (now() - entry.lastCallAt > IDLE_MS ? entry.lastCallAt + IDLE_MS : null);

  const prune = () => {
    for (const [id, entry] of entries) {
      const ended = endedAt(entry);
      if (ended !== null && now() - ended > LINGER_MS) entries.delete(id);
    }
  };

  const record = (thread: CuaThread, name: string) => {
    const at = now();
    const entry = entries.get(thread.id);
    // A call after an ended session starts a new one.
    const startedAt = entry && endedAt(entry) === null ? entry.startedAt : at;
    entries.set(thread.id, {
      thread,
      startedAt,
      lastCallAt: at,
      endedAt: name === END_TOOL ? at : null,
    });
  };

  return {
    observeLine: (thread, line) => {
      if (!line.includes(TOOL_PREFIX)) return;
      for (const name of cuaToolCalls(line)) record(thread, name);
    },
    runEnded: (threadId) => {
      const entry = entries.get(threadId);
      if (entry && entry.endedAt === null)
        entry.endedAt = Math.min(now(), entry.lastCallAt + IDLE_MS);
    },
    sessions: () => {
      prune();
      return [...entries.values()]
        .sort((a, b) => b.lastCallAt - a.lastCallAt)
        .map((entry) => ({
          threadId: entry.thread.id,
          projectId: entry.thread.projectId,
          title: entry.thread.title,
          startedAt: new Date(entry.startedAt).toISOString(),
          lastActivityAt: new Date(entry.lastCallAt).toISOString(),
          ending: endedAt(entry) !== null,
        }));
    },
    anyActive: () => [...entries.values()].some((entry) => endedAt(entry) === null),
  };
};

/**
 * The CUA tools a stream-json line calls: `tool_use` blocks of an assistant message (a
 * subagent's too: it drives the same screen). Partial-message `stream_event`s are skipped, since
 * the finished message repeats the call.
 */
export const cuaToolCalls = (line: string): string[] => {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(event) || event.type !== "assistant" || !isRecord(event.message)) return [];
  const content = event.message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) =>
    isRecord(block) &&
    block.type === "tool_use" &&
    typeof block.name === "string" &&
    block.name.startsWith(TOOL_PREFIX)
      ? [block.name]
      : [],
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The host's one tracker: every run's log tail reports to it, and the live view reads it. */
export const cuaActivity = createCuaActivity();
