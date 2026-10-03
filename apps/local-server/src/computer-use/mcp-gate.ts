import { cuaHolderName, cuaLinePlace } from "@aop/common";
import type { CuaThread } from "./cua-activity.ts";
import type { RpcResponse } from "./driver-client.ts";
import type { DriverPool } from "./driver-pool.ts";
import type { CuaLease, CuaLeaseWait } from "./lease.ts";

/**
 * CUA Driver's MCP server as threads see it: the host answers every request by passing it to the
 * thread's own `cua-driver mcp` process (driver-pool.ts), and holds each tool call back until the
 * thread has the computer-use lease (lease.ts).
 *
 * A call that has to wait is answered as a server-sent event stream: MCP progress notifications
 * every few seconds say who has the screen and where the thread stands, and the tool's result
 * follows once the lease comes. Claude Code keeps a streamed call open for as long as it takes
 * (checked with Claude Code 2.1.288). After `maxWaitMs` the call answers that it is still waiting
 * and the thread keeps its place for a while (see lease.ts), so no call hangs without end.
 *
 * `end_session` gives the lease back once the driver has ended the session.
 */
export interface CuaGate {
  handle: (thread: CuaThread, body: JsonRpcRequest, signal?: AbortSignal) => Promise<Response>;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: unknown;
}

export interface CuaGateDeps {
  lease: CuaLease;
  pool: DriverPool;
  maxWaitMs?: number;
  progressEveryMs?: number;
}

export const MAX_WAIT_MS = 10 * 60_000;
const PROGRESS_EVERY_MS = 10_000;
const END_TOOL = "end_session";

export const createCuaGate = (deps: CuaGateDeps): CuaGate => {
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS;
  const progressEveryMs = deps.progressEveryMs ?? PROGRESS_EVERY_MS;

  const forward = async (threadId: string, body: JsonRpcRequest): Promise<RpcResponse> => {
    const client = await deps.pool.client(threadId);
    if (!client) return rpcError(body.id, -32000, "CUA Driver is not available on this host.");
    const response = await client.request(body.method ?? "", body.params);
    return { ...response, jsonrpc: "2.0", id: body.id };
  };

  // Runs a tool call the thread may make now: it holds the lease.
  const callTool = async (thread: CuaThread, body: JsonRpcRequest): Promise<RpcResponse> => {
    const { name, args } = toolOf(body.params);
    deps.lease.callStarted(thread.id);
    try {
      const response = await forward(thread.id, body);
      deps.pool.noteCall(thread.id, name, args);
      return response;
    } finally {
      deps.lease.callEnded(thread.id);
      // The answer does not wait for the cleanup; a next call waits in line until it is done.
      if (name === END_TOOL) void deps.lease.release(thread.id, "end-session");
    }
  };

  // Anything but a tool call needs no lease. MCP 2026-07-28 clients (Claude Code 2.1.288) read
  // the server's instructions from a stateless `server/discover` instead of `initialize`.
  const answerOther = async (
    thread: CuaThread,
    body: JsonRpcRequest,
    method: string,
  ): Promise<RpcResponse> => {
    if (method === "initialize") return initializeResult(deps.pool, thread, body);
    const response = await forward(thread.id, body);
    return method === "server/discover" ? withLeaseInstructions(response) : response;
  };

  const waitAndCall = (thread: CuaThread, body: JsonRpcRequest, signal?: AbortSignal): Response => {
    const token = progressTokenOf(body.params);
    const encoder = new TextEncoder();
    const abort = new AbortController();
    signal?.addEventListener("abort", () => abort.abort(), { once: true });
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        let open = true;
        const write = (text: string) => {
          if (!open) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            open = false;
          }
        };
        let latest: CuaLeaseWait | null = null;
        let sent = 0;
        const progress = () => {
          if (!latest) return;
          sent += 1;
          if (token === undefined) write(`: ${waitingText(latest)}\n\n`);
          else write(event(progressNotification(token, sent, waitingText(latest))));
        };
        const timer = setInterval(progress, progressEveryMs);
        const result = await deps.lease.acquire(thread, {
          maxWaitMs,
          signal: abort.signal,
          onWait: (wait) => {
            const moved = latest?.position !== wait.position;
            latest = wait;
            if (moved) progress();
          },
        });
        clearInterval(timer);
        if (result.kind === "aborted") {
          open = false;
          controller.close();
          return;
        }
        const response =
          result.kind === "granted"
            ? await callTool(thread, body)
            : rpcResult(body.id, {
                content: [{ type: "text", text: stillWaitingText(result.wait) }],
                isError: true,
                // MCP 2026-07-28 requires it on every result; earlier revisions ignore it.
                resultType: "complete",
              });
        write(event(response));
        if (open) controller.close();
      },
      cancel: () => abort.abort(),
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });
  };

  return {
    handle: async (thread, body, signal) => {
      const method = body.method ?? "";
      if (method.startsWith("notifications/")) return new Response(null, { status: 202 });
      if (method !== "tools/call") return json(await answerOther(thread, body, method));
      if (deps.lease.tryAcquire(thread)) return json(await callTool(thread, body));
      return waitAndCall(thread, body, signal);
    },
  };
};

