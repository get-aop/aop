/** Collapse large clipboard pastes into Claude-style `[paste #N +lines]` tokens. */

export const PASTE_COLLAPSE_MIN_LINES = 5;
export const PASTE_COLLAPSE_MIN_CHARS = 500;

export interface ComposerPasteEntry {
  id: string;
  index: number;
  lineCount: number;
  content: string;
}

const PASTE_TOKEN_RE = /\[paste #(\d+) \+\d+ lines?\]/g;

/** Ranges of collapse tokens currently present in the draft (for highlight paint). */
export const findPasteTokenRanges = (
  draft: string,
): Array<{ start: number; end: number; index: number }> => {
  if (!draft.includes("[paste #")) return [];
  const ranges: Array<{ start: number; end: number; index: number }> = [];
  for (const match of draft.matchAll(PASTE_TOKEN_RE)) {
    if (match.index === undefined) continue;
    ranges.push({
      start: match.index,
      end: match.index + match[0].length,
      index: Number(match[1]),
    });
  }
  return ranges;
};

export const shouldCollapsePaste = (text: string): boolean => {
  if (!text.trim()) return false;
  if (text.length >= PASTE_COLLAPSE_MIN_CHARS) return true;
  const lineCount = countLines(text);
  return lineCount >= PASTE_COLLAPSE_MIN_LINES;
};

export const formatPasteToken = (index: number, lineCount: number): string => {
  const unit = lineCount === 1 ? "line" : "lines";
  return `[paste #${index} +${lineCount} ${unit}]`;
};

export const nextPasteIndex = (pastes: ReadonlyArray<Pick<ComposerPasteEntry, "index">>): number =>
  pastes.reduce((max, paste) => Math.max(max, paste.index), 0) + 1;

export const countLines = (text: string): number => {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
};

export const expandPasteTokens = (
  content: string,
  pastes: ReadonlyArray<ComposerPasteEntry>,
): string => {
  if (pastes.length === 0 || !content.includes("[paste #")) return content;
  const byIndex = new Map(pastes.map((paste) => [paste.index, paste.content]));
  return content.replace(PASTE_TOKEN_RE, (token, indexRaw: string) => {
    const body = byIndex.get(Number(indexRaw));
    return body ?? token;
  });
};

export const createPasteEntry = (
  content: string,
  pastes: ReadonlyArray<ComposerPasteEntry>,
): ComposerPasteEntry => {
  const index = nextPasteIndex(pastes);
  return {
    id: crypto.randomUUID(),
    index,
    lineCount: countLines(content),
    content,
  };
};

/** Insert `token` at the current selection inside `value`. */
export const insertTokenAtSelection = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  token: string,
): { nextValue: string; nextCaret: number } => {
  const start = Math.max(0, Math.min(selectionStart, value.length));
  const end = Math.max(start, Math.min(selectionEnd, value.length));
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
  return { nextValue, nextCaret: start + token.length };
};
