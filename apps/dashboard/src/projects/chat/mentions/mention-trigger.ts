import type { MentionDraft } from "./mention-markup";

/** An `@` being typed: where it is, and what follows it up to the cursor. */
export interface MentionQuery {
  /** Where the `@` is in the box's text. */
  start: number;
  query: string;
}

export const MENTION_QUERY_MAX = 60;

// What may come right before an `@` that starts a mention: the start of the text, a space, or an
// opening bracket or quote. A letter or digit there is an address (`name@domain`), not a mention.
const OPENS_MENTION = /[\s([{"'“‘]/;

/**
 * The mention being typed at the cursor, if one is. The `@` starts a word, outside code, and the
 * query after it stays on its line, does not start with a space and is not long; titles have
 * spaces, so one may follow a word.
 */
export const mentionQueryAt = (draft: MentionDraft, caret: number): MentionQuery | null => {
  const { text } = draft;
  if (caret <= 0) return null;
  const from = Math.max(0, caret - MENTION_QUERY_MAX - 1);
  const start = text.lastIndexOf("@", caret - 1);
  if (start < from || start < 0) return null;
  const query = text.slice(start + 1, caret);
  if (/\n/.test(query) || /^\s/.test(query)) return null;
  if (start > 0 && !OPENS_MENTION.test(text[start - 1] ?? "")) return null;
  // The `@` of a chip, or a chip between the `@` and the cursor, is no new mention.
  if (draft.mentions.some((mention) => mention.end > start && mention.start < caret)) return null;
  if (isInCode(text, start)) return null;
  return { start, query };
};

/**
 * Whether `at` is inside code: a fenced block (``` or ~~~) or an inline span between backticks,
 * where an `@` is code (a decorator, a package scope) and not a mention.
 */
export const isInCode = (text: string, at: number): boolean => {
  const lines = text.slice(0, at).split("\n");
  const current = lines.pop() ?? "";
  let fence: string | null = null;
  for (const line of lines) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (!marker) continue;
    if (fence === null) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
  }
  return fence !== null || inInlineCode(current);
};

// An inline code span opens with a run of backticks and closes with a run of the same length.
const inInlineCode = (line: string): boolean => {
  let open: number | null = null;
  for (const run of line.match(/`+/g) ?? []) {
    if (open === null) open = run.length;
    else if (run.length === open) open = null;
  }
  return open !== null;
};
