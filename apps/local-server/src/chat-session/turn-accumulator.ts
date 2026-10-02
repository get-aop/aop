import {
  type ProsePart,
  TOOL_DETAIL_MAX_LENGTH,
  TOOL_NAME_MAX_LENGTH,
  type ToolPart,
  type TurnPart,
} from "@aop/common";
import { typeIdFromUuid } from "@aop/infra";
import type { ProgressChunk } from "./stream-progress-parse.ts";
import { clip } from "./turn-parts.ts";

type CommandChunk = Extract<ProgressChunk, { kind: "command" }>;
type ArtifactChunk = Extract<ProgressChunk, { kind: "artifact" }>;
type ToolChunk = Extract<ProgressChunk, { kind: "tool" }>;
type StreamStart = Extract<ProgressChunk, { kind: "stream-start" }>;
type StreamDelta = Extract<ProgressChunk, { kind: "stream-delta" }>;
type ProseBlock = StreamDelta["block"];

interface ToolUpdate {
  itemId: string | undefined;
  /** Absent on a result, which names no tool and only settles the call it answers. */
  name: string | undefined;
  detail: string | undefined;
  status: ToolPart["status"];
  /** For runtimes with no call ids: the detail that identifies the running call. */
  matchDetail?: string;
}

/** The AOP tools that make artifacts, as a turn's parts name them (see humanizeToolName). */
const ARTIFACT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "mcp aop aop artifact create",
  "mcp aop aop artifact update",
]);

/** A shell command runs as a tool call of this name, with the command line as its detail. */
const SHELL_TOOL_NAME = "Shell";

/**
 * Folds a run's progress chunks into the parts of its turn, in the order the runtime produced
 * them: a text run, the tool calls made after it, the reasoning before the next run, and so on.
 * Runtimes that re-send a whole message (Pi's lifecycle events, cumulative text) are merged, not
 * repeated. Claude's partial messages grow a part token by token; the finished block that
 * follows settles that part instead of adding another. A user message Claude echoes where the
 * model took it, other than the turn's own prompt (`promptUuid`), is a steer part there. What it
 * returns is the turn so far, without blank prose, safe to hand out: the accumulator keeps its
 * own copies.
 */
