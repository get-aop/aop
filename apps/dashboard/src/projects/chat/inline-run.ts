import type { MessageBlock } from "@aop/common";

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
export const proseOf = (run: readonly InlineBlock[]): { markdown: string; chips: ChipBlock[] } => {
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

/**
 * The blocks in reading order for a message. The routing receipt belongs above what was said
 * about it, wherever the tool that made it ran; a run of inline blocks becomes one group, so
 * a sentence is not cut by the chip in the middle of it.
 */
export type BlockGroup =
  | { kind: "prose"; run: InlineBlock[] }
  | { kind: "block"; block: Exclude<MessageBlock, InlineBlock> };

export const groupBlocks = (blocks: readonly MessageBlock[]): BlockGroup[] => {
  const groups: BlockGroup[] = [];
  const rest = [...blocks.filter(isReceipt), ...blocks.filter((block) => !isReceipt(block))];
  for (const block of rest) {
    const last = groups.at(-1);
    if (isInlineBlock(block)) {
      if (last?.kind === "prose") last.run.push(block);
      else groups.push({ kind: "prose", run: [block] });
    } else {
      groups.push({ kind: "block", block });
    }
  }
  return groups;
};

const isReceipt = (block: MessageBlock): boolean => block.type === "routing-receipt";
