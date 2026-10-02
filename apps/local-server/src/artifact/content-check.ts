import { type ArtifactKind, TEXT_ARTIFACT_KINDS } from "@aop/common";

/**
 * Whether bytes can be shown as the kind an agent named, and why not: an agent hears the reason
 * and can fix its content, instead of the person opening a view that cannot draw it. Only what
 * the view needs is checked; a Mermaid diagram's syntax is the browser's to check, since the
 * parser needs a DOM.
 */
export const checkArtifactContent = (
  kind: ArtifactKind,
  bytes: Uint8Array,
  mimeType: string,
): string | null => {
  if (kind === "image") {
    return mimeType.startsWith("image/") && mimeType !== "image/svg+xml"
      ? null
      : "An image artifact must be a PNG, JPEG, GIF or WebP file; save it from `path`";
  }
  if (kind === "pdf") {
    return mimeType === "application/pdf" ? null : "A pdf artifact must be a PDF file";
  }
  if (!TEXT_ARTIFACT_KINDS.has(kind)) return null;
  const text = decodeText(bytes);
  if (text === null) return `A ${kind} artifact must be UTF-8 text`;
  return TEXT_CHECKS[kind]?.(text) ?? null;
};

const TEXT_CHECKS: Partial<Record<ArtifactKind, (text: string) => string | null>> = {
  json: (text) => {
    try {
      JSON.parse(text);
      return null;
    } catch (error) {
      return `The content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
  csv: (text) =>
    text.split(/\r?\n/, 1)[0]?.trim() ? null : "A csv artifact starts with its header row",
  mermaid: (text) =>
    MERMAID_START.test(firstStatement(text))
      ? null
      : "A mermaid artifact starts with its diagram type, such as `flowchart TD` or `sequenceDiagram`, with no ``` fence",
  svg: (text) => (/<svg[\s>]/i.test(text) ? null : "An svg artifact must contain an <svg> element"),
};

const MERMAID_START =
  /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|zenuml|radar-beta|treemap-beta)\b/;

// Front matter (`---`), directives (`%%{...}%%`) and comments (`%%`) may come before the type.
const firstStatement = (text: string): string => {
  const lines = text.split(/\r?\n/);
  let index = 0;
  if (lines[0]?.trim() === "---") {
    index = lines.findIndex((line, at) => at > 0 && line.trim() === "---") + 1;
  }
  for (; index < lines.length; index++) {
    const line = lines[index]?.trim() ?? "";
    if (line && !line.startsWith("%%")) return line;
  }
  return "";
};

const decodeText = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};
