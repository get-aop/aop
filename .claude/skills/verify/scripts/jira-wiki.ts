/**
 * Turns the fixtures' ADF into what else the fake Jira site needs: the wiki markup Jira Data
 * Center returns from REST v2 (`h2. Steps`, `*bold*`, `{code}`), and plain text for `text ~`
 * searches. Only the nodes jira-adf-fixtures.ts uses are covered.
 */
import type { AdfMark, AdfNode } from "./jira-adf-fixtures.ts";
import { PEOPLE } from "./jira-people.ts";

/** ADF as Data Center wiki markup. */
export function adfToWiki(node: AdfNode | null): string | null {
  return node ? block(node, "") : null;
}

/** Every word in a body, for `text ~` and `summary ~` matching. */
export function adfToText(node: AdfNode | null | undefined): string {
  if (!node) return "";
  if (node.text !== undefined) return node.text;
  const attrs = node.attrs ?? {};
  const own = [attrs.text, attrs.url, attrs.alt].filter((value) => typeof value === "string");
  return [...own, ...(node.content ?? []).map(adfToText)].join(" ");
}

type BlockRenderer = (node: AdfNode, prefix: string) => string;

const children = (node: AdfNode) => node.content ?? [];
const inlines = (node: AdfNode) => children(node).map(inlineWiki).join("");

const BLOCKS: Record<string, BlockRenderer> = {
  doc: (node) =>
    children(node)
      .map((child) => block(child, ""))
      .join("\n\n"),
  paragraph: inlines,
  heading: (node) => `h${node.attrs?.level ?? 2}. ${inlines(node)}`,
  bulletList: (node, prefix) => listLines(node, `${prefix}*`),
  orderedList: (node, prefix) => listLines(node, `${prefix}#`),
  taskList: (node) =>
    children(node)
      .map((task) => `* ${task.attrs?.state === "DONE" ? "(/)" : "(x)"} ${inlines(task)}`)
      .join("\n"),
  codeBlock: (node) => `{code:${node.attrs?.language ?? "none"}}\n${inlines(node)}\n{code}`,
  panel: (node) => {
    const macro = PANEL_MACROS[String(node.attrs?.panelType)] ?? "panel";
    return `{${macro}}\n${children(node)
      .map((child) => block(child, ""))
      .join("\n")}\n{${macro}}`;
  },
  table: (node) => children(node).map(tableRow).join("\n"),
  mediaSingle: (node) => `!${children(node)[0]?.attrs?.alt ?? "image.png"}|thumbnail!`,
  rule: () => "----",
};

const PANEL_MACROS: Record<string, string> = {
  info: "info",
  note: "note",
  warning: "warning",
  error: "warning",
  success: "tip",
};

const INLINES: Record<string, (node: AdfNode) => string> = {
  text: (node) => (node.marks ?? []).reduce(applyMark, node.text ?? ""),
  mention: (node) => {
    const who = Object.values(PEOPLE).find((person) => person.accountId === node.attrs?.id);
    return who ? `[~${who.name}]` : String(node.attrs?.text ?? "");
  },
  emoji: (node) => String(node.attrs?.text ?? node.attrs?.shortName ?? ""),
  hardBreak: () => "\n",
  inlineCard: (node) => `[${node.attrs?.url}]`,
};

const MARKS: Record<string, (value: string, mark: AdfMark) => string> = {
  strong: (value) => `*${value}*`,
  em: (value) => `_${value}_`,
  code: (value) => `{{${value}}}`,
  strike: (value) => `-${value}-`,
  link: (value, mark) => `[${value}|${mark.attrs?.href}]`,
};

function block(node: AdfNode, prefix: string): string {
  const render = BLOCKS[node.type];
  return render ? render(node, prefix) : inlines(node);
}

function inlineWiki(node: AdfNode): string {
  const render = INLINES[node.type];
  return render ? render(node) : "";
}

function applyMark(value: string, mark: AdfMark): string {
  const render = MARKS[mark.type];
  return render ? render(value, mark) : value;
}

/** A list item's paragraphs follow its marker; nested lists continue the marker (`**`, `#*`). */
function listLines(list: AdfNode, prefix: string): string {
  return children(list)
    .flatMap((item) =>
      children(item).map((child) =>
        child.type.endsWith("List") ? block(child, prefix) : `${prefix} ${block(child, prefix)}`,
      ),
    )
    .join("\n");
}

function tableRow(row: AdfNode): string {
  const cells = children(row);
  const header = cells[0]?.type === "tableHeader";
  const separator = header ? "||" : "|";
  const values = cells.map((cell) =>
    children(cell)
      .map((child) => block(child, ""))
      .join(" "),
  );
  return `${separator}${values.join(separator)}${separator}`;
}
