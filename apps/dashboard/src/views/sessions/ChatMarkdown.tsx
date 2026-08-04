import { code } from "@streamdown/code";
import { CheckIcon, ChevronsUpDownIcon, CopyIcon } from "lucide-react";
import type { AnchorHTMLAttributes, HTMLAttributes, MouseEvent, ReactNode } from "react";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { openExternalUrl } from "../../api/client";
import { isTauriWebView } from "../../utils/desktop-runtime";

interface ChatMarkdownProps {
  content: string;
  desktop?: boolean;
  openLink?: (url: string) => Promise<void>;
  lineBreaks?: boolean;
}

const ChatLinkContext = createContext({
  desktop: false,
  openLink: openExternalUrl,
});

export const ChatMarkdown = ({
  content,
  desktop = isTauriWebView(),
  openLink = openExternalUrl,
  lineBreaks = false,
}: ChatMarkdownProps) => {
  if (!content.trim()) return null;
  return (
    <ChatLinkContext.Provider value={{ desktop, openLink }}>
      <div
        className={`chat-markdown text-sm leading-relaxed text-foreground${lineBreaks ? " chat-markdown--line-breaks" : ""}`}
        data-testid="chat-markdown"
      >
        <Streamdown plugins={plugins} components={components}>
          {content}
        </Streamdown>
      </div>
    </ChatLinkContext.Provider>
  );
};

const plugins = { code };
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
  const { desktop, openLink } = useContext(ChatLinkContext);
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
  openLink: (url: string) => Promise<void>,
): void => {
  if (!href || !desktop) return;
  event.preventDefault();
  void openLink(href).catch(() => undefined);
};
