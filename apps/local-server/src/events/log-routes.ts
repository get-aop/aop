import { existsSync } from "node:fs";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import {
  type ParsedRawLogEntry,
  parseRawJsonlContent,
  type RenderedLogLine,
  renderCompactLogLines,
} from "@aop/llm-provider";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { LocalServerContext } from "../context.ts";
import type { StepLog } from "../db/schema.ts";
import { isProcessAlive as defaultIsProcessAlive } from "../executor/process-utils.ts";
import { getFileSize, readAllLogLines, readLogLines } from "./log-file-tailer.ts";
import { createSSEStreamHelper, type SSEStreamHelper } from "./sse-stream.ts";

interface StepScopedLogLine extends RenderedLogLine {
  stepExecutionId: string;
}

interface StreamingStepLogRenderer {
  push: (rawLines: string[]) => StepScopedLogLine[];
  finish: (rawLines?: string[]) => StepScopedLogLine[];
}

interface LogSSEEvent {
  type: "log";
  stream: "stdout" | "stderr";
  content: string;
  timestamp: string;
  stepExecutionId: string;
}

interface ReplaySSEEvent {
  type: "replay";
  lines: StepScopedLogLine[];
}

interface CompleteSSEEvent {
  type: "complete";
  status: "completed" | "failed" | "cancelled";
}

type SSEEventData = LogSSEEvent | ReplaySSEEvent | CompleteSSEEvent;

const POLL_INTERVAL_MS = 500;

const renderStepLogRecords = (stepLogs: StepLog[]): StepScopedLogLine[] => {
  const groups: StepLog[][] = [];

  for (const log of stepLogs) {
    const current = groups.at(-1);
    if (current?.[0]?.step_execution_id === log.step_execution_id) {
      current.push(log);
    } else {
      groups.push([log]);
    }
  }

  return groups.flatMap((logs) =>
    renderRawLinesForStep(
      logs.map((log) => log.content),
      logs[0]?.step_execution_id ?? "",
      logs[0]?.created_at,
    ),
  );
};

const renderRawLinesForStep = (
  rawLines: string[],
  stepExecutionId: string,
  timestamp?: string,
): StepScopedLogLine[] => {
  const defaultTimestamp = timestamp ?? new Date().toISOString();
  const parsed = parseRawJsonlContent(rawLines.join("\n"));
  const lines = renderCompactLogLines(parsed, { timestamp: defaultTimestamp });
  return lines.map((line) => ({
    ...line,
    stepExecutionId,
  }));
};

const createStreamingStepLogRenderer = (stepExecutionId: string): StreamingStepLogRenderer => {
  let pendingGrokText: ParsedRawLogEntry[] = [];

  const render = (freshLines: string[], flushTrailingGrokText: boolean) => {
    const parsed = parseRawJsonlContent(freshLines.join("\n"));
    const entries = [...pendingGrokText, ...parsed.entries];
    const completedEntryCount = flushTrailingGrokText
      ? entries.length
      : findTrailingGrokTextStart(entries);
    const completedEntries = entries.slice(0, completedEntryCount);
    pendingGrokText = entries.slice(completedEntryCount);

    return renderCompactLogLines(completedEntries).map((line) => ({
      ...line,
      stepExecutionId,
    }));
  };

  return {
    push: (freshLines) => render(freshLines, false),
    finish: (freshLines = []) => render(freshLines, true),
  };
};

const findTrailingGrokTextStart = (entries: ParsedRawLogEntry[]): number => {
  let index = entries.length;
  while (index > 0 && isGrokTextEntry(entries[index - 1])) index -= 1;
  return index;
};

const isGrokTextEntry = (entry: ParsedRawLogEntry | undefined): boolean => {
  return (
    entry?.provider === "grok-build" &&
    entry.event.type === "text" &&
    typeof entry.event.data === "string"
  );
};

const mapExecutionStatus = (status: string): "completed" | "failed" | "cancelled" => {
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "aborted") return "cancelled";
  return "failed";
};

const sendReplayIfExists = async (
  sse: SSEStreamHelper,
  lines: StepScopedLogLine[],
): Promise<boolean> => {
  if (lines.length === 0) return true;
  return sse.sendEvent<SSEEventData>("message", { type: "replay", lines });
};

