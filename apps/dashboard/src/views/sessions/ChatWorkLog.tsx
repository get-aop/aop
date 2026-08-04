import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  MinusIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Marker } from "@/ui/marker";
import type { ChatSessionMessage } from "../../api/client";
import { ChatMarkdown } from "./ChatMarkdown";
import type { StreamCommandGroup, StreamCommandRow } from "./ChatStreamActivity";
import {
  activityContentWithoutFinal,
  continuityStatusLabel,
  formatWorkedLabel,
  hasRunActivity,
} from "./chat-timeline-model";

export const CompletedRunActivity = memo(function CompletedRunActivity({
  message,
  previousUserCreatedAt,
}: {
  message: ChatSessionMessage;
  previousUserCreatedAt: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!hasRunActivity(message)) return null;
  const Icon = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <Marker className="border-b border-border/60 pb-1">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex cursor-pointer select-none items-center gap-1 rounded-row px-1 text-[12px] text-text-muted tabular-nums transition-colors hover:bg-hover hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-running/70"
      >
        <span>{formatWorkedLabel(message, previousUserCreatedAt)}</span>
        <Icon className="size-3.5" />
      </button>
      {expanded ? (
        <RunActivityBody
          thinking={message.activity?.thinking ?? ""}
          content={activityContentWithoutFinal(message)}
          commandGroups={message.activity?.commandGroups ?? []}
          continuity={continuityStatusLabel(message)}
          active={false}
        />
      ) : null}
    </Marker>
  );
});

export const LiveRunActivity = ({
  thinking,
  content,
  commandGroups,
  typing,
  startedAt,
}: {
  thinking: string;
  content: string;
  commandGroups: StreamCommandGroup[];
  typing: boolean;
  startedAt: string | null;
}) => (
  <div className="space-y-2 px-1 py-0.5" data-testid="chat-stream-activity">
    <RunActivityBody
      thinking={thinking}
      content={content}
      commandGroups={commandGroups}
      continuity={null}
      active={typing}
    />
    {typing ? <WorkingRow startedAt={startedAt} /> : null}
  </div>
);

const RunActivityBody = ({
  thinking,
  content,
  commandGroups,
  continuity,
  active,
}: {
  thinking: string;
  content: string;
  commandGroups: StreamCommandGroup[];
  continuity: string | null;
  active: boolean;
}) => {
  const commands = useMemo(() => commandGroups.flatMap((group) => group.commands), [commandGroups]);
  return (
    <div className="mt-3 space-y-2 px-1">
      {continuity ? <p className="text-xs text-muted-foreground">{continuity}</p> : null}
      {thinking ? (
        <div data-testid="assistant-thinking" className="text-foreground/82">
          <ChatMarkdown content={thinking} />
        </div>
      ) : null}
      {content ? (
        <div data-testid="assistant-stream-content" className="t3-chat-message">
          {active ? (
            <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
              {content}
            </div>
          ) : (
            <ChatMarkdown content={content} />
          )}
        </div>
      ) : null}
      {commands.length > 0 ? <ToolRows commands={commands} active={active} /> : null}
    </div>
  );
};

const ToolRows = ({ commands, active }: { commands: StreamCommandRow[]; active: boolean }) => {
  const [showPrevious, setShowPrevious] = useState(false);
  const hiddenCount = Math.max(0, commands.length - 1);
  const visible = showPrevious ? commands : commands.slice(-1);
  return (
    <div className="-mx-1 space-y-px px-1 py-0.5">
      {visible.map((command) => (
        <ToolRow key={command.id} command={command} active={active} />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          aria-expanded={showPrevious}
          onClick={() => setShowPrevious((value) => !value)}
          className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-0.5 py-0.5 text-left text-[12px] leading-5 transition-colors duration-150 hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground/65">
            <ChevronDownIcon
              className={cn(
                "size-3.5 opacity-70 transition-transform duration-200",
                showPrevious && "rotate-180",
              )}
            />
          </span>
          <span className="font-medium text-foreground/82">
            {showPrevious
              ? "Show fewer tool calls"
              : `+${hiddenCount} previous tool ${hiddenCount === 1 ? "call" : "calls"}`}
          </span>
        </button>
      ) : null}
    </div>
  );
};

const ToolRow = memo(function ToolRow({
  command,
  active,
}: {
  command: StreamCommandRow;
  active: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = command.detail?.trim() ?? "";
  const canExpand = detail.length > 0;
  const Icon = iconForCommand(command.command);
  const failed = command.status === "failed";
  return (
    <div className="flex flex-col rounded-md px-0.5 py-0.5 transition-colors">
      <button
        type="button"
        disabled={!canExpand}
        aria-expanded={canExpand ? expanded : undefined}
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          "flex w-full select-none items-center gap-1.5 rounded-md text-left",
          canExpand
            ? "cursor-pointer hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
            : "cursor-default",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center",
            failed ? "text-destructive" : "text-muted-foreground/65",
          )}
        >
          <Icon className="size-3.5 stroke-[1.8] opacity-80" aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <p className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[12px] leading-5">
            <span
              className={cn(
                "min-w-0 shrink truncate font-medium",
                failed ? "text-destructive" : "text-foreground/82",
              )}
            >
              {command.command}
            </span>
            <ToolPreview detail={detail} />
          </p>
          <div className="flex shrink-0 items-center gap-px text-muted-foreground/55">
            <span className="flex size-4 items-center justify-center">
              <ToolDisclosure visible={canExpand} expanded={expanded} />
            </span>
            <ToolStatus status={command.status} active={active} />
          </div>
        </div>
      </button>
      <ToolExpandedDetail expanded={expanded} detail={detail} />
    </div>
  );
});

