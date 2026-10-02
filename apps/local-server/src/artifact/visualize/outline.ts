const MAX_ITEM_CHARS = 160;
const MAX_ITEMS = 80;

/**
 * The fallback when no valid diagram came back: the reply's structure as a nested list, made
 * without a model. Headings are the top levels, lists keep their nesting under the heading they
 * are in, and each paragraph gives its sentences. Code and tables are left out.
 */
export const outlineOf = (reply: string): string => {
  const lines = reply.split(/\r?\n/);
  const items = outlineItems(proseLines(lines), topHeadingLevel(lines));
  const kept = items.filter((item) => item.trim() !== "-").slice(0, MAX_ITEMS);
  return [
    "# Outline",
    "",
    ...(kept.length > 0 ? kept : ["- (The reply has no text to outline.)"]),
  ].join("\n");
};

// The lines an outline reads: no code, no tables, no blank lines.
const proseLines = (lines: readonly string[]): string[] => {
  let inFence = false;
  return lines.filter((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return false;
    }
    return !inFence && !/^\s*\|/.test(line) && line.trim() !== "";
  });
};

const topHeadingLevel = (lines: readonly string[]): number =>
  Math.min(7, ...lines.map((line) => /^(#{1,6})\s+/.exec(line)?.[1]?.length ?? 7));

const outlineItems = (lines: readonly string[], topLevel: number): string[] => {
  const items: string[] = [];
  let headingDepth = -1;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      headingDepth = (heading[1]?.length ?? 1) - topLevel;
      items.push(bullet(headingDepth, `**${plain(heading[2] ?? "")}**`));
    } else {
      items.push(...bodyItems(line, headingDepth));
    }
  }
  return items;
};

// A list item keeps its nesting under the heading it is in; a paragraph gives its sentences.
const bodyItems = (line: string, headingDepth: number): string[] => {
  const listItem = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (listItem) {
    const nesting = Math.floor((listItem[1]?.length ?? 0) / 2);
    return [bullet(headingDepth + 1 + nesting, plain(listItem[2] ?? ""))];
  }
  return sentencesOf(plain(line)).map((sentence) => bullet(headingDepth + 1, sentence));
};

const bullet = (depth: number, text: string): string =>
  `${"  ".repeat(Math.max(0, depth))}- ${clip(text.trim())}`;

// Links keep their text, emphasis its words; inline code stays as written.
const plain = (text: string): string =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\W)[*_](.+?)[*_](?=\W|$)/g, "$1$2")
    .replace(/^>\s?/, "")
    .trim();

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9`"'(])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const clip = (text: string): string =>
  text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS - 1)}…` : text;
