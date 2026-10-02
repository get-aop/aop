import type { ArtifactKind } from "@aop/common";
import { CodeView, TextView } from "./CodeView";
import { CsvTable } from "./CsvTable";
import { HtmlFrame } from "./HtmlFrame";
import { JsonTree } from "./JsonTree";
import { MarkdownView } from "./MarkdownView";
import { ImageView, PdfView } from "./MediaViews";
import { MermaidView } from "./MermaidView";

export interface ArtifactContent {
  kind: ArtifactKind;
  blob: Blob;
  mimeType: string;
  /** The bytes as text, for every kind that is text. */
  text: string | null;
  language: string | null;
  title: string;
}

/**
 * One version of an artifact, drawn as its kind; `raw` shows a text kind's source instead. JSON
 * that does not parse falls back to its text, so the view never hides what the file holds.
 */
export const ArtifactBody = ({ content, raw }: { content: ArtifactContent; raw: boolean }) => {
  const { kind, text } = content;
  if (text !== null && raw)
    return <CodeView text={text} language={rawLanguage(kind, content.language)} />;
  switch (kind) {
    case "image":
    case "svg":
      return (
        <ImageView
          blob={content.blob}
          mimeType={kind === "svg" ? "image/svg+xml" : content.mimeType}
          alt={content.title}
        />
      );
    case "pdf":
      return <PdfView blob={content.blob} title={content.title} />;
    default:
      return text === null ? (
        <TextView text="This file is not text." />
      ) : (
        <TextBody content={content} text={text} />
      );
  }
};

const TextBody = ({ content, text }: { content: ArtifactContent; text: string }) => {
  switch (content.kind) {
    case "markdown":
      return <MarkdownView text={text} />;
    case "json":
      return <JsonBody text={text} />;
    case "csv":
      return <CsvTable text={text} />;
    case "mermaid":
      return <MermaidView source={text} />;
    case "html":
      return <HtmlFrame html={text} title={content.title} />;
    case "code":
      return <CodeView text={text} language={content.language} />;
    default:
      return <TextView text={text} />;
  }
};

const JsonBody = ({ text }: { text: string }) => {
  try {
    return <JsonTree value={JSON.parse(text)} />;
  } catch {
    return <TextView text={text} />;
  }
};

/** Whether a kind has a drawn view and a source view to switch between. */
export const hasRawView = (kind: ArtifactKind): boolean =>
  kind === "markdown" ||
  kind === "json" ||
  kind === "csv" ||
  kind === "mermaid" ||
  kind === "html" ||
  kind === "svg";

const RAW_LANGUAGES: Partial<Record<ArtifactKind, string>> = {
  markdown: "markdown",
  json: "json",
  html: "html",
  svg: "xml",
  csv: "csv",
  mermaid: "mmd",
};

const rawLanguage = (kind: ArtifactKind, language: string | null): string | null =>
  kind === "code" ? language : (RAW_LANGUAGES[kind] ?? null);
