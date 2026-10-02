const MAX_ITEM_CHARS = 160;
const MAX_ITEMS = 80;

/**
 * The fallback when no valid diagram came back: the reply's structure as a nested list, made
 * without a model. Headings are the top levels, lists keep their nesting under the heading they
 * are in, and each paragraph gives its sentences. Code and tables are left out.
 */
export const outlineOf = (reply: string): string => {
  const items: string[] = [];
  let headingDepth = -1;
  let minHeading = 7;
  let inFence = false;
  const lines = reply.split(/\r?\n/);
  for (const line of lines) {
    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading) minHeading = Math.min(minHeading, heading[1]?.length ?? 7);
  }
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || /^\s*\|/.test(raw) || !raw.trim()) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (heading) {
      headingDepth = (heading[1]?.length ?? 1) - minHeading;
      items.push(bullet(headingDepth, `**${plain(heading[2] ?? "")}**`));
      continue;
    }
    const listItem = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (listItem) {
      const nesting = Math.floor((listItem[1]?.length ?? 0) / 2);
      items.push(bullet(headingDepth + 1 + nesting, plain(listItem[2] ?? "")));
      continue;
    }
    for (const sentence of sentencesOf(plain(raw))) {
      items.push(bullet(headingDepth + 1, sentence));
    }
  }
  const kept = items.filter((item) => item.trim() !== "-").slice(0, MAX_ITEMS);
  return [
    "# Outline",
    "",
    ...(kept.length > 0 ? kept : ["- (The reply has no text to outline.)"]),
  ].join("\n");
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
