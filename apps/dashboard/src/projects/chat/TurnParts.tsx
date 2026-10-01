import type { ToolPart } from "@aop/common";
import { BrainIcon, CheckIcon, ChevronRightIcon, WrenchIcon, XIcon } from "lucide-react";
import { memo, useState } from "react";
import { cn } from "@/lib/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { Spinner } from "@/ui/spinner";
import { ChatMarkdown } from "./ChatMarkdown";

/**
 * Tool calls the agent made one after another, where it made them in the reply. One call is a
 * single row; several fold into a line that counts them, which opens to their rows. While the run
 * is the newest thing the agent is doing (`active`), the line names the call in progress.
 */
export const ToolRun = memo(function ToolRun({
  tools,
  active,
}: {
  tools: readonly ToolPart[];
  active: boolean;
}) {
  if (tools.length === 1 && tools[0]) return <ToolRow tool={tools[0]} />;
  const failed = tools.filter((tool) => tool.status === "failed").length;
  const current = active ? tools.findLast((tool) => tool.status === "running") : undefined;
  return (
    <Collapsible data-testid="tool-run" className="group/run my-1 max-w-xl">
      <CollapsibleTrigger
        data-testid="tool-run-toggle"
        className="flex max-w-full items-center gap-1.5 rounded-row px-1 py-0.5 text-meta text-text-subtle outline-none transition-colors duration-[120ms] hover:text-text-muted"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]/run:rotate-90"
        />
        {current ? (
          <Spinner className="size-3" />
        ) : (
          <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span data-testid="tool-run-summary" className="truncate">
          {summaryOf(tools.length, failed)}
          {current ? ` · ${toolLabel(current.name)}` : ""}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-0.5 flex flex-col border-l border-border pl-2">
          {tools.map((tool) => (
            <li key={tool.id}>
              <ToolRow tool={tool} />
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
});

/** One call: its status, its name, and what it was asked to do, which opens in full on a click. */
const ToolRow = ({ tool }: { tool: ToolPart }) => {
  const [open, setOpen] = useState(false);
  const label = toolLabel(tool.name);
  return (
    <button
      type="button"
      data-testid="tool-call"
      data-status={tool.status}
      aria-expanded={tool.detail ? open : undefined}
      disabled={!tool.detail}
      onClick={() => setOpen((value) => !value)}
      title={tool.name}
      className="my-0.5 flex w-full max-w-xl min-w-0 items-baseline gap-2 rounded-row px-1 py-0.5 text-left text-meta text-text-subtle transition-colors duration-[120ms] enabled:hover:text-text-muted"
    >
      <ToolStatus status={tool.status} />
      <span className="shrink-0 font-medium text-text-muted">{label}</span>
      {tool.detail ? (
        <span
          data-testid="tool-call-detail"
          className={cn(
            "min-w-0 font-mono text-xs",
            open ? "whitespace-pre-wrap break-all" : "truncate",
          )}
        >
          {tool.detail}
        </span>
      ) : null}
    </button>
  );
};

const ToolStatus = ({ status }: { status: ToolPart["status"] }) => {
  if (status === "running") return <Spinner className="size-2.5 shrink-0 self-center" />;
  return status === "failed" ? (
    <XIcon aria-label="Failed" className="size-3 shrink-0 self-center text-blocked" />
  ) : (
    <CheckIcon aria-label="Done" className="size-3 shrink-0 self-center text-ok" />
  );
};

/**
 * What the model reasoned, folded to one line. It opens to the reasoning; while it is the newest
 * thing the agent is doing (`active`), the line says it is thinking.
 */
export const ThinkingSection = memo(function ThinkingSection({
  text,
  active,
}: {
  text: string;
  active: boolean;
}) {
  return (
    <Collapsible data-testid="thinking" data-active={active} className="group/think my-1 max-w-xl">
      <CollapsibleTrigger
        data-testid="thinking-toggle"
        className="flex items-center gap-1.5 rounded-row px-1 py-0.5 text-meta text-text-subtle outline-none transition-colors duration-[120ms] hover:text-text-muted"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]/think:rotate-90"
        />
        <BrainIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", active && "animate-pulse")}
        />
        <span>{active ? "Thinking…" : "Thinking"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div
          data-testid="thinking-text"
          className="mt-1 border-l border-border pl-3 text-meta text-text-muted"
        >
          <ChatMarkdown content={text} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
});

/** An MCP tool reads as its server and its own name ("aop · thread spawn"), anything else as named. */
export const toolLabel = (name: string): string => {
  const mcp = /^mcp (\S+) (.+)$/.exec(name);
  return mcp ? `${mcp[1]} · ${mcp[2]}` : name;
};

const summaryOf = (count: number, failed: number): string => {
  const calls = `${count} tool calls`;
  return failed > 0 ? `${calls} · ${failed} failed` : calls;
};