const sendReplay = async (sse: SSEStreamHelper, lines: StepScopedLogLine[]): Promise<boolean> => {
  return sse.sendEvent<SSEEventData>("message", { type: "replay", lines });
};

const sendComplete = async (
  sse: SSEStreamHelper,
  status: "completed" | "failed" | "cancelled",
): Promise<boolean> => {
  return sse.sendEvent<SSEEventData>("message", { type: "complete", status });
};

const sendLogLines = async (sse: SSEStreamHelper, lines: StepScopedLogLine[]): Promise<boolean> => {
  for (const line of lines) {
    const ok = await sse.sendEvent<SSEEventData>("message", {
      type: "log",
      stream: line.stream,
      content: line.content,
      timestamp: line.timestamp,
      stepExecutionId: line.stepExecutionId,
    });
    if (!ok) return false;
  }
  return true;
};

export interface LogStreamDeps {
  logsDir?: string;
  isProcessAlive?: (pid: number) => boolean;
  pollIntervalMs?: number;
}

export const createLogStreamHandler = (ctx: LocalServerContext, deps: LogStreamDeps = {}) => {
  const {
    logsDir = aopPaths.logs(),
    isProcessAlive = defaultIsProcessAlive,
    pollIntervalMs = POLL_INTERVAL_MS,
  } = deps;

  return async (c: Context) => {
    const executionId = c.req.param("executionId");
    if (!executionId) {
      return c.json({ error: "Execution ID is required" }, 400);
    }

    const execution = await ctx.executionRepository.getExecution(executionId);
    if (!execution) {
      return c.json({ error: "Execution not found" }, 404);
    }

    if (execution.status !== "running") {
      return streamCompletedExecution(c, ctx, executionId, execution.status, logsDir);
    }

    return streamRunningExecution(c, ctx, executionId, {
      logsDir,
      isProcessAlive,
      pollIntervalMs,
    });
  };
};

const streamCompletedExecution = (
  c: Context,
  ctx: LocalServerContext,
  executionId: string,
  status: string,
  logsDir: string,
) => {
  return streamSSE(c, async (stream) => {
    const sse = createSSEStreamHelper(stream);
    const rendered = await getCompletedExecutionReplayLines(ctx, executionId, logsDir);
    await sendReplayIfExists(sse, rendered);
    await sendComplete(sse, mapExecutionStatus(status));
  });
};

const getCompletedExecutionReplayLines = async (
  ctx: LocalServerContext,
  executionId: string,
  logsDir: string,
): Promise<StepScopedLogLine[]> => {
  const stepLogs = await ctx.executionRepository.getStepLogsByExecutionId(executionId);
  const rendered = renderStepLogRecords(stepLogs);
  const latestStep = await findLatestStep(ctx, executionId);

  if (!latestStep) {
    return rendered;
  }

  const persistedLatestStepCount = await ctx.executionRepository.getStepLogCount(latestStep.id);
  const bufferedLatestStepLines = ctx.logBuffer.getLines(latestStep.id);
  const pendingLatestStepLines = bufferedLatestStepLines.slice(persistedLatestStepCount);
  const persistedLatestStepLogs = stepLogs.filter((log) => log.step_execution_id === latestStep.id);
  const pendingLatestStepFileLines = readPendingLatestStepFileLines(
    logsDir,
    latestStep.id,
    persistedLatestStepLogs.map((log) => log.content),
  );

  return [
    ...rendered,
    ...renderRawLinesForStep(pendingLatestStepLines, latestStep.id),
    ...renderRawLinesForStep(pendingLatestStepFileLines, latestStep.id),
  ];
};

const readPendingLatestStepFileLines = (
  logsDir: string,
  stepExecutionId: string,
  persistedLines: string[],
): string[] => {
  const logFile = join(logsDir, `${stepExecutionId}.jsonl`);
  const fileLines = readAllLogLines(logFile);
  if (fileLines.length === 0) return [];

  if (fileLines.length > persistedLines.length) {
    return fileLines.slice(persistedLines.length);
  }

  return persistedLinesHaveSuffix(persistedLines, fileLines) ? [] : fileLines;
};

