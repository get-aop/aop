import { type FileHandle, open } from "node:fs/promises";
import { type ProgressChunk, parseStreamProgressLines } from "./stream-progress-parse.ts";

export { parseStreamProgressLine, parseStreamProgressLines } from "./stream-progress-parse.ts";

/** One shell command row inside a Codex-style "Ran N commands" group. */
export interface StreamCommandRow {
  id: string;
  command: string;
  detail?: string;
  /** Tool result text when the provider emits a completion payload. */
  result?: string;
  status: "running" | "done" | "failed";
  exitCode?: number | null;
}

export interface StreamCommandGroup {
  id: string;
  commands: StreamCommandRow[];
}

export interface StreamProgressSnapshot {
  /** Model reasoning only (not tool/command noise). */
  thinking: string;
  /**
   * Assistant status + answer prose so far. Intermediate status runs are sealed
   * and stacked (blank-line separated) so the UI keeps agent progress history.
   */
  content: string;
  /** Tool/command batches for Codex-style collapsible "Ran N commands". */
  commandGroups: StreamCommandGroup[];
}

export type StreamProgressListener = (snapshot: StreamProgressSnapshot) => void;

export const createStreamProgressAccumulator = () => {
  let thinking = "";
  /** Sealed intermediate status narrations (shown as stacked white paragraphs). */
  let sealedContent = "";
  /** Live text run currently streaming (status or final answer). */
  let content = "";
  /** Providers that re-emit full messages — replace rather than append when longer. */
  let lastFullText = "";
  const commandGroups: StreamCommandGroup[] = [];
  let groupSeq = 0;
  let commandSeq = 0;
  /** After text, the next command starts a new collapsible group (Codex interleaving). */
  let sealCommandsAfterText = false;
  /**
   * Status narration and later answer text are separate runs broken by thought/tool
   * events. Seal the previous paragraph into history so the UI stacks agent updates
   * instead of replacing the same block. Final message content still comes from the
   * provider log extractor (last text run only).
   */
  let startNewTextRun = false;

  const snapshot = (): StreamProgressSnapshot => ({
    thinking,
    content: joinSealedContent(sealedContent, content),
    commandGroups: commandGroups.map((group) => ({
      ...group,
      commands: group.commands.map((row) => ({ ...row })),
    })),
  });

  return {
    apply(chunk: ProgressChunk): StreamProgressSnapshot {
      mutate(chunk);
      return snapshot();
    },
    applyAll(chunks: ProgressChunk[]): StreamProgressSnapshot {
      for (const chunk of chunks) mutate(chunk);
      return snapshot();
    },
    get: (): StreamProgressSnapshot => snapshot(),
  };

  function mutate(chunk: ProgressChunk): void {
    switch (chunk.kind) {
      case "thought":
        // Providers (e.g. Pi) re-carry the full reasoning block on later message
        // lifecycle events; a trailing duplicate is a replay, not new reasoning.
        if (thinking.endsWith(chunk.data)) return;
        thinking = thinking ? thinking + chunk.data : chunk.data;
        startNewTextRun = true;
        return;
      case "text":
        applyText(chunk.data);
        return;
      case "command":
        startNewTextRun = true;
        applyCommand(chunk);
        return;
      case "tool":
        startNewTextRun = true;
        applyTool(chunk);
        return;
    }
  }

  function applyText(data: string): void {
    // PI replays the completed assistant message in turn_end after tool execution.
    if (startNewTextRun && data === content) return;
    if (startNewTextRun) {
      sealedContent = sealTextRun(sealedContent, content);
      content = "";
      lastFullText = "";
      startNewTextRun = false;
    }
    content = mergeTextChunk(content, lastFullText, data);
    lastFullText = content;
    sealCommandsAfterText = true;
  }

  function openGroup(): StreamCommandGroup {
    const group: StreamCommandGroup = { id: `cg_${++groupSeq}`, commands: [] };
    commandGroups.push(group);
    sealCommandsAfterText = false;
    return group;
  }

  function activeGroup(): StreamCommandGroup {
    const last = commandGroups[commandGroups.length - 1];
    if (!last || sealCommandsAfterText) return openGroup();
    return last;
  }

  function applyCommand(chunk: Extract<ProgressChunk, { kind: "command" }>): void {
    if (chunk.phase === "start") {
      activeGroup().commands.push(
        newCommandRow(chunk.itemId, chunk.command, "running", undefined, chunk.detail),
      );
      return;
    }
    const match = findCommandRow(chunk);
    if (chunk.phase === "update") {
      applyCommandUpdate(chunk, match);
      return;
    }
    applyCommandDone(chunk, match);
  }

  function applyCommandUpdate(
    chunk: Extract<ProgressChunk, { kind: "command" }>,
    match: StreamCommandRow | undefined,
  ): void {
    if (match) {
      match.status = "running";
      match.exitCode = null;
      match.detail = chunk.detail ?? match.detail;
      return;
    }
    activeGroup().commands.push(
      newCommandRow(chunk.itemId, chunk.command, "running", undefined, chunk.detail),
    );
  }

  function applyCommandDone(
    chunk: Extract<ProgressChunk, { kind: "command" }>,
    match: StreamCommandRow | undefined,
  ): void {
    const status = commandDoneStatus(chunk.exitCode);
    if (match) {
      match.status = status;
      match.exitCode = chunk.exitCode ?? null;
      match.detail = chunk.detail ?? match.detail;
      return;
    }
    activeGroup().commands.push(
      newCommandRow(chunk.itemId, chunk.command, status, chunk.exitCode, chunk.detail),
    );
  }

  function newCommandRow(
    itemId: string | undefined,
    command: string,
    status: StreamCommandRow["status"],
    exitCode?: number | null,
    detail?: string,
    result?: string,
  ): StreamCommandRow {
    return {
      id: itemId ?? `cmd_${++commandSeq}`,
      command,
      ...(detail ? { detail } : {}),
      ...(result ? { result } : {}),
      status,
      exitCode: exitCode ?? null,
    };
  }

  function findCommandRow(
    chunk: Extract<ProgressChunk, { kind: "command" }>,
  ): StreamCommandRow | undefined {
    for (const group of [...commandGroups].reverse()) {
      const match =
        group.commands.find((row) => row.id === chunk.itemId) ??
        group.commands.find((row) => row.command === chunk.command && row.status === "running") ??
        group.commands.find((row) => row.command === chunk.command);
      if (match) return match;
    }
    return undefined;
  }

  function commandDoneStatus(exitCode: number | null | undefined): StreamCommandRow["status"] {
    return exitCode != null && exitCode !== 0 ? "failed" : "done";
  }

  function applyTool(chunk: Extract<ProgressChunk, { kind: "tool" }>): void {
    // Keep one activity shape across providers while preserving tool-specific context.
    if (chunk.phase !== "done") {
      applyCommand({
        kind: "command",
        phase: chunk.phase,
        command: chunk.name,
        itemId: chunk.itemId,
        detail: chunk.detail,
      });
      return;
    }
    applyToolDone(chunk);
  }

  function applyToolDone(chunk: Extract<ProgressChunk, { kind: "tool" }>): void {
    const failed = chunk.failed === true;
    const status: StreamCommandRow["status"] = failed ? "failed" : "done";
    const exitCode = failed ? 1 : 0;
    const match = findCommandRow({
      kind: "command",
      phase: "done",
      command: chunk.name,
      itemId: chunk.itemId,
      detail: chunk.detail,
      exitCode,
    });
    if (match) {
      match.status = status;
      match.exitCode = exitCode;
      match.detail = chunk.detail ?? match.detail;
      if (chunk.result) match.result = chunk.result;
      return;
    }
    activeGroup().commands.push(
      newCommandRow(chunk.itemId, chunk.name, status, exitCode, chunk.detail, chunk.result),
    );
  }
};