const initializeResult = async (
  pool: DriverPool,
  thread: CuaThread,
  body: JsonRpcRequest,
): Promise<RpcResponse> => {
  const client = await pool.client(thread.id);
  if (!client) return rpcError(body.id, -32000, "CUA Driver is not available on this host.");
  const hello = await client.initialized();
  return withLeaseInstructions({ ...hello, jsonrpc: "2.0", id: body.id });
};

// The lease's rules follow CUA Driver's own instructions, wherever the client reads them.
const withLeaseInstructions = (response: RpcResponse): RpcResponse => {
  if (response.error || !isRecord(response.result)) return response;
  const own = typeof response.result.instructions === "string" ? response.result.instructions : "";
  return {
    ...response,
    result: {
      ...response.result,
      instructions: [own, LEASE_INSTRUCTIONS].filter(Boolean).join("\n\n"),
    },
  };
};

/** What the thread's model reads about the lease, after CUA Driver's own instructions. */
export const LEASE_INSTRUCTIONS =
  "AOP host: one thread at a time uses this computer. Your first CUA call takes the screen for your thread; if another thread has it, the call waits in line and goes through when your turn comes. Give the screen back as soon as you are done: call `end_session` (it also closes the browser you opened and deletes its profile). The host also takes it back when your turn ends, or after 3 minutes without a CUA call.";

export const waitingText = (wait: CuaLeaseWait): string => {
  const who = wait.holder
    ? `"${cuaHolderName(wait.holder)}" is using it`
    : "it is being handed over";
  return `Waiting for computer use: ${who}; this thread is ${cuaLinePlace(wait.position)} in line.`;
};

const stillWaitingText = (wait: CuaLeaseWait): string =>
  `${waitingText(wait)} The call did not run. This thread keeps its place for 2 minutes: call the CUA tool again to keep waiting. Meanwhile you can do work that does not need the screen.`;

const toolOf = (params: unknown): { name: string; args: Record<string, unknown> | undefined } => {
  const value = isRecord(params) ? params : {};
  return {
    name: typeof value.name === "string" ? value.name : "",
    args: isRecord(value.arguments) ? value.arguments : undefined,
  };
};

const progressTokenOf = (params: unknown): string | number | undefined => {
  const meta = isRecord(params) && isRecord(params._meta) ? params._meta : null;
  const token = meta?.progressToken;
  return typeof token === "string" || typeof token === "number" ? token : undefined;
};

const progressNotification = (token: string | number, progress: number, message: string) => ({
  jsonrpc: "2.0",
  method: "notifications/progress",
  params: { progressToken: token, progress, message },
});

const event = (message: unknown): string => `event: message\ndata: ${JSON.stringify(message)}\n\n`;

const json = (message: RpcResponse): Response => Response.json(message);

const rpcResult = (id: unknown, result: unknown): RpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  result,
});

const rpcError = (id: unknown, code: number, message: string): RpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
