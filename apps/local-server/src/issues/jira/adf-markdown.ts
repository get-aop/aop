/**
 * Converts Jira issue text to Markdown for the Issues tab and thread briefs. The input comes
 * from a remote Jira, so it is treated as untrusted: nothing here throws, unknown shapes degrade
 * to their text, and plain text is escaped so it cannot turn into links, emphasis or HTML.
 */

/** Renders an Atlassian Document Format document (Jira Cloud REST v3 bodies) as Markdown. */
export const adfToMarkdown = (document: unknown): string => {
  // Some endpoints and older payloads hand back a plain string where ADF is expected.
  if (typeof document === "string") return jiraTextToMarkdown(document);
  const root = toNode(document);
  if (!root) return "";
  try {
    return joinBlocks(renderBlockParts([root], 0)).trim();
  } catch {
    // Last resort for inputs no guard anticipated: an empty body beats a failed issue read.
    return "";
  }
};

/**
 * Renders a Jira Data Center description (wiki markup or plain text) as literal Markdown text.
 * Wiki markup is not interpreted; it is shown as written, with its line breaks kept.
 */
export const jiraTextToMarkdown = (text: string): string => {
  if (typeof text !== "string") return "";
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((paragraph) =>
      paragraph
        .trim()
        .split("\n")
        .map((line) => escapeLineStart(escapeText(line.trim())))
        .join(HARD_BREAK),
    )
    .filter((paragraph) => paragraph !== "")
    .join("\n\n");
};

interface AdfMark {
  type: string;
  attrs: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  attrs: Record<string, unknown>;
  content: AdfNode[];
  text: string;
  marks: AdfMark[];
}

interface BlockPart {
  type: string;
  text: string;
}

type Renderer = (node: AdfNode, depth: number) => string;

interface ListStyle {
  bullet: (index: number) => string;
  lead: (item: AdfNode) => string;
}

// Deeper documents are cut off rather than risking a stack overflow on hostile input.
const MAX_DEPTH = 50;
// A backslash before the newline is a hard break that survives editors trimming trailing spaces.
const HARD_BREAK = "\\\n";
const MAX_COLSPAN = 20;
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList", "decisionList"]);
const PANEL_LABELS: Record<string, string> = {
  info: "Info",
  note: "Note",
  warning: "Warning",
  success: "Success",
  error: "Error",
};
const EMPHASIS_DELIMITERS: Array<[string, string]> = [
  ["em", "_"],
  ["strong", "**"],
  ["strike", "~~"],
];

const BULLET_STYLE: ListStyle = { bullet: () => "- ", lead: () => "" };
const TASK_STYLE: ListStyle = {
  bullet: () => "- ",
  lead: (item) => (item.attrs.state === "DONE" ? "[x] " : "[ ] "),
};

const INLINE_RENDERERS: Record<string, Renderer> = {
  text: (node) => renderText(node),
  hardBreak: () => HARD_BREAK,
  mention: (node) => `@${escapeText(stringAttr(node, "text").replace(/^@+/, "") || "user")}`,
  emoji: (node) => escapeText(stringAttr(node, "text") || stringAttr(node, "shortName")),
  inlineCard: (node) => autolink(stringAttr(node, "url")),
  status: (node) => codeSpan(stringAttr(node, "text")),
  date: (node) => formatDate(node.attrs.timestamp),
  placeholder: () => "",
  mediaInline: (node) => attachmentLabel(node),
};

const BLOCK_RENDERERS: Record<string, Renderer> = {
  doc: (node, depth) => joinBlocks(renderBlockParts(node.content, depth)),
  paragraph: (node, depth) => finalizeInline(renderInlines(node.content, depth)),
  heading: (node, depth) => renderHeading(node, depth),
  bulletList: (node, depth) => renderList(node, depth, BULLET_STYLE),
  orderedList: (node, depth) => renderList(node, depth, orderedStyle(node)),
  taskList: (node, depth) => renderList(node, depth, TASK_STYLE),
  decisionList: (node, depth) => renderList(node, depth, BULLET_STYLE),
  listItem: (node, depth) => renderListItem(node, depth, "- ", ""),
  taskItem: (node, depth) => renderListItem(node, depth, "- ", TASK_STYLE.lead(node)),
  decisionItem: (node, depth) => renderListItem(node, depth, "- ", ""),
  codeBlock: (node) => renderCodeBlock(node),
  blockquote: (node, depth) => quote(joinBlocks(renderBlockParts(node.content, depth))),
  panel: (node, depth) => renderPanel(node, depth),
  rule: () => "---",
  table: (node, depth) => renderTable(node, depth),
  mediaSingle: (node, depth) => joinBlocks(renderBlockParts(node.content, depth)),
  mediaGroup: (node, depth) => node.content.map((child) => renderBlock(child, depth)).join("\n"),
  media: (node) => attachmentLabel(node),
  expand: (node, depth) => renderExpand(node, depth),
  nestedExpand: (node, depth) => renderExpand(node, depth),
  blockCard: (node) => autolink(stringAttr(node, "url")),
  embedCard: (node) => autolink(stringAttr(node, "url")),
};

