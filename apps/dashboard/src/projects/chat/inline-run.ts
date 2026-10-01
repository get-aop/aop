import type { MessageBlock, ToolPart } from "@aop/common";

/** The blocks that flow inside a sentence: prose and the chips a sentence mentions. */
export type InlineBlock = Extract<MessageBlock, { type: "text" | "thread-chip" | "pr-chip" }>;
export type ChipBlock = Extract<InlineBlock, { type: "thread-chip" | "pr-chip" }>;

export const isInlineBlock = (block: MessageBlock): block is InlineBlock =>
  block.type === "text" || block.type === "thread-chip" || block.type === "pr-chip";

// Markdown keeps a chip inside its paragraph if the chip is a link, so a run of blocks becomes
// one markdown text whose chips are links to this address, and the renderer swaps each such
// link for the chip. The host never resolves it; it only has to survive the markdown parser's
// link filter, which drops schemes it does not know.
const CHIP_HREF_PREFIX = "https://chip.aop.invalid/";

const THREAD_CHIP_HREF_PREFIX = `${CHIP_HREF_PREFIX}thread/`;
// [Fix login](thread:isess_01abc): how an agent writes a thread into its reply.
const THREAD_LINK_TARGET = /\]\(thread:([A-Za-z0-9_-]+)\)/g;

/**
 * Markdown whose thread links (`[title](thread:<id>)`) point at the chip address instead, so the
 * renderer can draw each as the thread's chip; the parser would drop the `thread:` scheme.
 */
export const withThreadChips = (markdown: string): string =>
  markdown.includes("](thread:")
    ? markdown.replace(THREAD_LINK_TARGET, `](${THREAD_CHIP_HREF_PREFIX}$1)`)
    : markdown;

/** The thread a link made by `withThreadChips` stands for. */
export const threadChipOf = (href: string | undefined): string | null =>
  href?.startsWith(THREAD_CHIP_HREF_PREFIX)
    ? href.slice(THREAD_CHIP_HREF_PREFIX.length) || null
    : null;

export const chipIndexOf = (href: string | undefined): number | null => {
  if (!href?.startsWith(CHIP_HREF_PREFIX)) return null;
  const index = Number(href.slice(CHIP_HREF_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
};

/**
 * One paragraph of prose with its chips: the markdown to render and the chips its links stand
 * for, in order. Text blocks join as written, so the spaces around a chip stay where the
 * coordinator put them.
 */
export const proseOf = (
  run: readonly InlineBlock[],
): { markdown: string; chips: readonly ChipBlock[] } => {
  if (run.every((block) => block.type === "text")) {
    return { markdown: run.map((block) => block.text).join(""), chips: NO_CHIPS };
  }
  const chips: ChipBlock[] = [];
  const markdown = run
    .map((block) => {
      if (block.type === "text") return block.text;
      chips.push(block);
      return `[chip](${CHIP_HREF_PREFIX}${chips.length - 1})`;
    })
    .join("");
  return { markdown, chips };
};

// Shared, so prose without chips gives the renderer the same (empty) chips every time.
const NO_CHIPS: readonly ChipBlock[] = [];

/**
 * The blocks in reading order for a message, which is the order they were written: the parts
 * of the turn, then what its tools posted (cards, the routing receipt, proposals), so nothing
 * moves above what the person has read when the message lands. A run of inline blocks becomes
 * one group, so a sentence is not cut by the chip in the middle of it, and so do tool calls made
 * one after another. `at` is where the group's first block is in the message: a reply's blocks
 * are only ever added to, so it names the group for as long as the reply is on screen.
 */
export type BlockGroup =
  | { kind: "prose"; at: number; run: InlineBlock[] }
  | { kind: "tools"; at: number; tools: ToolPart[] }
  | { kind: "block"; at: number; block: Exclude<MessageBlock, InlineBlock | ToolPart> };

export const groupBlocks = (blocks: readonly MessageBlock[]): BlockGroup[] => {
  const groups: BlockGroup[] = [];
  for (const [at, block] of blocks.entries()) addToGroups(groups, block, at);
  return groups;
};

const addToGroups = (groups: BlockGroup[], block: MessageBlock, at: number): void => {
  const last = groups.at(-1);
  if (isInlineBlock(block)) {
    if (last?.kind === "prose") last.run.push(block);
    else groups.push({ kind: "prose", at, run: [block] });
  } else if (block.type === "tool") {
    if (last?.kind === "tools") last.tools.push(block);
    else groups.push({ kind: "tools", at, tools: [block] });
  } else {
    groups.push({ kind: "block", at, block });
  }
};
