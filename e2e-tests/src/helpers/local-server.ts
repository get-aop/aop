import type { Subprocess } from "bun";
import { DEFAULT_LOCAL_SERVER_PORT, DEFAULT_LOCAL_SERVER_URL, LOCAL_SERVER_BIN } from "./constants";

const LOCAL_SERVER_START_TIMEOUT_MS = 30_000;
const PROCESS_OUTPUT_TAIL_LENGTH = 8_000;

export interface LocalServerContext {
  process: Subprocess;
  port: number;
  url: string;
}

export interface StartLocalServerOptions {
  port?: number;
  dbPath?: string;
  env?: Record<string, string>;
}

export const startLocalServer = async (
  options: StartLocalServerOptions = {},
): Promise<LocalServerContext> => {
  const port = options.port ?? DEFAULT_LOCAL_SERVER_PORT;
  const url = `http://localhost:${port}`;

  const env: Record<string, string> = {
    ...process.env,
    AOP_LOCAL_SERVER_PORT: String(port),
    ...options.env,
  };

  if (options.dbPath) {
    env.AOP_DB_PATH = options.dbPath;
  }

  const proc = Bun.spawn({
    cmd: [process.execPath, LOCAL_SERVER_BIN],
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const output = captureProcessOutput(proc);

  // Wait for server to be ready
  const ready = await waitForServerReady(url, { timeout: LOCAL_SERVER_START_TIMEOUT_MS });
  if (!ready) {
    proc.kill();
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      output.stdout,
      output.stderr,
    ]);
    throw new Error(
      `Local server failed to start within ${LOCAL_SERVER_START_TIMEOUT_MS}ms (exit ${exitCode}).` +
        formatProcessOutput(stdout, stderr),
    );
  }

  return { process: proc, port, url };
};

const captureProcessOutput = (
  proc: Subprocess,
): { stdout: Promise<string>; stderr: Promise<string> } => ({
  stdout: captureOutputTail(proc.stdout),
  stderr: captureOutputTail(proc.stderr),
});

const captureOutputTail = async (stream: Subprocess["stdout"]): Promise<string> => {
  if (!(stream instanceof ReadableStream)) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output = `${output}${decoder.decode(value, { stream: true })}`.slice(
        -PROCESS_OUTPUT_TAIL_LENGTH,
      );
    }
    return `${output}${decoder.decode()}`;
  } catch {
    return output;
  }
};

const formatProcessOutput = (stdout: string, stderr: string): string => {
  const details = [
    stdout.trim() ? `stdout:\n${stdout.trim()}` : "",
    stderr.trim() ? `stderr:\n${stderr.trim()}` : "",
  ].filter(Boolean);
  return details.length ? `\n${details.join("\n")}` : "";
};

export const stopLocalServer = async (ctx: LocalServerContext): Promise<void> => {
  ctx.process.kill("SIGTERM");
  await ctx.process.exited;
};

export const isLocalServerRunning = async (url?: string): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

interface WaitForServerReadyOptions {
  timeout?: number;
  pollInterval?: number;
}

const waitForServerReady = async (
  url: string,
  options: WaitForServerReadyOptions = {},
): Promise<boolean> => {
  const { timeout = 10_000, pollInterval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const running = await isLocalServerRunning(url);
    if (running) {
      return true;
    }
    await Bun.sleep(pollInterval);
  }

  return false;
};

export const requireLocalServer = async (url?: string): Promise<void> => {
  const running = await isLocalServerRunning(url);
  if (!running) {
    throw new Error(
      `Local server not running at ${url ?? DEFAULT_LOCAL_SERVER_URL}.\n` +
        "Start it with: bun run apps/local-server/src/run.ts\n" +
        "Or use: bun dev",
    );
  }
};

export const triggerServerRefresh = async (url?: string): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/refresh`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

/**
 * Directly set task status via test-only API endpoint.
 * Requires AOP_TEST_MODE=true on the server.
 */
export const setTaskStatus = async (
  taskId: string,
  status: string,
  url?: string,
): Promise<boolean> => {
  const serverUrl = url ?? DEFAULT_LOCAL_SERVER_URL;
  try {
    const response = await fetch(`${serverUrl}/api/tasks/${taskId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
};
