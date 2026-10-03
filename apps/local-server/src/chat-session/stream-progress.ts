import type { TurnPart } from "@aop/common";
import { createLogReader, type LogReader } from "./log-reader.ts";
import { type ProgressChunk, parseStreamProgressLines } from "./stream-progress-parse.ts";
import { createTurnAccumulator } from "./turn-accumulator.ts";

export { parseStreamProgressLine, parseStreamProgressLines } from "./stream-progress-parse.ts";

/** Hears the turn so far, as its ordered parts, whenever the log adds to it. */
export type StreamProgressListener = (parts: TurnPart[]) => void;

interface TailState {
  stopped: boolean;
  reader: LogReader;
  lineBuffer: string;
  lastEmitAt: number;
  pending: TurnPart[] | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Poll a growing JSONL log and emit the turn's parts so far.
 * Providers write stdout to a file; we do not depend on onOutput for streaming.
 */
export const startLogProgressTail = (input: {
  logFilePath: string;
  /** The uuid of the run's own prompt, which Claude echoes and is no steer. */
  promptUuid?: string;
  onProgress: StreamProgressListener;
  onLine?: (line: string) => Promise<void> | void;
  minEmitIntervalMs?: number;
  pollIntervalMs?: number;
  /** When a tool call is first seen; the tail reads the log as it grows, so that is when it started. */
  now?: () => string;
}): (() => Promise<void>) => {
  const minEmitIntervalMs = input.minEmitIntervalMs ?? 100;
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const accumulator = createTurnAccumulator({
    promptUuid: input.promptUuid,
    now: input.now ?? (() => new Date().toISOString()),
  });
  const state: TailState = {
    stopped: false,
    reader: createLogReader(input.logFilePath),
    lineBuffer: "",
    lastEmitAt: 0,
    pending: null,
    flushTimer: null,
  };

  const emit = (parts: TurnPart[], force = false) => {
    emitThrottled(state, parts, force, minEmitIntervalMs, input.onProgress);
  };

  const consumeChunk = async (chunk: string): Promise<void> => {
    state.lineBuffer += chunk;
    const lines = state.lineBuffer.split("\n");
    state.lineBuffer = lines.pop() ?? "";
    const parsed: ProgressChunk[] = [];
    for (const line of lines) {
      await input.onLine?.(line);
      parsed.push(...parseStreamProgressLines(line));
    }
    if (parsed.length > 0) emit(accumulator.applyAll(parsed));
  };

  const tailLoop = runTailLoop(state, pollIntervalMs, consumeChunk, async () => {
    await flushResidual(state, accumulator, emit, input.onLine);
  });

  return async () => {
    state.stopped = true;
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    await tailLoop;
  };
};

const emitThrottled = (
  state: TailState,
  parts: TurnPart[],
  force: boolean,
  minEmitIntervalMs: number,
  onProgress: StreamProgressListener,
): void => {
  const now = Date.now();
  if (!force && now - state.lastEmitAt < minEmitIntervalMs) {
    schedulePending(state, parts, minEmitIntervalMs, onProgress);
    return;
  }
  state.lastEmitAt = now;
  state.pending = null;
  onProgress(parts);
};

const schedulePending = (
  state: TailState,
  parts: TurnPart[],
  minEmitIntervalMs: number,
  onProgress: StreamProgressListener,
): void => {
  state.pending = parts;
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    if (!state.pending) return;
    state.lastEmitAt = Date.now();
    onProgress(state.pending);
    state.pending = null;
  }, minEmitIntervalMs);
};

const runTailLoop = async (
  state: TailState,
  pollIntervalMs: number,
  consumeChunk: (chunk: string) => Promise<void>,
  onStop: () => Promise<void>,
): Promise<void> => {
  while (!state.stopped) {
    await readAndConsume(state, consumeChunk);
    await sleep(pollIntervalMs);
  }
  await readAndConsume(state, consumeChunk);
  await onStop();
};

const readAndConsume = async (
  state: TailState,
  consumeChunk: (chunk: string) => Promise<void>,
): Promise<void> => {
  const chunk = await state.reader.read();
  if (chunk) await consumeChunk(chunk);
};

const flushResidual = async (
  state: TailState,
  accumulator: ReturnType<typeof createTurnAccumulator>,
  emit: (parts: TurnPart[], force?: boolean) => void,
  onLine: ((line: string) => Promise<void> | void) | undefined,
): Promise<void> => {
  state.lineBuffer += state.reader.end();
  if (state.lineBuffer.trim()) {
    await onLine?.(state.lineBuffer);
    const parsed = parseStreamProgressLines(state.lineBuffer);
    if (parsed.length > 0) emit(accumulator.applyAll(parsed), true);
  }
  if (state.pending) emit(state.pending, true);
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
