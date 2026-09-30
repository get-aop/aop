import type { ActivityRow, ThreadTurnActivity } from "@aop/common";
import { CheckIcon, ChevronRightIcon, WrenchIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/ui/collapsible";
import { Spinner } from "@/ui/spinner";
import { ChatMarkdown } from "../chat/ChatMarkdown";

/**
 * What the agent did to write one reply: its tool calls, folded to a line, and the status
 * paragraphs it said on the way. The words of the reply itself are drawn by the message.
 */
export const WorkLog = ({ turn }: { turn: ThreadTurnActivity }) => {
  const rows = turn.groups.flatMap((group) => group.rows);
  const failed = rows.filter((row) => row.status === "failed").length;
  const latest = turn.running ? rows.findLast((row) => row.status === "running") : undefined;

  return (
    <Collapsible
      data-testid="work-log"
      data-turn-id={turn.messageId}
      data-running={turn.running}
      className="group/log mb-1.5 max-w-xl"
    >
      <CollapsibleTrigger
        data-testid="work-log-toggle"
        className="flex max-w-full items-center gap-1.5 rounded-row px-1 py-0.5 text-[12px] text-text-subtle outline-none transition-colors duration-[120ms] hover:text-text-muted"
      >
        <ChevronRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform group-data-[state=open]/log:rotate-90"
        />
        {turn.running ? (
          <Spinner className="size-3" />
        ) : (
          <WrenchIcon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span data-testid="work-log-summary" className="truncate">
          {summaryOf(rows.length, failed)}
          {latest ? ` · ${latest.label}` : ""}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 flex flex-col gap-2 border-l border-border pl-3">
          {turn.narration ? (
            <div data-testid="work-log-narration" className="text-text-muted">
              <ChatMarkdown content={turn.narration} />
            </div>
          ) : null}
          {rows.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {rows.map((row) => (
                <Row key={row.id} row={row} />
              ))}
            </ul>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

const Row = ({ row }: { row: ActivityRow }) => (
  <li
    data-testid="work-log-row"
    data-status={row.status}
    className="flex min-w-0 items-baseline gap-2 text-[12px] leading-snug"
  >
    <RowStatus status={row.status} />
    <span className="shrink-0 font-medium text-text-muted">{row.label}</span>
    {row.detail ? (
      <span
        className="min-w-0 truncate font-mono text-[11.5px] text-text-subtle"
        title={row.detail}
      >
        {row.detail}
      </span>
    ) : null}
  </li>
);

const RowStatus = ({ status }: { status: ActivityRow["status"] }) => {
  if (status === "running") return <Spinner className="size-2.5 self-center" />;
  return status === "failed" ? (
    <XIcon aria-label="Failed" className={cn("size-3 shrink-0 self-center text-blocked")} />
  ) : (
    <CheckIcon aria-label="Done" className="size-3 shrink-0 self-center text-ok" />
  );
};

const summaryOf = (count: number, failed: number): string => {
  const calls = count === 1 ? "1 tool call" : `${count} tool calls`;
  return failed > 0 ? `${calls} · ${failed} failed` : count === 0 ? "Worked" : calls;
};
