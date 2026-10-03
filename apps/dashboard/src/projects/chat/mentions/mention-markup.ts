/**
 * A message with @-mentioned threads in it. On the wire, and in the saved draft, a mention is the
 * link the coordinator already writes and reads, `[title](thread:<id>)`, so the message names the
 * thread by id. In the box it is `@title`, drawn as a chip; `MentionDraft` is that text with
 * where each chip sits in it, which is what an edit in the box is applied to.
 */

export interface Mention {
  threadId: string;
  title: string;
  /** Where the chip's `@title` is in the box's text: [start, end). */
  start: number;
  end: number;
}

export interface MentionDraft {
  /** What the box shows. */
  text: string;
  /** In order, never overlapping. */
  mentions: readonly Mention[];
}

/** A piece of a message: words as written, or a mentioned thread. */
export type MessagePiece =
  | { kind: "text"; text: string }
  | { kind: "mention"; threadId: string; title: string };

// The title may hold an escaped bracket or backslash, never a bare one or a line break. The id is
// the pattern the chat renders as a chip (inline-run.ts).
const MENTION_LINK = /\[((?:\\[\\[\]]|[^\\[\]\n])*)\]\(thread:([A-Za-z0-9_-]+)\)/g;

/** A message cut into its words and the threads it mentions. */
export const messagePieces = (markup: string): MessagePiece[] => {
  const pieces: MessagePiece[] = [];
  let at = 0;
  for (const match of markup.matchAll(MENTION_LINK)) {
    if (match.index > at) pieces.push({ kind: "text", text: markup.slice(at, match.index) });
    pieces.push({
      kind: "mention",
      threadId: match[2] ?? "",
      title: unescapeTitle(match[1] ?? ""),
    });
    at = match.index + match[0].length;
  }
  if (at < markup.length) pieces.push({ kind: "text", text: markup.slice(at) });
  return pieces;
};

/** The thread link a mention is sent as. */
export const mentionLink = (title: string, threadId: string): string =>
  `[${title.replace(/[\\[\]]/g, (char) => `\\${char}`)}](thread:${threadId})`;

/** What a mention shows in the box. */
export const mentionLabel = (title: string): string => `@${title}`;

export const draftOf = (markup: string): MentionDraft => {
  let text = "";
  const mentions: Mention[] = [];
  for (const piece of messagePieces(markup)) {
    if (piece.kind === "text") {
      text += piece.text;
      continue;
    }
    const label = mentionLabel(piece.title);
    mentions.push({
      threadId: piece.threadId,
      title: piece.title,
      start: text.length,
      end: text.length + label.length,
    });
    text += label;
  }
  return { text, mentions };
};

export const markupOf = (draft: MentionDraft): string => {
  let markup = "";
  let at = 0;
  for (const mention of draft.mentions) {
    markup += draft.text.slice(at, mention.start) + mentionLink(mention.title, mention.threadId);
    at = mention.end;
  }
  return markup + draft.text.slice(at);
};

/**
 * The box after the person changed its text from `draft.text` to `next`, the cursor now at
 * `caret`. Taking any character of a chip away takes the whole chip, so Backspace after one
 * removes it at once; typing inside a chip turns it back into plain words. `caret` is where the
 * cursor belongs afterwards, which differs from the box's when a whole chip went.
 */
export const applyEdit = (
  draft: MentionDraft,
  next: string,
  caret: number,
): { draft: MentionDraft; caret: number } => {
  let { start, end, inserted } = changeOf(draft.text, next, caret);
  const kept: Mention[] = [];
  for (const mention of draft.mentions) {
    const deleted = start < end && mention.start < end && mention.end > start;
    const typedInside = start === end && mention.start < start && start < mention.end;
    if (deleted) {
      start = Math.min(start, mention.start);
      end = Math.max(end, mention.end);
    } else if (!typedInside) {
      kept.push(mention);
    }
  }
  const shift = inserted.length - (end - start);
  const text = draft.text.slice(0, start) + inserted + draft.text.slice(end);
  const mentions = kept.map((mention) =>
    mention.start >= end
      ? { ...mention, start: mention.start + shift, end: mention.end + shift }
      : mention,
  );
  return { draft: { text, mentions }, caret: start + inserted.length };
};

/**
 * `draft` with the text in [start, end) (the `@` and what was typed after it) replaced by a chip
 * for the thread, and a space after it so the person can type on.
 */
export const insertMention = (
  draft: MentionDraft,
  start: number,
  end: number,
  thread: { id: string; title: string },
): { draft: MentionDraft; caret: number } => {
  const title = thread.title.replace(/\s+/g, " ").trim();
  const label = mentionLabel(title);
  const after = draft.text.slice(end);
  const gap = after.startsWith(" ") ? "" : " ";
  const shift = label.length + gap.length - (end - start);
  const mention: Mention = { threadId: thread.id, title, start, end: start + label.length };
  const mentions = [
    ...draft.mentions.filter((other) => other.end <= start),
    mention,
    ...draft.mentions
      .filter((other) => other.start >= end)
      .map((other) => ({ ...other, start: other.start + shift, end: other.end + shift })),
  ];
  const text = draft.text.slice(0, start) + label + gap + after;
  return { draft: { text, mentions }, caret: mention.end + 1 };
};

/** The chip the cursor is in, or right after: what Backspace there takes away. */
export const mentionAt = (draft: MentionDraft, caret: number): Mention | undefined =>
  draft.mentions.find((mention) => mention.start < caret && caret <= mention.end);

const unescapeTitle = (title: string): string => title.replace(/\\([\\[\]])/g, "$1");

/**
 * What changed between two texts: [start, end) of `before` became `inserted`. A change is
 * ambiguous when it borders the same character ("aa" to "aaa"); the cursor, which sits at the end
 * of what was typed, settles it.
 */
const changeOf = (
  before: string,
  after: string,
  caret: number,
): { start: number; end: number; inserted: string } => {
  const shortest = Math.min(before.length, after.length);
  let suffix = 0;
  const suffixLimit = Math.min(shortest, after.length - caret);
  while (
    suffix < suffixLimit &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  let prefix = 0;
  const prefixLimit = shortest - suffix;
  while (prefix < prefixLimit && before[prefix] === after[prefix]) prefix += 1;
  return {
    start: prefix,
    end: before.length - suffix,
    inserted: after.slice(prefix, after.length - suffix),
  };
};
