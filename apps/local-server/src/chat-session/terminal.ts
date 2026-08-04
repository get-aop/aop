import type { TerminalLine } from "@aop/common";
import { resolveExecHost } from "@aop/infra";
import { publishChatSessionEvent } from "./session-events.ts";

export type { TerminalLine };

const DEFAULT_TIMEOUT_MS = 30_000;

export const runTerminalCommand = async (input: {
  sessionId: string;
  cwd: string;
  command: string;
  timeoutMs?: number;
  publish?: boolean;
}): Promise<TerminalLine[]> => {
  const command = input.command.trim();
  if (!command) return [];

  const lines: TerminalLine[] = [];
  const publishLine = (line: TerminalLine) => {
    lines.push(line);
    if (input.publish !== false) {
      publishChatSessionEvent({
        type: "terminal-line",
        sessionId: input.sessionId,
        text: line.text,
        tone: line.tone,
      });
    }
  };

  publishLine({ text: `$ ${command}`, tone: "cmd" });

  try {
    await executeShell(command, input.cwd, input.timeoutMs ?? DEFAULT_TIMEOUT_MS, publishLine);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishLine({ text: `error: ${message}`, tone: "meta" });
  }

  return lines;
};

const executeShell = async (
  command: string,
  cwd: string,
  timeoutMs: number,
  publishLine: (line: TerminalLine) => void,
): Promise<void> => {
  const host = resolveExecHost();
  const detached = host.kind === "native-unix";
  const proc = host.spawn({
    cmd: ["sh", "-c", command],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    detached,
  });

  let killedByTimeout = false;
  const timer = setTimeout(() => {
    killedByTimeout = true;
    terminateProcess(proc, detached);
  }, timeoutMs);

  const stdoutTask = streamLines(proc.stdout, publishLine);
  const stderrTask = streamLines(proc.stderr, publishLine);
  const exitCode = await proc.exited;
  await Promise.all([stdoutTask, stderrTask]);
  clearTimeout(timer);

  if (killedByTimeout || exitCode === null) {
    publishLine({ text: `killed after ${timeoutMs}ms timeout`, tone: "meta" });
    return;
  }
  publishLine({ text: `exit ${exitCode}`, tone: "meta" });
};

const terminateProcess = (proc: Bun.Subprocess, detached: boolean): void => {
  try {
    if (detached) {
      process.kill(-proc.pid, "SIGTERM");
    } else {
      proc.kill();
    }
  } catch {
    try {
      proc.kill();
    } catch {
      // The process already exited.
    }
  }
};

const streamLines = async (
  stream: unknown,
  publishLine: (line: TerminalLine) => void,
): Promise<void> => {
  if (!stream || typeof stream === "number") return;

  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = flushCompleteLines(buffer, publishLine);
    }
    buffer += decoder.decode();
    if (buffer.length > 0) {
      publishLine({ text: buffer.replace(/\r$/, ""), tone: "out" });
    }
  } finally {
    reader.releaseLock();
  }
};

const flushCompleteLines = (buffer: string, publishLine: (line: TerminalLine) => void): string => {
  const parts = buffer.split("\n");
  const remainder = parts.pop() ?? "";
  for (const part of parts) {
    const text = part.replace(/\r$/, "");
    if (text.length > 0) publishLine({ text, tone: "out" });
  }
  return remainder;
};
