/**
 * The items of what `gh api --paginate` printed. Each page is written on its own, so a long list
 * comes back as several JSON arrays one after another (`[..][..]`), not as one value; a short one
 * is a single array. Returns every item of every array, in order, and null when the text is not
 * made of JSON arrays, which is how a failed request or an error page looks.
 */
export const parseJsonPages = (text: string): unknown[] | null => {
  const pages = splitPages(text);
  if (pages === null) return null;
  const items: unknown[] = [];
  for (const page of pages) {
    const parsed = parseJson(page);
    if (!Array.isArray(parsed)) return null;
    items.push(...parsed);
  }
  return items;
};

// A string is skipped whole, so a bracket inside one does not count.
const TOKEN = /"(?:[^"\\]|\\.)*"|[[\]{}]/g;

const DEPTH_CHANGE: Record<string, number> = { "[": 1, "{": 1, "]": -1, "}": -1 };
const depthChange = (token: string): number => DEPTH_CHANGE[token] ?? 0;

/** The top-level values of the text, cut at the point where the brackets they opened close. */
const splitPages = (text: string): string[] | null => {
  const pages: string[] = [];
  let depth = 0;
  let start = 0;
  for (const { 0: token, index } of text.matchAll(TOKEN)) {
    const before = depth;
    depth += depthChange(token);
    if (depth < 0) return null;
    if (before === 0 && depth > 0) start = index;
    if (before > 0 && depth === 0) pages.push(text.slice(start, index + 1));
  }
  return depth === 0 ? pages : null;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
