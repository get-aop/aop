import { memo } from "react";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import { openExternalUrl } from "../../../api/client";
import { lazyCodeHighlighter } from "../../../components/lazy-code-highlighter";
import { isDesktopApp } from "../../../utils/desktop-runtime";
import { lazyMermaidPlugin } from "../mermaid";

/**
 * A document in the artifact view: GitHub-flavored Markdown with highlighted code and ```mermaid
 * fences drawn as diagrams. It goes through the same renderer and sanitizer as chat replies, and
 * its links open outside the app.
 */
export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  return (
    <div
      data-testid="artifact-markdown"
      className="chat-markdown artifact-markdown mx-auto max-w-3xl px-6 py-5 text-body text-foreground"
    >
      <Streamdown
        mode="static"
        animated={false}
        plugins={plugins}
        remarkPlugins={remarkPlugins}
        components={components}
        controls={{
          table: true,
          code: true,
          mermaid: { download: true, copy: true, fullscreen: true, panZoom: true },
        }}
      >
        {text}
      </Streamdown>
    </div>
  );
});

const plugins = { code: lazyCodeHighlighter, mermaid: lazyMermaidPlugin };
const remarkPlugins = Object.values(defaultRemarkPlugins);

const ExternalLink = ({ href, children, ...props }: React.ComponentProps<"a">) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    {...props}
    onClick={(event) => {
      if (!href || !isDesktopApp()) return;
      event.preventDefault();
      openExternalUrl(href);
    }}
  >
    {children}
  </a>
);

const components = { a: ExternalLink };
