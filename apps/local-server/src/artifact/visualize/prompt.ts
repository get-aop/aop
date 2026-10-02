import { VISUALIZE_LIMITS, type VisualizeCandidate, type VisualizeType } from "@aop/common";

/**
 * What the Visualize run is told. It replaces the CLI's own system prompt: the run needs none of
 * what an agent is told, and that prompt is most of a small run's input.
 */
export const VISUALIZE_SYSTEM_PROMPT = [
  "You draw ONE diagram of a chat reply, so a person sees its structure at a glance.",
  "Output ONLY the diagram source. No code fence, no explanation, nothing before or after it.",
  "",
  "Mermaid rules:",
  "- Use the diagram type you are asked for, starting with its keyword.",
  '- Node ids are short ASCII words (A, B, step1). Put every flowchart label in double quotes: A["Bump the version"].',
  "- Labels are short (at most 6 words) and use the reply's own words. Never put double quotes inside a label; use <br/> for a line break.",
  "- No styling: no style, classDef, linkStyle, click or init directives.",
  "- At most 30 nodes. Merge minor points into their parent.",
  "",
  "When asked for a table, output only a GitHub-flavored Markdown table with a header row, summarizing the reply's key points.",
].join("\n");

const TYPE_INSTRUCTIONS: Record<VisualizeType, string> = {
  auto: "Choose the Mermaid diagram that fits the reply best: `flowchart TD` for steps, decisions or a process; `sequenceDiagram` for parties talking over time; `mindmap` for a topic and its branches; `timeline` for dated events.",
  flowchart:
    "Draw a Mermaid flowchart. Start with `flowchart TD`, or `flowchart LR` for a short chain of steps. Use {\"...\"} for decisions and label their edges: A -->|Yes| B.",
  sequence:
    "Draw a Mermaid sequence diagram. Start with `sequenceDiagram`. Declare each party as `participant A as Name` with a plain name, and write messages as `A->>B: text` with no colon in the text.",
  mindmap:
    "Draw a Mermaid mindmap. Start with `mindmap`, then one root written `root((Topic))`, and its branches indented two spaces per level. Branches are plain text with no brackets, quotes or colons.",
  timeline:
    "Draw a Mermaid timeline. Start with `timeline`, then `title <title>`, then one `<period> : <event>` line per event, with no colon inside a period or an event.",
  table: "Write a GitHub-flavored Markdown table that summarizes the reply. No Mermaid.",
};

export const buildVisualizePrompt = (type: VisualizeType, reply: string): string =>
  [
    TYPE_INSTRUCTIONS[type],
    "",
    "The reply:",
    "<reply>",
    clip(reply, VISUALIZE_LIMITS.replyMaxChars),
    "</reply>",
  ].join("\n");

/**
 * Asks for a diagram that parses, from the one that did not and what the parser said. The reply
 * is not sent again: the diagram holds what it says, and the run stays small.
 */
export const buildRepairPrompt = (type: VisualizeType, source: string, error: string): string =>
  [
    "This Mermaid diagram does not parse. Rewrite it so it parses, keeping what it shows.",
    type === "auto" || type === "table" ? "" : TYPE_INSTRUCTIONS[type],
    "",
    "The parser said:",
    clip(error, VISUALIZE_LIMITS.errorMaxChars),
    "",
    "The diagram:",
    source,
  ].join("\n");

/**
 * The diagram in what the model wrote: the first fenced block if it fenced one anyway, else all
 * of it. A table is Markdown; everything else is Mermaid. Null when nothing is left.
 */
export const extractCandidate = (text: string, type: VisualizeType): VisualizeCandidate | null => {
  const fenced = /```[a-zA-Z]*[ \t]*\n([\s\S]*?)\n?```/.exec(text);
  const source = (fenced?.[1] ?? text).trim().slice(0, VISUALIZE_LIMITS.sourceMaxChars);
  if (!source) return null;
  if (type === "table") return isMarkdownTable(source) ? { kind: "markdown", source } : null;
  return { kind: "mermaid", source };
};

const isMarkdownTable = (source: string): boolean => {
  const lines = source.split("\n").map((line) => line.trim());
  return lines.some((line, index) => line.startsWith("|") && /^\|?\s*:?-{3,}/.test(lines[index + 1] ?? ""));
};

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}\n[… the rest of the reply is left out]` : text;