// Normalizing stops below the render depth limit, so a hostile nesting depth costs nothing.
const toNode = (value: unknown, depth = 0): AdfNode | null => {
  if (!isRecord(value)) return null;
  const children = Array.isArray(value.content) && depth <= MAX_DEPTH ? value.content : [];
  return {
    type: typeof value.type === "string" ? value.type : "",
    attrs: isRecord(value.attrs) ? value.attrs : {},
    content: children.map((child) => toNode(child, depth + 1)).filter(isNode),
    text: typeof value.text === "string" ? value.text : "",
    marks: Array.isArray(value.marks) ? value.marks.map(toMark).filter(isMark) : [],
  };
};

const toMark = (value: unknown): AdfMark | null => {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  return { type: value.type, attrs: isRecord(value.attrs) ? value.attrs : {} };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNode = (node: AdfNode | null): node is AdfNode => node !== null;

const isMark = (mark: AdfMark | null): mark is AdfMark => mark !== null;

// Node types come from the remote document, so `toString` must not find Object.prototype's.
const lookup = <T>(table: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined;

const stringAttr = (node: AdfNode, key: string): string => {
  const value = node.attrs[key];
  return typeof value === "string" ? value : "";
};

// Inline nodes that sit directly among blocks are gathered into one paragraph, so a sloppy
// document still reads as text instead of one block per word.
const renderBlockParts = (nodes: AdfNode[], depth: number): BlockPart[] => {
  if (depth > MAX_DEPTH) return [];
  const parts: BlockPart[] = [];
  let run: AdfNode[] = [];
  const flush = () => {
    if (run.length > 0)
      parts.push({ type: "paragraph", text: finalizeInline(renderInlines(run, depth)) });
    run = [];
  };
  for (const node of nodes) {
    if (isInlineNode(node)) {
      run.push(node);
      continue;
    }
    flush();
    parts.push({ type: node.type, text: renderBlock(node, depth) });
  }
  flush();
  return parts.filter((part) => part.text.trim() !== "");
};

const isInlineNode = (node: AdfNode): boolean =>
  lookup(INLINE_RENDERERS, node.type) !== undefined ||
  (lookup(BLOCK_RENDERERS, node.type) === undefined && node.content.length === 0);

const renderBlock = (node: AdfNode, depth: number): string => {
  if (depth > MAX_DEPTH) return "";
  const renderer = lookup(BLOCK_RENDERERS, node.type);
  if (renderer) return renderer(node, depth + 1);
  return joinBlocks(renderBlockParts(node.content, depth + 1));
};

const joinBlocks = (parts: BlockPart[]): string => parts.map((part) => part.text).join("\n\n");

const renderInlines = (nodes: AdfNode[], depth: number): string => {
  if (depth > MAX_DEPTH) return "";
  return nodes.map((node) => renderInline(node, depth + 1)).join("");
};

const renderInline = (node: AdfNode, depth: number): string => {
  const renderer = lookup(INLINE_RENDERERS, node.type);
  if (renderer) return renderer(node, depth);
  const text = stringAttr(node, "text") || node.text;
  return text ? escapeText(text) : renderInlines(node.content, depth);
};

// Breaks at the edges of a paragraph would print as stray backslashes, and leading spaces
// could turn a line into an indented code block.
const finalizeInline = (markdown: string): string =>
  markdown
    .replace(/^(?:\s*\\\n)+/, "")
    .replace(/(?:\\\n\s*)+$/, "")
    .split("\n")
    .map((line) => escapeLineStart(line.trimStart()))
    .join("\n")
    .trim();

const renderText = (node: AdfNode): string => {
  const raw = node.text.replace(/\r\n?/g, "\n");
  if (raw === "") return "";
  const hasCode = node.marks.some((mark) => mark.type === "code");
  const body = hasCode ? codeSpan(raw) : escapeText(raw).replace(/\n/g, HARD_BREAK);
  return applyMarks(body, node.marks);
};

// Delimiters wrap the text without its surrounding whitespace: `** bold**` is not bold.
const applyMarks = (body: string, marks: AdfMark[]): string => {
  const [, leading = "", core = "", trailing = ""] = body.match(/^(\s*)([\s\S]*?)(\s*)$/) ?? [];
  if (core === "") return body;
  const href = linkHref(marks);
  let wrapped = href ? `[${core}](${href})` : core;
  for (const [type, delimiter] of EMPHASIS_DELIMITERS) {
    if (marks.some((mark) => mark.type === type)) wrapped = `${delimiter}${wrapped}${delimiter}`;
  }
  return `${leading}${wrapped}${trailing}`;
};

const linkHref = (marks: AdfMark[]): string | null => {
  const link = marks.find((mark) => mark.type === "link");
  const href = link?.attrs.href;
  return typeof href === "string" ? safeUrl(href, ["http://", "https://", "mailto:"]) : null;
};

const autolink = (url: string): string => {
  const safe = safeUrl(url, ["http://", "https://"]);
  return safe ? `<${safe}>` : "";
};

// Only web and mail links survive: `javascript:` and friends must never become clickable.
const safeUrl = (url: string, schemes: string[]): string | null => {
  const trimmed = url.trim();
  const lower = trimmed.toLowerCase();
  if (!schemes.some((scheme) => lower.startsWith(scheme))) return null;
  return trimmed.replace(/[\s<>()\\]/g, percentEncode);
};

const percentEncode = (char: string): string => {
  const code = char.charCodeAt(0);
  return code < 128
    ? `%${code.toString(16).toUpperCase().padStart(2, "0")}`
    : encodeURIComponent(char);
};

// The fence is one backtick longer than any run inside, and padded so edge backticks hold.
const codeSpan = (raw: string): string => {
  const text = raw.replace(/\s*\n\s*/g, " ");
  if (text === "") return "";
  const fence = "`".repeat(longestBacktickRun(text) + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
};

const longestBacktickRun = (text: string): number =>
  Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));

const escapeText = (text: string): string => text.replace(/[\\`*_[\]<>~|&]/g, "\\$&");

// Markers that only mean something at the start of a line: headings, lists, quotes, setext.
const escapeLineStart = (line: string): string =>
  line.replace(/^([#+=-])/, "\\$1").replace(/^(\d+)([.)])/, "$1\\$2");

const formatDate = (timestamp: unknown): string => {
  const millis = Number(timestamp);
  if (!Number.isFinite(millis)) return "";
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

const attachmentLabel = (node: AdfNode): string => {
  const name = stringAttr(node, "alt") || stringAttr(node, "filename");
  // Brackets are escaped so a following `(url)` in the text cannot complete a link.
  return name ? `\\[attachment: ${escapeText(name.replace(/\s+/g, " "))}\\]` : "\\[attachment\\]";
};

const renderHeading = (node: AdfNode, depth: number): string => {
  const text = finalizeInline(renderInlines(node.content, depth))
    .replace(/\\\n\s*/g, " ")
    .replace(/\n/g, " ");
  if (text === "") return "";
  // A trailing run of `#` after a space would be read as the heading's closing sequence.
  return `${"#".repeat(headingLevel(node.attrs.level))} ${text.replace(/(\s)(#+)$/, "$1\\$2")}`;
};

const headingLevel = (level: unknown): number => {
  const value = Math.trunc(Number(level));
  return Number.isFinite(value) ? Math.min(6, Math.max(1, value)) : 1;
};

const orderedStyle = (node: AdfNode): ListStyle => {
  const order = node.attrs.order;
  // CommonMark only accepts list numbers of up to nine digits.
  const start =
    typeof order === "number" && Number.isInteger(order) && order >= 0 && order < 1e9 ? order : 1;
  return { bullet: (index) => `${start + index}. `, lead: () => "" };
};

// A list nested directly in a list (as Jira does for task lists) is indented under the item before it.
const renderList = (node: AdfNode, depth: number, style: ListStyle): string => {
  const lines: string[] = [];
  let index = 0;
  let nestWidth = 2;
  for (const child of node.content) {
    if (LIST_TYPES.has(child.type)) {
      lines.push(indent(renderBlock(child, depth), nestWidth));
      continue;
    }
    const bullet = style.bullet(index++);
    nestWidth = bullet.length;
    lines.push(renderListItem(child, depth, bullet, style.lead(child)));
  }
  return lines.filter((line) => line !== "").join("\n");
};

const renderListItem = (item: AdfNode, depth: number, bullet: string, lead: string): string => {
  const body = `${lead}${joinItemParts(renderBlockParts(item.content, depth))}`;
  if (body.trim() === "") return bullet.trimEnd();
  return `${bullet}${indent(body, bullet.length).trimStart()}`;
};

// A nested list follows its item's text directly, which keeps the outer list tight.
const joinItemParts = (parts: BlockPart[]): string =>
  parts
    .map(
      (part, index) => (index === 0 ? "" : LIST_TYPES.has(part.type) ? "\n" : "\n\n") + part.text,
    )
    .join("");

const indent = (text: string, width: number): string => {
  const pad = " ".repeat(width);
  return text
    .split("\n")
    .map((line) => (line === "" ? "" : `${pad}${line}`))
    .join("\n");
};

const quote = (text: string): string =>
  text === ""
    ? ""
    : text
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");

const renderCodeBlock = (node: AdfNode): string => {
  const code = node.content
    .map((child) => (child.type === "text" ? child.text : "\n"))
    .join("")
    .replace(/\r\n?/g, "\n")
    .replace(/\n$/, "");
  const fence = "`".repeat(Math.max(3, longestBacktickRun(code) + 1));
  const language = stringAttr(node, "language");
  const info = /^[\w+#.-]{1,40}$/.test(language) ? language : "";
  return code === "" ? `${fence}${info}\n${fence}` : `${fence}${info}\n${code}\n${fence}`;
};

const renderPanel = (node: AdfNode, depth: number): string => {
  const label = lookup(PANEL_LABELS, stringAttr(node, "panelType"));
  const body = joinBlocks(renderBlockParts(node.content, depth));
  return quote([label ? `**${label}:**` : "", body].filter((part) => part !== "").join("\n"));
};

const renderExpand = (node: AdfNode, depth: number): string => {
  const title = stringAttr(node, "title").replace(/\s+/g, " ").trim();
  const heading = title
    ? [{ type: "paragraph", text: `**${escapeLineStart(escapeText(title))}**` }]
    : [];
  return joinBlocks([...heading, ...renderBlockParts(node.content, depth)]);
};

const renderTable = (node: AdfNode, depth: number): string => {
  const rows = node.content
    .filter((row) => row.type === "tableRow")
    .map((row) => renderRow(row, depth));
  const width = rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const [first] = rows;
  if (!first || width === 0) return "";
  const header = first.isHeader ? first.cells : [];
  const body = first.isHeader ? rows.slice(1) : rows;
  return [header, Array(width).fill("---"), ...body.map((row) => row.cells)]
    .map((cells) => formatRow(cells, width))
    .join("\n");
};

const renderRow = (row: AdfNode, depth: number): { cells: string[]; isHeader: boolean } => {
  const cells = row.content.filter(
    (cell) => cell.type === "tableCell" || cell.type === "tableHeader",
  );
  return {
    cells: cells.flatMap((cell) => [
      renderCell(cell, depth),
      ...Array(colspanPadding(cell)).fill(""),
    ]),
    isHeader: cells.some((cell) => cell.type === "tableHeader"),
  };
};

const colspanPadding = (cell: AdfNode): number => {
  const span = Number(cell.attrs.colspan);
  return Number.isInteger(span) ? Math.min(MAX_COLSPAN, Math.max(1, span)) - 1 : 0;
};

// A GFM cell is one line, and raw HTML such as <br> is not rendered, so cell blocks join with spaces.
const renderCell = (cell: AdfNode, depth: number): string =>
  escapePipes(
    joinBlocks(renderBlockParts(cell.content, depth + 1))
      .replace(/\\\n/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );

const formatRow = (cells: string[], width: number): string => {
  const padded = Array.from({ length: width }, (_, index) => cells[index] ?? "");
  return `| ${padded.join(" | ")} |`;
};

// GFM splits cells before parsing code spans, so a pipe needs escaping even inside one.
const escapePipes = (text: string): string => {
  let result = "";
  let backslashes = 0;
  for (const char of text) {
    result += char === "|" && backslashes % 2 === 0 ? "\\|" : char;
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  return result;
};
