import { CheckIcon, CopyIcon, WorkflowIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
import { openArtifactView } from "../artifact-view/open-artifact-view";
import { startVisualize } from "../artifact-view/visualize/visualize-store";
import { formatAgo } from "../selectors";
import { useSharedNow } from "../use-now";
import { formatTimestampTooltip } from "./chat-time";

/**
 * How long ago a message was sent ("2m ago", the exact time in its tooltip) and a copy button,
 * shown while the pointer or focus is on the message (its row has `group`).
 */
export const MessageMeta = ({
  timestamp,
  copyText,
  align = "start",
  visualize,
}: {
  timestamp: string;
  copyText?: string | null;
  align?: "start" | "end";
  /** An agent's reply: a button that draws a diagram of it in the artifact view. */
  visualize?: { projectId: string; messageId: string };
}) => (
  <div
    data-testid="message-meta"
    className={cn(
      "chat-message-meta flex w-full items-center gap-2 text-meta tabular-nums opacity-60 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100",
      align === "end" ? "justify-end pe-1" : "justify-start",
    )}
  >
    {align === "start" && copyText ? <CopyMessageButton text={copyText} /> : null}
    {visualize ? <VisualizeButton {...visualize} /> : null}
    <MessageTime timestamp={timestamp} />
    {align === "end" && copyText ? <CopyMessageButton text={copyText} /> : null}
  </div>
);

/**
 * "Visualize": a diagram of this reply, made by a small separate model run and shown in the
 * artifact view; a reply drawn before opens its diagram without a new run.
 */
const VisualizeButton = ({ projectId, messageId }: { projectId: string; messageId: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        size="icon-xs"
        variant="ghost"
        aria-label="Visualize as a diagram"
        data-testid="message-visualize"
        onClick={() => {
          startVisualize(projectId, messageId);
          openArtifactView(projectId, { kind: "visualize", messageId });
        }}
      >
        <WorkflowIcon className="size-3" />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Visualize as a diagram</TooltipContent>
  </Tooltip>
);

// Its own component so the clock's tick redraws only the time, not the memoised message row.
const MessageTime = ({ timestamp }: { timestamp: string }) => {
  const now = useSharedNow();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={timestamp}
          data-testid="message-time"
          className="text-meta tabular-nums text-text-subtle"
        >
          {formatAgo(timestamp, now)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatTimestampTooltip(timestamp)}</TooltipContent>
    </Tooltip>
  );
};

const CopyMessageButton = ({ text }: { text: string }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1_000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          aria-label="Copy message"
          data-testid="message-copy"
          disabled={copied}
          onClick={() => void copy()}
        >
          {copied ? <CheckIcon className="size-3 text-ok" /> : <CopyIcon className="size-3" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
    </Tooltip>
  );
};
