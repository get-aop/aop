interface AdfNode {
  type?: string;
  text?: string;
  content?: unknown[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
}

export const formatJiraDescription = (description: unknown): string | null => {
  if (typeof description === "string") {
    return normalizeDescription(description);
  }

  const node = toAdfNode(description);
  return node ? normalizeDescription(renderBlockNode(node)) : null;
};

const renderBlockNode = (node: AdfNode): string => {
  switch (node.type) {
    case "doc":
      return renderBlockContent(node).join("\n\n");
    case "heading":
      return renderHeading(node);
    case "paragraph":
      return renderInlineContent(node).trim();
    case "bulletList":
      return renderList(node, "bullet");
    case "orderedList":
      return renderList(node, "ordered");
    case "listItem":
      return renderBlockContent(node).join("\n");
    case "codeBlock":
      return renderCodeBlock(node);
    case "blockquote":
      return renderBlockquote(node);
    case "panel":
      return renderBlockContent(node).join("\n\n");
    default:
      return renderInlineContent(node).trim() || renderBlockContent(node).join("\n\n");
  }
};

const renderInlineNode = (node: AdfNode): string => {
  switch (node.type) {
    case "text":
      return renderTextNode(node);
    case "hardBreak":
      return "\n";
    case "mention":
      return getStringAttr(node, "text") ?? getStringAttr(node, "displayName") ?? "";
    case "inlineCard":
      return getStringAttr(node, "url") ?? "";
    default:
      return renderInlineContent(node);
  }
};

const renderHeading = (node: AdfNode): string => {
  const level = clampHeadingLevel(getNumberAttr(node, "level") ?? 1);
  const text = renderInlineContent(node).trim();
  return text ? `${"#".repeat(level)} ${text}` : "";
};

const renderList = (node: AdfNode, kind: "bullet" | "ordered"): string =>
  getContent(node)
    .map((item, index) => renderListItem(item, kind, index))
    .filter((line) => line.length > 0)
    .join("\n");

const renderListItem = (item: AdfNode, kind: "bullet" | "ordered", index: number): string => {
  const body = renderBlockNode(item).trim();
  if (!body) {
    return "";
  }

  const marker = kind === "bullet" ? "-" : `${index + 1}.`;
  return `${marker} ${body.replaceAll("\n", "\n  ")}`;
};

const renderCodeBlock = (node: AdfNode): string => {
  const code = renderInlineContent(node).trimEnd();
  return code ? `\`\`\`\n${code}\n\`\`\`` : "";
};

const renderBlockquote = (node: AdfNode): string =>
  renderBlockContent(node)
    .join("\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => `> ${line}`)
    .join("\n");

const renderBlockContent = (node: AdfNode): string[] =>
  getContent(node)
    .map(renderBlockNode)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const renderInlineContent = (node: AdfNode): string =>
  getContent(node).map(renderInlineNode).join("");

const renderTextNode = (node: AdfNode): string => {
  const text = node.text ?? "";
  const link = getLinkMarkHref(node.marks);
  if (!link || text.includes(link)) {
    return text;
  }

  return `${text} (${link})`;
};

const getContent = (node: AdfNode): AdfNode[] =>
  (node.content ?? []).flatMap((value) => {
    const child = toAdfNode(value);
    return child ? [child] : [];
  });

const getLinkMarkHref = (marks: unknown[] | undefined): string | null => {
  for (const mark of marks ?? []) {
    const record = toRecord(mark);
    const attrs = toRecord(record?.attrs);
    if (record?.type === "link" && typeof attrs?.href === "string") {
      return attrs.href;
    }
  }

  return null;
};

const getStringAttr = (node: AdfNode, key: string): string | null => {
  const value = node.attrs?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
};

const getNumberAttr = (node: AdfNode, key: string): number | null => {
  const value = node.attrs?.[key];
  return typeof value === "number" ? value : null;
};

const clampHeadingLevel = (level: number): number => Math.min(6, Math.max(1, Math.trunc(level)));

const normalizeDescription = (value: string): string | null => {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized.length > 0 ? normalized : null;
};

const toAdfNode = (value: unknown): AdfNode | null => {
  const record = toRecord(value);
  return record ? (record as AdfNode) : null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