const ToolPreview = ({ detail }: { detail: string }) =>
  detail ? (
    <span className="min-w-0 flex-1 truncate text-muted-foreground/55">{detail}</span>
  ) : null;

const ToolDisclosure = ({ visible, expanded }: { visible: boolean; expanded: boolean }) =>
  visible ? (
    <ChevronDownIcon
      className={cn("size-3 opacity-70 transition-transform", expanded && "rotate-180")}
    />
  ) : null;

const ToolStatus = ({
  status,
  active,
}: {
  status: StreamCommandRow["status"];
  active: boolean;
}) => {
  const effectiveStatus = status === "running" && !active ? "done" : status;
  let indicator = <MinusIcon className="size-3 opacity-70" />;
  if (effectiveStatus === "failed") indicator = <XIcon className="size-3 text-destructive" />;
  if (effectiveStatus === "done") indicator = <CheckIcon className="size-3" />;
  if (effectiveStatus === "running" && active) {
    indicator = (
      <span className="size-1.5 rounded-full bg-muted-foreground/50 animate-status-pulse" />
    );
  }
  return (
    <span className="flex size-4 items-center justify-center" title={statusLabel(effectiveStatus)}>
      {indicator}
    </span>
  );
};

const ToolExpandedDetail = ({ expanded, detail }: { expanded: boolean; detail: string }) =>
  expanded && detail ? (
    <div className="mt-1 ms-7 cursor-default border-s border-border/45 ps-3 pt-0.5">
      <pre className="max-h-64 cursor-text overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground select-text">
        {detail}
      </pre>
    </div>
  ) : null;

const WorkingRow = ({ startedAt }: { startedAt: string | null }) => (
  <div className="py-0.5 pl-1.5">
    <div className="flex items-center gap-2 pt-1 text-[11px] text-muted-foreground/70 tabular-nums">
      <span className="inline-flex items-center gap-[3px]">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-1 rounded-full bg-muted-foreground/30 animate-status-pulse"
            style={{ animationDelay: `${index * 200}ms` }}
          />
        ))}
      </span>
      <span>
        {startedAt ? (
          <>
            Working for <WorkingTimer startedAt={startedAt} />
          </>
        ) : (
          "Working..."
        )}
      </span>
    </div>
  </div>
);

const WorkingTimer = ({ startedAt }: { startedAt: string }) => {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const update = () => {
      if (ref.current) ref.current.textContent = elapsedLabel(startedAt);
    };
    update();
    const timer = setInterval(update, 1_000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <span ref={ref}>{elapsedLabel(startedAt)}</span>;
};

const elapsedLabel = (startedAt: string): string => {
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
};

const COMMAND_ICON_RULES = [
  [["bash", "shell"], TerminalIcon],
  [["read", "view"], EyeIcon],
  [["write", "edit"], SquarePenIcon],
  [["web", "search"], GlobeIcon],
  [["agent", "task"], BotIcon],
  [["skill"], ZapIcon],
  [["build"], HammerIcon],
] as const;

const iconForCommand = (command: string) => {
  const normalized = command.toLowerCase();
  return (
    COMMAND_ICON_RULES.find(([terms]) => terms.some((term) => normalized.includes(term)))?.[1] ??
    WrenchIcon
  );
};

const statusLabel = (status: StreamCommandRow["status"]): string => {
  if (status === "failed") return "Failed";
  if (status === "done") return "Completed";
  return "Running";
};
