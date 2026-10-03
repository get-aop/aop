import { getLogger } from "@aop/infra";

const logger = getLogger("computer-use");

/**
 * One `cua-driver mcp` process the host runs for a thread, spoken to over stdio (newline-delimited
 * JSON-RPC, as MCP's stdio transport defines it). The host stands between the thread and the
 * driver (see mcp-gate.ts), so it can hold calls back for the lease and end what a thread left
 * open when the lease moves on.
 */
export interface DriverClient {
  /** Sends a request and resolves with its JSON-RPC response (`result` or `error`). */
  request: (method: string, params?: unknown, timeoutMs?: number) => Promise<RpcResponse>;
  /** The driver's answer to `initialize`, asked once. */
  initialized: () => Promise<RpcResponse>;
  /** Ends the process: stdin closes, then SIGTERM if it lingers. */
  close: () => Promise<void>;
  exited: () => boolean;
}

export interface RpcResponse {
  jsonrpc: "2.0";
  id: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface DriverProcess {
  write: (line: string) => void;
  /** Lines the driver prints on stdout. */
  lines: AsyncIterable<string>;
  /** Closes stdin, which tells an MCP stdio server to exit. */
  end: () => void;
  kill: () => void;
  exited: Promise<number | null>;
}

export type SpawnDriver = () => DriverProcess;

export const CLIENT_INFO = { name: "aop-host", version: "1.0.0" };
export const PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const EXIT_GRACE_MS = 3_000;

export const createDriverClient = (spawn: SpawnDriver): DriverClient => {
  const proc = spawn();
  let nextId = 1;
  let gone = false;
  const pending = new Map<number, (response: RpcResponse) => void>();

  const failAll = (message: string) => {
    for (const [id, resolve] of pending) {
      resolve({ jsonrpc: "2.0", id, error: { code: -32000, message } });
    }
    pending.clear();
  };

  void proc.exited.then((code) => {
    gone = true;
    failAll(`cua-driver exited (code ${code ?? "unknown"})`);
  });

  const handleLine = (line: string) => {
    const message = parseMessage(line);
    if (!message) return;
    if ("method" in message && message.id !== undefined) {
      // The driver asking the client something (roots, elicitation): the host offers none.
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "Not supported by the AOP host" },
      });
      return;
    }
    if (typeof message.id !== "number") return;
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message as RpcResponse);
  };

  const send = (message: unknown) => {
    if (gone) return;
    try {
      proc.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      logger.warn("Writing to cua-driver failed: {error}", { error: String(error) });
    }
  };

  void (async () => {
    try {
      for await (const line of proc.lines) handleLine(line);
    } catch (error) {
      logger.warn("Reading cua-driver's output failed: {error}", { error: String(error) });
    }
  })();

  const request: DriverClient["request"] = (method, params, timeoutMs = DEFAULT_TIMEOUT_MS) => {
    const id = nextId++;
    if (gone) {
      return Promise.resolve({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: "cua-driver is not running" },
      });
    }
    return new Promise<RpcResponse>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve({ jsonrpc: "2.0", id, error: { code: -32001, message: `${method} timed out` } });
      }, timeoutMs);
      timer.unref?.();
      pending.set(id, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
      send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) });
    });
  };

  let handshake: Promise<RpcResponse> | null = null;
  const initialized = () => {
    handshake ??= request(
      "initialize",
      { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      30_000,
    ).then((response) => {
      if (!response.error) send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return response;
    });
    return handshake;
  };

  return {
    request: async (method, params, timeoutMs) => {
      const hello = await initialized();
      if (hello.error) return { ...hello, id: null };
      return request(method, params, timeoutMs);
    },
    initialized,
    close: async () => {
      if (gone) return;
      proc.end();
      const exited = await Promise.race([
        proc.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), EXIT_GRACE_MS)),
      ]);
      if (!exited) proc.kill();
      gone = true;
      failAll("cua-driver was closed");
    },
    exited: () => gone,
  };
};

const parseMessage = (line: string): (Partial<RpcResponse> & { method?: string }) | null => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    return value && typeof value === "object" ? (value as Partial<RpcResponse>) : null;
  } catch {
    return null;
  }
};

/** Runs `command mcp` with `env`, its stderr into the host's log at debug level. */
export const spawnDriverProcess =
  (command: string, env: Record<string, string | undefined>): SpawnDriver =>
  () => {
    const child = Bun.spawn([command, "mcp"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    void drainStderr(child.stderr);
    return {
      write: (line) => {
        child.stdin.write(line);
        child.stdin.flush();
      },
      lines: readLines(child.stdout),
      end: () => {
        try {
          child.stdin.end();
        } catch {
          // Already closed.
        }
      },
      kill: () => child.kill("SIGTERM"),
      exited: child.exited,
    };
  };

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      yield buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  if (buffer.trim()) yield buffer;
}

const drainStderr = async (stream: ReadableStream<Uint8Array>) => {
  for await (const line of readLines(stream)) {
    if (line.trim()) logger.debug("cua-driver: {line}", { line });
  }
};
