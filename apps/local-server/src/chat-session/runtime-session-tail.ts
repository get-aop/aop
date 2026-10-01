import { extractRuntimeSessionIdFromRawJsonl } from "@aop/llm-provider";
import { createLogReader } from "./log-reader.ts";

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
  const reader = createLogReader(input.logFilePath);
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
    const chunk = await reader.read();
    if (chunk && (await consume(chunk))) found = true;
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