const persistedLinesHaveSuffix = (persistedLines: string[], fileLines: string[]): boolean => {
  if (fileLines.length > persistedLines.length) return false;
  const offset = persistedLines.length - fileLines.length;
  return fileLines.every((line, index) => persistedLines[offset + index] === line);
};

const streamRunningExecution = async (
  c: Context,
  ctx: LocalServerContext,
  executionId: string,
  deps: Required<LogStreamDeps>,
) => {
  const { logsDir, isProcessAlive, pollIntervalMs } = deps;

  const stepExecution = await findLatestStep(ctx, executionId);
  const candidateLogFile = stepExecution ? join(logsDir, `${stepExecution.id}.jsonl`) : null;
  const logFile = candidateLogFile && existsSync(candidateLogFile) ? candidateLogFile : null;
  const agentPid = stepExecution?.agent_pid ?? null;
  const stepExecutionId = stepExecution?.id ?? null;

  const stepLogs = await ctx.executionRepository.getStepLogsByExecutionId(executionId);
  const historicalRendered = renderStepLogRecords(stepLogs);
  const persistedCurrentStepCount = stepExecutionId
    ? await ctx.executionRepository.getStepLogCount(stepExecutionId)
    : 0;

  const lastEventId = c.req.header("Last-Event-ID");
  const resumeOffset = lastEventId ? Number.parseInt(lastEventId, 10) + 1 : 0;

  return streamSSE(c, async (stream) => {
    const sse = createSSEStreamHelper(stream, resumeOffset);

    if (!logFile || !stepExecutionId) {
      await streamFromLogBuffer(ctx, stepExecutionId, sse, stream, historicalRendered);
      return;
    }

    await streamFromFile({
      sse,
      stream,
      logFile,
      agentPid,
      resumeOffset,
      pollIntervalMs,
      isProcessAlive,
      executionId,
      ctx,
      historicalRendered,
      stepExecutionId,
      persistedLineCount: persistedCurrentStepCount,
    });
  });
};

interface StreamFromFileOptions {
  sse: SSEStreamHelper;
  stream: { close: () => void; onAbort: (fn: () => void) => void };
  logFile: string;
  agentPid: number | null;
  resumeOffset: number;
  pollIntervalMs: number;
  isProcessAlive: (pid: number) => boolean;
  executionId: string;
  ctx: LocalServerContext;
  historicalRendered: StepScopedLogLine[];
  stepExecutionId: string;
  persistedLineCount: number;
  renderer?: StreamingStepLogRenderer;
}

const isAgentDone = async (opts: StreamFromFileOptions): Promise<boolean> => {
  const { agentPid, isProcessAlive, executionId, ctx } = opts;
  if (agentPid) return !isProcessAlive(agentPid);
  const execution = await ctx.executionRepository.getExecution(executionId);
  return execution?.status !== "running";
};

const streamFromFile = async (opts: StreamFromFileOptions): Promise<void> => {
  const { sse, logFile, resumeOffset, historicalRendered, stepExecutionId, persistedLineCount } =
    opts;

  const fileStartOffset = Math.max(persistedLineCount, resumeOffset);
  const snapshot = readLogLines(logFile, fileStartOffset);
  const renderer = createStreamingStepLogRenderer(stepExecutionId);
  opts.renderer = renderer;
  const agentDone = await isAgentDone(opts);
  const liveRendered = agentDone ? renderer.finish(snapshot.lines) : renderer.push(snapshot.lines);
  const replayLines = [...historicalRendered, ...liveRendered];
  const sent = await sendReplay(sse, replayLines);
  if (!sent) return;

  sse.setNextEventId(Math.max(snapshot.lineCount, resumeOffset));

  const state = { lineCount: snapshot.lineCount, fileSize: getFileSize(logFile) };

  if (agentDone) {
    await finishFromFile(opts, state.lineCount);
    return;
  }

  await pollFileUntilDone(opts, state);
};

interface PollState {
  lineCount: number;
  fileSize: number;
}