const mergeTextChunk = (content: string, lastFullText: string, data: string): string => {
  if (lastFullText && data.startsWith(lastFullText)) return data;
  if (data.length > 40 && content && data.includes(content.slice(0, 20))) return data;
  // OpenCode sometimes re-sends cumulative text with slight whitespace differences.
  if (content && data.length > content.length && data.includes(content.trim().slice(0, 30))) {
    return data;
  }
  return content + data;
};

/** Push a finished status paragraph into history so later runs stack below it. */
const sealTextRun = (sealed: string, live: string): string => {
  const trimmed = live.trim();
  if (!trimmed) return sealed;
  return sealed ? `${sealed}\n\n${trimmed}` : trimmed;
};

const joinSealedContent = (sealed: string, live: string): string => {
  if (sealed && live) return `${sealed}\n\n${live}`;
  return sealed || live;
};

/**
 * Merge sealed stream narrations with the authoritative final answer so the
 * activity panel keeps intermediate status history after the run ends.
 * Message body still uses the provider's final text alone.
 *
 * Partial last runs are spliced by suffix/prefix overlap (not blank-line split),
 * so multi-paragraph finals and short answers like "OK" stay correct.
 */
export const finalizeActivityContent = (
  streamed: string,
  finalText: string,
  interrupted = false,
): string => {
  if (interrupted) return streamed || finalText;
  const stream = streamed.trimEnd();
  const final = finalText.trim();
  if (!stream) return finalText;
  if (!final) return streamed;
  if (stream === final || stream.endsWith(final)) return stream;
  return mergeStreamedWithFinal(stream, final);
};

/**
 * If a suffix of streamed is a prefix of finalText, replace that suffix with the
 * full final. Otherwise append final as a new stacked paragraph.
 */
