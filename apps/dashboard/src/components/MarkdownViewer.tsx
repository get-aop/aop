import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

const components = {
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className="mb-4 mt-6 font-sans text-xl font-semibold tracking-tight text-text" {...props}>
      {children}
    </h1>
  ),
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className="mb-3 mt-6 font-sans text-lg font-semibold text-text" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className="mb-2 mt-4 font-sans text-base font-semibold text-text" {...props}>
      {children}
    </h3>
  ),
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className="mb-3 font-sans text-sm leading-relaxed text-text-muted" {...props}>
      {children}
    </p>
  ),
  a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      className="font-sans text-favorite underline decoration-favorite/30 hover:decoration-favorite"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      className="my-3 border-l-2 border-favorite/40 pl-4 font-sans text-sm text-text-subtle"
      {...props}
    >
      {children}
    </blockquote>
  ),
  code: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <code className="rounded-card bg-raised px-1.5 py-0.5 text-[11.5px] text-favorite" {...props}>
      {children}
    </code>
  ),
  pre: ({ children, ...props }: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      className="my-3 overflow-x-auto rounded-modal border border-border-strong bg-surface p-3 text-[11.5px] text-text-muted"
      {...props}
    >
      {children}
    </pre>
  ),
  table: ({ children, ...props }: React.HTMLAttributes<HTMLTableElement>) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse font-sans text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <th
      className="border border-border-strong bg-raised px-3 py-1.5 text-left font-sans text-sm font-semibold text-text"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }: React.HTMLAttributes<HTMLTableCellElement>) => (
    <td
      className="border border-border-strong px-3 py-1.5 font-sans text-sm text-text-muted"
      {...props}
    >
      {children}
    </td>
  ),
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className="my-2 list-inside list-disc space-y-1 font-sans text-sm text-text-muted"
      {...props}
    >
      {children}
    </ul>
  ),
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className="my-2 list-inside list-decimal space-y-1 font-sans text-sm text-text-muted"
      {...props}
    >
      {children}
    </ol>
  ),
  li: ({ children, ...props }: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className="font-sans text-sm text-text-muted" {...props}>
      {children}
    </li>
  ),
  input: (props: React.InputHTMLAttributes<HTMLInputElement>) => {
    if (props.type === "checkbox") {
      return <input {...props} disabled className="aop-checkbox" />;
    }
    return <input {...props} />;
  },
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr className="my-4 border-border-strong" {...props} />
  ),
  strong: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) => (
    <strong className="font-medium text-text" {...props}>
      {children}
    </strong>
  ),
};

const plugins = { code };

interface MarkdownViewerProps {
  content: string;
}

export const MarkdownViewer = ({ content }: MarkdownViewerProps) => (
  <div className="markdown-viewer" data-testid="markdown-viewer">
    <Streamdown plugins={plugins} components={components}>
      {content}
    </Streamdown>
  </div>
);
