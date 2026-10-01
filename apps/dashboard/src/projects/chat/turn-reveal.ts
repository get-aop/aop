import type { MessageBlock } from "@aop/common";

/** The reveal stays at most about this far behind the text that has arrived. */
export const REVEAL_LAG_SECONDS = 0.4;
/** The slowest it types (characters a second), so a trickle of text still reads as typing. */
export const REVEAL_FLOOR_CPS = 80;
/** A long frame gap (a background tab) does not jump the reveal ahead by more than this. */
export const MAX_FRAME_SECONDS = 0.1;

/** The prose of a reply, block by block: what the reveal types out. Other blocks just appear. */
export const proseOf = (blocks: readonly MessageBlock[]): string[] =>
  blocks.flatMap((block) => (block.type === "text" ? [block.text] : []));

export const lengthOf = (texts: readonly string[]): number =>
  texts.reduce((total, text) => total + text.length, 0);

/**
 * How far the reveal gets in `seconds`: fast enough to drain what is behind in about
 * `REVEAL_LAG_SECONDS`, never slower than the floor, never past what has arrived.
 */
export const advanceReveal = (revealed: number, total: number, seconds: number): number => {
  const behind = total - revealed;
  if (behind <= 0) return total;
  const pace = Math.max(REVEAL_FLOOR_CPS, behind / REVEAL_LAG_SECONDS);
  return Math.min(total, revealed + pace * Math.min(seconds, MAX_FRAME_SECONDS));
};

/**
 * The characters to show for a reveal at `revealed`: whole words only, so a word never appears
 * letter by letter. While the turn is still being written, the word it is in the middle of waits
 * for its end; once it is finished, everything that arrived is shown when the reveal gets there.
 */
export const shownChars = (
  texts: readonly string[],
  revealed: number,
  writing: boolean,
): number => {
  const total = lengthOf(texts);
  const at = Math.min(Math.floor(revealed), total);
  if (at >= total && !writing) return total;
  let before = 0;
  for (const text of texts) {
    if (at < before + text.length) return before + wordStart(text, at - before, writing);
    before += text.length;
  }
  // Every block is shown whole, and the last one may still be in the middle of a word.
  const last = texts.at(-1) ?? "";
  return total - last.length + wordStart(last, last.length, true);
};

/**
 * The blocks shown when `chars` characters of their prose are: text blocks up to that point (the
 * last one cut), and every other block once all the prose before it is shown.
 */
export const revealedBlocks = (
  blocks: readonly MessageBlock[],
  chars: number,
): readonly MessageBlock[] => {
  const shown: MessageBlock[] = [];
  let left = chars;
  for (const block of blocks) {
    const length = block.type === "text" ? block.text.length : 0;
    if (left >= length) {
      shown.push(block);
      left -= length;
      continue;
    }
    // The prose being revealed ends here: the part of it shown so far, and nothing after it.
    if (left > 0 && block.type === "text")
      shown.push({ ...block, text: block.text.slice(0, left) });
    return shown;
  }
  return blocks;
};

// The last word boundary at or before `offset`: right after a whitespace, or right before one (a
// word that just ended). At the end of a text still being written, a word not yet followed by
// whitespace may go on.
const wordStart = (text: string, offset: number, writing: boolean): number => {
  if (!writing && offset >= text.length) return text.length;
  if (isSpace(text[offset - 1]) || isSpace(text[offset])) return offset;
  for (let at = offset - 1; at > 0; at--) {
    if (isSpace(text[at - 1])) return at;
  }
  return 0;
};

const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char);
