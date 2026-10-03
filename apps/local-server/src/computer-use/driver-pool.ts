import { getLogger } from "@aop/infra";
import type { DriverClient, RpcResponse } from "./driver-client.ts";

const logger = getLogger("computer-use");

/**
 * The `cua-driver mcp` process of each thread that uses CUA, started on the thread's first
 * request and ended when its lease is given back or its turn ends. One per thread, like the one
 * Claude Code started for each run before the host stood in between: the driver ties a thread's
 * implicit session to its connection. The pool also remembers which CUA sessions a thread opened,
 * so `endThread` can end them all (each `end_session` closes the browser it launched and deletes
 * its profile).
 */
export interface DriverPool {
  /** The thread's driver, started when it has none; null when CUA Driver cannot run here. */
  client: (threadId: string) => Promise<DriverClient | null>;
  /** Records a tool call's `session` label (the implicit session when it names none). */
  noteCall: (threadId: string, tool: string, args: Record<string, unknown> | undefined) => void;
  /** Ends every CUA session the thread left open, then its driver process. */
  endThread: (threadId: string) => Promise<void>;
  /** Ends every thread's sessions and driver process (host shutdown). */
  closeAll: () => Promise<void>;
}

const IMPLICIT = "";
const END_TIMEOUT_MS = 10_000;

export const createDriverPool = (start: () => Promise<DriverClient | null>): DriverPool => {
  const drivers = new Map<string, { client: DriverClient; sessions: Set<string> }>();
  // Requests of one thread that arrive together share the one process being started.
  const starting = new Map<string, Promise<DriverClient | null>>();

  const startFor = async (threadId: string): Promise<DriverClient | null> => {
    const client = await start();
    if (client) drivers.set(threadId, { client, sessions: new Set() });
    return client;
  };

  const endThread = async (threadId: string): Promise<void> => {
    const found = drivers.get(threadId);
    if (!found) return;
    drivers.delete(threadId);
    for (const label of found.sessions) {
      const response = await found.client.request(
        "tools/call",
        { name: "end_session", arguments: label === IMPLICIT ? {} : { session: label } },
        END_TIMEOUT_MS,
      );
      logEnded(threadId, label, response);
    }
    await found.client.close();
  };

  return {
    client: async (threadId) => {
      const found = drivers.get(threadId);
      if (found && !found.client.exited()) return found.client;
      const pending = starting.get(threadId) ?? startFor(threadId);
      starting.set(threadId, pending);
      try {
        return await pending;
      } finally {
        starting.delete(threadId);
      }
    },
    noteCall: (threadId, tool, args) => {
      const found = drivers.get(threadId);
      if (!found) return;
      const label = typeof args?.session === "string" ? args.session : IMPLICIT;
      if (tool === "end_session") found.sessions.delete(label);
      else found.sessions.add(label);
    },
    endThread,
    closeAll: async () => {
      await Promise.all([...drivers.keys()].map(endThread));
    },
  };
};

const logEnded = (threadId: string, label: string, response: RpcResponse) => {
  if (response.error) {
    logger.warn("Ending CUA session {label} of thread {threadId} failed: {error}", {
      threadId,
      label: label || "(implicit)",
      error: response.error.message,
    });
  }
};
