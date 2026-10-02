import { useMemo } from "react";
import { fencedCode } from "./code-fence";
import { MarkdownView } from "./MarkdownView";

/** Code with syntax highlight: the chat's highlighter, through a fence nothing in it can close. */
export const CodeView = ({ text, language }: { text: string; language: string | null }) => {
  const markdown = useMemo(() => fencedCode(text, language), [text, language]);
  return (
    <div data-testid="artifact-code" className="artifact-code">
      <MarkdownView text={markdown} />
    </div>
  );
};

/** Plain text, as written. */
export const TextView = ({ text }: { text: string }) => (
  <pre
    data-testid="artifact-text"
    className="min-w-0 whitespace-pre-wrap break-words px-6 py-5 font-mono text-[13px] leading-relaxed text-text"
  >
    {text}
  </pre>
);