export const createTurnAccumulator = ({ promptUuid }: { promptUuid?: string } = {}) => {
  const parts: TurnPart[] = [];
  let toolSeq = 0;
  /** The full text the runtime last sent for the text part being written (cumulative providers). */
  let lastFullText = "";
  /** The part each block of the message being streamed grows, by the block's index in it. */
  const streaming = new Map<number, number>();
  /** Streamed parts whose finished block has not arrived yet, oldest first. */
  let unsettled: { block: ProseBlock; at: number }[] = [];

  const visible = (): TurnPart[] => parts.filter(isShown).map((part) => ({ ...part }));

  return {
    applyAll(chunks: readonly ProgressChunk[]): TurnPart[] {
      for (const chunk of chunks) apply(chunk);
      return visible();
    },
    get: visible,
  };

  function apply(chunk: ProgressChunk): void {
    switch (chunk.kind) {
      case "thought":
        if (!(chunk.whole && settleStreamed("thinking", chunk.data))) applyThought(chunk.data);
        break;
      case "text":
        applyWholeText(chunk);
        break;
      case "command":
        applyCommand(chunk);
        break;
      case "tool":
        applyTool(chunk);
        break;
      case "user-message":
        applySteer(chunk.uuid);
        break;
      case "artifact":
        applyArtifact(chunk);
        break;
      default:
        applyStream(chunk);
    }
  }

  function applyWholeText(chunk: Extract<ProgressChunk, { kind: "text" }>): void {
    if (chunk.whole && settleStreamed("text", chunk.data)) return;
    // The closing result repeats the answer the turn already wrote.
    if (chunk.final && alreadySaid(chunk.data)) return;
    applyText(chunk.data);
  }

  function applyStream(chunk: Extract<ProgressChunk, { kind: `stream-${string}` }>): void {
    if (chunk.kind === "stream-message") streaming.clear();
    else if (chunk.kind === "stream-start") startStreamed(chunk);
    else if (chunk.kind === "stream-delta") growStreamed(chunk);
    else stopStreamed(chunk.index);
  }

  function startStreamed(chunk: StreamStart): void {
    if (chunk.block === "tool") {
      upsertTool({
        itemId: chunk.toolId,
        name: chunk.toolName,
        detail: undefined,
        status: "running",
      });
      return;
    }
    parts.push({ type: chunk.block, text: "" });
    const at = parts.length - 1;
    streaming.set(chunk.index, at);
    unsettled.push({ block: chunk.block, at });
  }

  function growStreamed(chunk: StreamDelta): void {
    const at = streaming.get(chunk.index);
    const part = at === undefined ? undefined : parts[at];
    if (part && isProse(part)) part.text += chunk.data;
  }

  // A message the run was sent as it worked carries its message's id as its uuid.
  function applySteer(uuid: string): void {
    const messageId = uuid === promptUuid ? null : typeIdFromUuid("smsg", uuid);
    if (!messageId) return;
    if (parts.some((part) => part.type === "steer" && part.messageId === messageId)) return;
    parts.push({ type: "steer", messageId });
  }

  // The card follows the call that made it; any other tool's result naming an artifact is ignored.
  function applyArtifact(chunk: ArtifactChunk): void {
    const tool = parts.find(
      (part): part is ToolPart => part.type === "tool" && part.id === chunk.itemId,
    );
    if (!tool || !ARTIFACT_TOOL_NAMES.has(tool.name)) return;
    if (parts.some((part) => part.type === "artifact" && part.toolId === chunk.itemId)) return;
    parts.push({ type: "artifact", toolId: chunk.itemId, ...chunk.ref });
  }

  // Claude writes a block's finished copy before it closes the block, so a block that closes
  // unsettled had no copy to wait for (empty reasoning, which Claude leaves out).
  function stopStreamed(index: number): void {
    const at = streaming.get(index);
    streaming.delete(index);
    unsettled = unsettled.filter((entry) => entry.at !== at);
  }

  /** The finished copy of a block partial messages streamed: it settles that part's text. */
  function settleStreamed(block: ProseBlock, data: string): boolean {
    const index = unsettled.findIndex((entry) => entry.block === block);
    const entry = unsettled[index];
    if (!entry) return false;
    unsettled.splice(index, 1);
    const part = parts[entry.at];
    if (part && isProse(part)) part.text = data;
    if (block === "text") lastFullText = data;
    return true;
  }

  function alreadySaid(data: string): boolean {
    const said = parts.flatMap((part) => (part.type === "text" ? [part.text.trim()] : []));
    const answer = data.trim();
    return said.join("\n\n").endsWith(answer) || said.join("").endsWith(answer);
  }

  function applyThought(data: string): void {
    // Pi re-carries a whole reasoning block on later lifecycle events: a replay, not new reasoning.
    const lastThinking = parts.findLast((part) => part.type === "thinking");
    if (lastThinking?.text.endsWith(data)) return;
    const last = parts.at(-1);
    if (last?.type === "thinking") last.text += data;
    else parts.push({ type: "thinking", text: data });
  }

  function applyText(data: string): void {
    const last = parts.at(-1);
    if (last?.type === "text") {
      last.text = mergeTextChunk(last.text, lastFullText, data);
      lastFullText = last.text;
      return;
    }
    // Pi replays the finished assistant message in turn_end after its tool calls.
    if (parts.findLast((part) => part.type === "text")?.text === data) return;
    parts.push({ type: "text", text: data });
    lastFullText = data;
  }

  function applyCommand(chunk: CommandChunk): void {
    const status = chunk.phase === "done" ? commandStatus(chunk.exitCode) : "running";
    // A command's end may name it less fully than its start did (Pi omits the arguments).
    const detail = chunk.detail
      ? `${chunk.command} · ${chunk.detail}`
      : chunk.phase === "start" || !chunk.itemId
        ? chunk.command
        : undefined;
    upsertTool({
      itemId: chunk.itemId,
      name: SHELL_TOOL_NAME,
      detail,
      status,
      matchDetail: chunk.command,
    });
  }

  function applyTool(chunk: ToolChunk): void {
    const status = chunk.phase !== "done" ? "running" : chunk.failed ? "failed" : "done";
    // A tool result names no tool ("Tool"): it only settles the call it answers.
    const name = chunk.phase === "done" && chunk.itemId ? undefined : chunk.name;
    upsertTool({ itemId: chunk.itemId, name, detail: chunk.detail, status });
  }

  function upsertTool(update: ToolUpdate): void {
    const known = findTool(update.itemId, update.name, update.matchDetail);
    if (known) {
      known.status = update.status;
      if (update.detail) known.detail = clip(update.detail, TOOL_DETAIL_MAX_LENGTH);
      return;
    }
    // The result of a call this turn never showed (a subagent's, say) has nothing to settle.
    if (update.name === undefined) return;
    parts.push({
      type: "tool",
      id: update.itemId ?? `tool_${++toolSeq}`,
      name: clip(update.name, TOOL_NAME_MAX_LENGTH),
      detail: update.detail ? clip(update.detail, TOOL_DETAIL_MAX_LENGTH) : null,
      status: update.status,
    });
  }

  function findTool(
    itemId: string | undefined,
    name: string | undefined,
    matchDetail: string | undefined,
  ): ToolPart | undefined {
    const tools = parts.filter((part): part is ToolPart => part.type === "tool").reverse();
    if (itemId) return tools.find((tool) => tool.id === itemId);
    const running = tools.filter((tool) => tool.status === "running" && tool.name === name);
    if (matchDetail === undefined) return running[0];
    return running.find((tool) =>
      tool.detail?.startsWith(clip(matchDetail, TOOL_DETAIL_MAX_LENGTH)),
    );
  }
};

/**
 * Whether a run's turn says nothing a person could read yet. Blank prose and reasoning are kept
 * while they grow (a runtime starts a block with a newline), but never shown.
 */
const isShown = (part: TurnPart): boolean => !isProse(part) || part.text.trim() !== "";

const isProse = (part: TurnPart): part is ProsePart =>
  part.type === "text" || part.type === "thinking";

const commandStatus = (exitCode: number | null | undefined): ToolPart["status"] =>
  exitCode != null && exitCode !== 0 ? "failed" : "done";

const mergeTextChunk = (content: string, lastFullText: string, data: string): string => {
  if (lastFullText && data.startsWith(lastFullText)) return data;
  if (data.length > 40 && content && data.includes(content.slice(0, 20))) return data;
  // Some runtimes re-send cumulative text with slight whitespace differences.
  const head = content.trim().slice(0, 30);
  if (head && data.length > content.length && data.includes(head)) {
    return data;
  }
  return content + data;
};
