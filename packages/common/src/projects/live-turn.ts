import type { ProsePart, ToolPart, TurnPart } from "./blocks.ts";
import type { LiveOp } from "./stream.ts";

/**
 * The parts of a turn after `ops`, or null once one of them ended the turn. An op that names a
 * part the client does not hold is skipped; the next baseline puts the turn right.
 */
export const applyLiveOps = (
  parts: readonly TurnPart[],
  ops: readonly LiveOp[],
): TurnPart[] | null => {
  let next: TurnPart[] | null = [...parts];
  for (const op of ops) {
    next = next === null && op.op !== "reset" ? null : applyOp(next ?? [], op);
  }
  return next;
};

/**
 * The parts as a finished reply keeps them: when each step started only matters while the turn
 * is written (a message sent meanwhile says how long the step it waits on has run).
 */
export const settledParts = (parts: readonly TurnPart[]): TurnPart[] =>
  parts.map((part) => {
    if (part.type !== "tool" || part.startedAt === undefined) return part;
    const { startedAt: _startedAt, ...settled } = part;
    return settled;
  });

/**
 * The ops that take a client from `before` to `after`: new parts started, text appended, tool
 * calls updated. Parts never reorder or shrink while a turn is written, so anything else (a part
 * replaced, text that is not an extension) is sent as a reset. Empty when nothing changed.
 */
export const diffTurnParts = (
  before: readonly TurnPart[],
  after: readonly TurnPart[],
): LiveOp[] => {
  if (after.length < before.length) return [{ op: "reset", parts: [...after] }];
  const ops: LiveOp[] = [];
  for (const [index, held] of before.entries()) {
    const next = after[index] as TurnPart;
    const op = partChange(held, next, index);
    if (op === "reset") return [{ op: "reset", parts: [...after] }];
    if (op) ops.push(op);
  }
  for (let index = before.length; index < after.length; index++) {
    ops.push({ op: "start", index, part: after[index] as TurnPart });
  }
  return ops;
};

/**
 * `ops` with nothing a later op makes obsolete: what precedes the last reset or end goes, and
 * text appended to one part in a row is joined. A slow client then costs one pending delta per
 * turn, not one per change.
 */
export const compactLiveOps = (ops: readonly LiveOp[]): LiveOp[] => {
  const from = ops.findLastIndex((op) => op.op === "reset" || op.op === "end");
  const compacted: LiveOp[] = [];
  for (const op of from === -1 ? ops : ops.slice(from)) {
    const last = compacted.at(-1);
    if (op.op === "append" && last?.op === "append" && last.index === op.index) {
      compacted[compacted.length - 1] = { ...last, text: last.text + op.text };
    } else {
      compacted.push(op);
    }
  }
  return compacted;
};

const applyOp = (parts: TurnPart[], op: LiveOp): TurnPart[] | null => {
  switch (op.op) {
    case "reset":
      return [...op.parts];
    case "end":
      return null;
    case "start":
      return op.index <= parts.length ? [...parts.slice(0, op.index), op.part] : parts;
    case "append":
      return updateAt(parts, op.index, (part) =>
        isProse(part) ? { ...part, text: part.text + op.text } : part,
      );
    case "tool":
      return updateAt(parts, op.index, (part) =>
        part.type === "tool" ? { ...part, status: op.status, detail: op.detail } : part,
      );
  }
};

const updateAt = (
  parts: TurnPart[],
  index: number,
  change: (part: TurnPart) => TurnPart,
): TurnPart[] => {
  const part = parts[index];
  return part ? parts.map((held, at) => (at === index ? change(part) : held)) : parts;
};

type Change = LiveOp | null | "reset";

// What changed in one part: an op, nothing (null), or something no op can say ("reset").
const partChange = (held: TurnPart, next: TurnPart, index: number): Change => {
  if (held.type === "tool" && next.type === "tool") return toolChange(held, next, index);
  if (!isProse(held) && !isProse(next)) return wholePartChange(held, next);
  if (!isProse(held) || !isProse(next) || held.type !== next.type) return "reset";
  if (!next.text.startsWith(held.text)) return "reset";
  const added = next.text.slice(held.text.length);
  return added ? { op: "append", index, text: added } : null;
};

// A steer, and an artifact's card, are written once, whole: the same part, or something else.
const wholePartChange = (held: TurnPart, next: TurnPart): Change => {
  if (held.type === "steer" && next.type === "steer") {
    return held.messageId === next.messageId ? null : "reset";
  }
  if (held.type === "artifact" && next.type === "artifact") {
    return held.toolId === next.toolId && held.version === next.version ? null : "reset";
  }
  return "reset";
};

const toolChange = (held: ToolPart, next: ToolPart, index: number): Change => {
  if (held.id !== next.id || held.name !== next.name) return "reset";
  const changed = held.status !== next.status || held.detail !== next.detail;
  return changed ? { op: "tool", index, status: next.status, detail: next.detail } : null;
};

const isProse = (part: TurnPart): part is ProsePart =>
  part.type === "text" || part.type === "thinking";