const mergeStreamedWithFinal = (streamed: string, finalText: string): string => {
  const overlap = longestAcceptableSuffixPrefix(streamed, finalText);
  if (overlap <= 0) return `${streamed}\n\n${finalText}`;
  return streamed.slice(0, streamed.length - overlap) + finalText;
};

/** Longest k where streamed ends with finalText[0..k) and the match is safe to splice. */
const longestAcceptableSuffixPrefix = (streamed: string, finalText: string): number => {
  const maxK = Math.min(streamed.length, finalText.length);
  for (let k = maxK; k >= 1; k--) {
    const prefix = finalText.slice(0, k);
    if (!streamed.endsWith(prefix)) continue;
    if (isAcceptablePartialOverlap(streamed, prefix, finalText)) return k;
  }
  return 0;
};

/**
 * Reject tiny accidental overlaps (trailing "e" vs "entire…") while allowing
 * short true partials at paragraph boundaries ("…\n\nO" → "OK").
 */
const isAcceptablePartialOverlap = (
  streamed: string,
  prefix: string,
  finalText: string,
): boolean => {
  const minLen = Math.min(12, finalText.length);
  if (prefix.length >= minLen) return true;
  const before = streamed.slice(0, streamed.length - prefix.length);
  return before.length === 0 || before.endsWith("\n\n");
};

interface TailState {
  stopped: boolean;
  offset: number;
  lineBuffer: string;
  lastEmitAt: number;
  pending: StreamProgressSnapshot | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Poll a growing JSONL log and emit cumulative thought/text progress.
 * Providers write stdout to a file; we do not depend on onOutput for streaming.
 */
export const startLogProgressTail = (input: {
  logFilePath: string;
  onProgress: StreamProgressListener;
  onLine?: (line: string) => Promise<void> | void;
  minEmitIntervalMs?: number;
  pollIntervalMs?: number;
}): (() => Promise<void>) => {
  const minEmitIntervalMs = input.minEmitIntervalMs ?? 100;
  const pollIntervalMs = input.pollIntervalMs ?? 100;
  const accumulator = createStreamProgressAccumulator();
  const state: TailState = {
    stopped: false,
    offset: 0,
    lineBuffer: "",
    lastEmitAt: 0,
    pending: null,
    flushTimer: null,
  };

  const emit = (snapshot: StreamProgressSnapshot, force = false) => {
    emitThrottled(state, snapshot, force, minEmitIntervalMs, input.onProgress);
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

  const tailLoop = runTailLoop(input.logFilePath, state, pollIntervalMs, consumeChunk, async () => {
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
  snapshot: StreamProgressSnapshot,
  force: boolean,
  minEmitIntervalMs: number,
  onProgress: StreamProgressListener,
): void => {
  const now = Date.now();
  if (!force && now - state.lastEmitAt < minEmitIntervalMs) {
    schedulePending(state, snapshot, minEmitIntervalMs, onProgress);
    return;
  }
  state.lastEmitAt = now;
  state.pending = null;
  onProgress(snapshot);
};

const schedulePending = (
  state: TailState,
  snapshot: StreamProgressSnapshot,
  minEmitIntervalMs: number,
  onProgress: StreamProgressListener,
): void => {
  state.pending = snapshot;
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
  logFilePath: string,
  state: TailState,
  pollIntervalMs: number,
  consumeChunk: (chunk: string) => Promise<void>,
  onStop: () => Promise<void>,
): Promise<void> => {
  while (!state.stopped) {
    await readAndConsume(logFilePath, state, consumeChunk);
    await sleep(pollIntervalMs);
  }
  await readAndConsume(logFilePath, state, consumeChunk);
  await onStop();
};

const readAndConsume = async (
  logFilePath: string,
  state: TailState,
  consumeChunk: (chunk: string) => Promise<void>,
): Promise<void> => {
  const next = await readNewBytes(logFilePath, state.offset);
  if (!next) return;
  state.offset = next.offset;
  await consumeChunk(next.chunk);
};

const flushResidual = async (
  state: TailState,
  accumulator: ReturnType<typeof createStreamProgressAccumulator>,
  emit: (snapshot: StreamProgressSnapshot, force?: boolean) => void,
  onLine: ((line: string) => Promise<void> | void) | undefined,
): Promise<void> => {
  if (state.lineBuffer.trim()) {
    await onLine?.(state.lineBuffer);
    const parsed = parseStreamProgressLines(state.lineBuffer);
    if (parsed.length > 0) emit(accumulator.applyAll(parsed), true);
  }
  if (state.pending) emit(state.pending, true);
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

    const length = stat.size - offset;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    if (bytesRead <= 0) return null;
    return {
      chunk: buffer.subarray(0, bytesRead).toString("utf-8"),
      offset: offset + bytesRead,
    };
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
