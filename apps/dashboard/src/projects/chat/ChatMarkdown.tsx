import { CheckIcon, ChevronsUpDownIcon, CopyIcon } from "lucide-react";
import type { AnchorHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from "react";
import { createContext, memo, useContext, useEffect, useRef, useState } from "react";
import remarkBreaks from "remark-breaks";
import { defaultRemarkPlugins, Streamdown } from "streamdown";
import { openExternalUrl } from "../../api/client";
import { lazyCodeHighlighter } from "../../components/lazy-code-highlighter";
import { isDesktopApp } from "../../utils/desktop-runtime";
import { chipIndexOf, threadChipOf, withThreadChips } from "./inline-run";
import { remarkLiteralHtml } from "./literal-html";
import { ThreadChip } from "./ThreadChip";

interface ChatMarkdownProps {
  content: string;
  /**
   * `streaming` for prose of a reply that was watched being written: Streamdown completes the
   * markdown that is still open (a fence, a link) instead of showing it raw. Everything else,
   * finished messages from history included, renders `static`. It is fixed for a mounted reply,
   * so finishing does not re-render its prose in another mode.
   */
  mode?: "static" | "streaming";
  /** Text is still arriving at the end of this prose: Streamdown marks the end with a caret. */
  animating?: boolean;
  desktop?: boolean;
  openLink?: (url: string) => void;
  /** What the links made by `proseOf` stand for: chips that sit inside the paragraph. */
  chips?: readonly ReactNode[];
}

const NO_CHIPS: readonly ReactNode[] = [];

const ChatLinkContext = createContext({
  desktop: false,
  openLink: openExternalUrl,
  chips: NO_CHIPS,
});

// Memoized so history rows and live text do not re-parse markdown on
// unrelated re-renders (progress frames included).
export const ChatMarkdown = memo(function ChatMarkdown({
  content,
  mode = "static",
  animating = false,
  desktop = isDesktopApp(),
  openLink = openExternalUrl,
  chips = NO_CHIPS,
}: ChatMarkdownProps) {
  if (!content.trim()) return null;
  return (
    <ChatLinkContext.Provider value={{ desktop, openLink, chips }}>
      <div className="chat-markdown text-body text-foreground" data-testid="chat-markdown">
        {/* One animation only: the reveal types the words; Streamdown's own stays off. */}
        <Streamdown
          mode={mode}
          isAnimating={animating}
          caret={animating ? "circle" : undefined}
          animated={false}
          plugins={plugins}
          components={components}
          remarkPlugins={remarkPlugins}
        >
          {withThreadChips(content)}
        </Streamdown>
      </div>
    </ChatLinkContext.Provider>
  );
});

const plugins = { code: lazyCodeHighlighter };
// A single newline in a chat message is a line break, as in every chat app (plain markdown folds it
// into a space). remark-breaks only touches newlines inside paragraph text, so lists, tables and
// code stay as they are.
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkLiteralHtml, remarkBreaks];
type ChildrenProps = { children?: ReactNode };

const components = {
  a: ChatLink,
  code: ChatCode,
  pre: ChatCodeBlock,
  table: ChatTable,
};

function ChatLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & ChildrenProps) {
  const { desktop, openLink, chips } = useContext(ChatLinkContext);
  const thread = threadChipOf(href);
  if (thread !== null) return <ThreadChip threadId={thread} />;
  const chip = chipIndexOf(href);
  if (chip !== null) return <>{chips[chip] ?? null}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      {...props}
      onClick={(event) => handleLinkClick(event, href, desktop, openLink)}
    >
      {children}
    </a>
  );
}

function ChatCode({ children, className, ...props }: HTMLAttributes<HTMLElement> & ChildrenProps) {
  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
}

function ChatCodeBlock({ children, ...props }: HTMLAttributes<HTMLPreElement> & ChildrenProps) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [copied, copy] = useCopiedState();

  const copyCode = async () => {
    const content = codeRef.current?.querySelector("code")?.textContent?.replace(/\r?\n$/, "");
    if (content !== undefined) await copy(content);
  };

  return (
    <div className="chat-markdown-codeblock">
      <div className="chat-markdown-codeblock-header">
        <span className="chat-markdown-codeblock-title">Code</span>
        <button
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
          onClick={() => void copyCode()}
          className="chat-markdown-chrome-action inline-flex size-6 items-center justify-center rounded-md"
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <pre {...props} ref={codeRef}>
        {children}
      </pre>
    </div>
  );
}

function ChatTable({ children, ...props }: HTMLAttributes<HTMLTableElement> & ChildrenProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, copy] = useCopiedState();
  const copyTable = async () => {
    const text = containerRef.current?.querySelector("table")?.textContent?.trim();
    if (text) await copy(text);
  };
  return (
    <div
      ref={containerRef}
      className="chat-markdown-table-container overflow-x-auto"
      data-expanded={expanded ? "true" : "false"}
    >
      <table {...props}>{children}</table>
      <div className="chat-markdown-table-footer">
        <button
          type="button"
          aria-pressed={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="chat-markdown-chrome-action inline-flex size-6 items-center justify-center rounded-md"
          title={expanded ? "Collapse table cells" : "Expand table cells"}
        >
          <ChevronsUpDownIcon className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => void copyTable()}
          className="chat-markdown-chrome-action inline-flex size-6 items-center justify-center rounded-md"
          title={copied ? "Copied" : "Copy table"}
        >
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
    </div>
  );
}

const useCopiedState = (): [boolean, (text: string) => Promise<void>] => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  };
  return [copied, copy];
};

const handleLinkClick = (
  event: MouseEvent<HTMLAnchorElement>,
  href: string | undefined,
  desktop: boolean,
  openLink: (url: string) => void,
): void => {
  if (!href || !desktop) return;
  event.preventDefault();
  openLink(href);
};
