import { type FileHandle, open } from "node:fs/promises";
import { extractRuntimeSessionIdFromRawJsonl } from "@aop/llm-provider";

interface RuntimeSessionLineInspectorInput {
  onSession: (sessionId: string) => Promise<void> | void;
}

export const createRuntimeSessionLineInspector = (input: RuntimeSessionLineInspectorInput) => {
  let reportedSessionId: string | null = null;
  let inFlight: Promise<boolean> | null = null;

  return async (line: string): Promise<boolean> => {
    if (!line.trim()) return Boolean(reportedSessionId);
    if (reportedSessionId) return true;
    if (inFlight) return inFlight;
    const sessionId = extractRuntimeSessionIdFromRawJsonl(line);
    if (!sessionId) return false;
    inFlight = Promise.resolve(input.onSession(sessionId))
      .then(() => {
        reportedSessionId = sessionId;
        return true;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
};

export const startRuntimeSessionTail = (input: {
  logFilePath: string;
  onSession: (sessionId: string) => Promise<void> | void;
  pollIntervalMs?: number;
}): (() => Promise<void>) => {
  let stopped = false;
  let found = false;
  let offset = 0;
  let lineBuffer = "";
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const inspectLine = createRuntimeSessionLineInspector(input);

  const consume = async (chunk: string): Promise<boolean> => {
    lineBuffer += chunk;
    const lines = lineBuffer.split("\n");
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (await inspectLine(line)) return true;
    }
    return false;
  };

  const pollOnce = async (): Promise<void> => {
    const next = await readNewBytes(input.logFilePath, offset);
    if (!next) return;
    offset = next.offset;
    if (await consume(next.chunk)) found = true;
  };

  const flushResidual = async (): Promise<void> => {
    await pollOnce();
    if (!found && lineBuffer.trim()) found = await inspectLine(lineBuffer);
  };

  const loop = (async () => {
    while (!stopped && !found) {
      await pollOnce();
      if (!found) await Bun.sleep(pollIntervalMs);
    }
    if (!found) await flushResidual();
  })();

  return async () => {
    stopped = true;
    await loop;
  };
};

const readNewBytes = async (
  path: string,
  offset: number,
): Promise<{ chunk: string; offset: number } | null> => {
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, "r");
    const stat = await handle.stat();
    if (stat.size <= offset) return null;
    const buffer = Buffer.alloc(stat.size - offset);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead <= 0) return null;
    return { chunk: buffer.subarray(0, bytesRead).toString("utf8"), offset: offset + bytesRead };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
};