const pollFileUntilDone = (opts: StreamFromFileOptions, state: PollState): Promise<void> => {
  const { sse, stream, pollIntervalMs } = opts;

  return new Promise<void>((resolve) => {
    const stop = (intervalId: ReturnType<typeof setInterval>) => {
      clearInterval(intervalId);
      resolve();
    };

    const interval = setInterval(async () => {
      if (sse.isCleanedUp()) return stop(interval);

      await pollOnce(opts, state);

      if (await isAgentDone(opts)) {
        clearInterval(interval);
        await finishFromFile(opts, state.lineCount);
        resolve();
      }
    }, pollIntervalMs);

    sse.registerCleanup(() => clearInterval(interval));
    stream.onAbort(() => stop(interval));
  });
};

const pollOnce = async (opts: StreamFromFileOptions, state: PollState): Promise<void> => {
  const { sse, logFile, stepExecutionId } = opts;
  const newSize = getFileSize(logFile);
  if (newSize <= state.fileSize) return;

  state.fileSize = newSize;
  const fresh = readLogLines(logFile, state.lineCount);
  const rendered =
    opts.renderer?.push(fresh.lines) ?? renderRawLinesForStep(fresh.lines, stepExecutionId);
  await sendLogLines(sse, rendered);
  state.lineCount = fresh.lineCount;
};

const findLatestStep = async (ctx: LocalServerContext, executionId: string) => {
  const steps = await ctx.executionRepository.getStepExecutionsByExecutionId(executionId);
  return steps.length > 0 ? steps[steps.length - 1] : null;
};

const finishFromFile = async (
  opts: StreamFromFileOptions,
  currentLineCount: number,
): Promise<void> => {
  const { sse, stream, logFile, executionId, ctx } = opts;

  const remaining = readLogLines(logFile, currentLineCount);
  const rendered =
    opts.renderer?.finish(remaining.lines) ??
    renderRawLinesForStep(remaining.lines, opts.stepExecutionId);
  await sendLogLines(sse, rendered);

  const execution = await ctx.executionRepository.getExecution(executionId);
  const status = execution ? mapExecutionStatus(execution.status) : "failed";
  await sendComplete(sse, status);
  sse.runCleanup();
  stream.close();
};

const streamFromLogBuffer = async (
  ctx: LocalServerContext,
  stepExecutionId: string | null,
  sse: SSEStreamHelper,
  stream: { close: () => void },
  historicalRendered: StepScopedLogLine[] = [],
): Promise<void> => {
  if (!stepExecutionId) {
    await sendComplete(sse, "failed");
    stream.close();
    return;
  }

  const renderer = createStreamingStepLogRenderer(stepExecutionId);
  let completionHandled = false;

  const handleCompletion = (status: "completed" | "failed" | "cancelled") => {
    if (completionHandled || sse.isCleanedUp()) return;
    completionHandled = true;
    sendLogLines(sse, renderer.finish())
      .then(() => sendComplete(sse, status))
      .finally(() => {
        sse.runCleanup();
        stream.close();
      });
  };

  const unsubscribeLog = ctx.logBuffer.subscribe(async (event) => {
    if (event.stepExecutionId !== stepExecutionId) return;
    const rendered = renderer.push([event.line]);
    for (const line of rendered) {
      await sse.sendEvent<SSEEventData>("message", {
        type: "log",
        stream: line.stream,
        content: line.content,
        timestamp: line.timestamp,
        stepExecutionId: line.stepExecutionId,
      });
    }
  });
  sse.registerCleanup(unsubscribeLog);

  const unsubscribeComplete = ctx.logBuffer.subscribeComplete((event) => {
    if (event.stepExecutionId !== stepExecutionId) return;
    handleCompletion(event.status);
  });
  sse.registerCleanup(unsubscribeComplete);

  const existingLines = ctx.logBuffer.getLines(stepExecutionId);
  const existingStatus = ctx.logBuffer.getStatus(stepExecutionId);
  const rendered = [
    ...historicalRendered,
    ...(existingStatus ? renderer.finish(existingLines) : renderer.push(existingLines)),
  ];
  const sent = await sendReplay(sse, rendered);
  if (!sent) return;

  if (existingStatus && !completionHandled) {
    completionHandled = true;
    await sendComplete(sse, existingStatus);
    sse.runCleanup();
    stream.close();
    return;
  }

  await new Promise(() => {});
};
