import type { ChatActionPayload } from "@aop/common";
import { memo, type ReactNode, useState } from "react";
import { Attachment } from "@/ui/attachment";
import { Bubble } from "@/ui/bubble";
import type { ChatSessionMessage, ChatSessionMessageDocument } from "../../api/client";
import { ChatImageGallery } from "./ChatImageGallery";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatMessageMeta } from "./ChatMessageMeta";
import type { StreamCommandGroup } from "./ChatStreamActivity";
import { CompletedRunActivity, LiveRunActivity } from "./ChatWorkLog";
import { ChatActionCards } from "./cards/ChatActionCards";
import { shouldCollapseUserMessage } from "./chat-timeline-model";
import { MarkdownFileChips } from "./MarkdownFileChips";
import {
  type HistoryActionBadge,
  type MessageSegment,
  parseMessageSegments,
  resolveUserMessageDisplay,
} from "./sessions-runtime";

export const UserTimelineRow = memo(function UserTimelineRow({
  message,
  midRunHint,
  workerNames,
  workerColors,
  repoPath,
  onOpenFile,
}: {
  message: ChatSessionMessage;
  midRunHint?: "queued" | "steered";
  workerNames: string[];
  workerColors: Record<string, string>;
  repoPath: string | null;
  onOpenFile: (path: string) => void;
}) {
  const { displayText, badges } = resolveUserMessageDisplay(message.content);
  return (
    <div
      className="group flex flex-col items-end gap-1 pb-4"
      data-message-id={message.id}
      data-message-role="user"
    >
      <UserMessageBubble
        message={message}
        displayText={displayText}
        badges={badges}
        midRunHint={midRunHint}
        workerNames={workerNames}
        workerColors={workerColors}
        repoPath={repoPath}
        onOpenFile={onOpenFile}
      />
      <div className="w-full max-w-[80%]">
        <ChatMessageMeta timestamp={message.createdAt} copyText={displayText} align="end" />
      </div>
    </div>
  );
});

const UserMessageBubble = ({
  message,
  displayText,
  badges,
  midRunHint,
  workerNames,
  workerColors,
  repoPath,
  onOpenFile,
}: {
  message: ChatSessionMessage;
  displayText: string;
  badges: HistoryActionBadge[];
  midRunHint?: "queued" | "steered";
  workerNames: string[];
  workerColors: Record<string, string>;
  repoPath: string | null;
  onOpenFile: (path: string) => void;
}) => (
  <Bubble className="relative">
    <MidRunHint kind={midRunHint} />
    <RetryLabel runId={message.retryOfRunId} />
    <ChatImageGallery images={message.images ?? []} />
    <DocumentChips documents={message.documents ?? []} />
    <CollapsibleUserMessage
      content={displayText}
      workerNames={workerNames}
      workerColors={workerColors}
    />
    {badges.map((badge) => (
      <HistoryActionBadgeView key={`${badge.kind}-${badge.label}`} badge={badge} />
    ))}
    <StructuredUserActionBadge action={message.action} />
    <MarkdownFileChips content={displayText} repoPath={repoPath} onOpenFile={onOpenFile} />
  </Bubble>
);
export const AssistantTimelineRow = memo(function AssistantTimelineRow({
  message,
  previousUserCreatedAt,
  sessionId,
  onAction,
  onNavigate,
  tasks,
  workers,
  repoPath,
  onOpenFile,
  canRetry,
  onRetryFresh,
  footer,
}: {
  message: ChatSessionMessage;
  previousUserCreatedAt: string | null;
  sessionId: string | null;
  onAction: (action: ChatActionPayload) => void;
  onNavigate: (path: string) => void;
  tasks: Array<{ id: string; status: string; assignedAgentId?: string | null }>;
  workers: Array<{ id: string; name: string }>;
  repoPath: string | null;
  onOpenFile: (path: string) => void;
  canRetry: boolean;
  onRetryFresh?: (runId: string) => void;
  footer?: ReactNode;
}) {
  const content = message.content || "(empty response)";
  return (
    <div
      className="group group/assistant pb-4"
      data-message-id={message.id}
      data-message-role="assistant"
    >
      <CompletedRunActivity message={message} previousUserCreatedAt={previousUserCreatedAt} />
      <div
        className="relative min-w-0 px-1 py-0.5 t3-chat-message"
        data-testid="assistant-message-content"
      >
        <ChatMarkdown content={content} />
        <MarkdownFileChips
          content={message.content}
          repoPath={repoPath}
          artifacts={message.artifacts ?? []}
          onOpenFile={onOpenFile}
        />
        {message.action ? (
          <ChatActionCards
            action={message.action}
            sessionId={sessionId}
            messageId={message.id}
            onNavigate={onNavigate}
            onLegacyAction={onAction}
            tasks={tasks}
            workers={workers}
          />
        ) : null}
        {canRetry && message.runId && onRetryFresh ? (
          <button
            type="button"
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs text-info-foreground hover:bg-accent/30"
            onClick={() => onRetryFresh(message.runId ?? "")}
          >
            Retry in a fresh runtime session
          </button>
        ) : null}
        {footer}
        <div className="mt-1.5">
          <ChatMessageMeta timestamp={message.createdAt} copyText={message.content} />
        </div>
      </div>
    </div>
  );
});

export const LiveAssistantTimelineRow = ({
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
  <div className="pb-4" data-message-id="streaming-assistant" data-message-role="assistant">
    <LiveRunActivity
      thinking={thinking}
      content={content}
      commandGroups={commandGroups}
      typing={typing}
      startedAt={startedAt}
    />
  </div>
);

const CollapsibleUserMessage = ({
  content,
  workerNames,
  workerColors,
}: {
  content: string;
  workerNames: string[];
  workerColors: Record<string, string>;
}) => {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;
  const collapsible = shouldCollapseUserMessage(content);
  const collapsed = collapsible && !expanded;
  return (
    <>
      <div
        className={collapsed ? "relative max-h-44 overflow-hidden" : "relative"}
        data-user-message-collapsed={collapsed ? "true" : "false"}
        style={
          collapsed
            ? {
                WebkitMaskImage:
                  "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
                maskImage: "linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)",
              }
            : undefined
        }
      >
        <UserMessageText content={content} workerNames={workerNames} workerColors={workerColors} />
      </div>
      {collapsible ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="-ml-1 mt-1.5 h-6 rounded-md px-1.5 text-xs text-muted-foreground/72 hover:bg-muted/55 hover:text-foreground/85"
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </>
  );
};

const RetryLabel = ({ runId }: { runId?: string | null }) =>
  runId ? (
    <p className="mb-2 font-mono text-[10px] text-muted-foreground">Retry of {runId}</p>
  ) : null;

const UserMessageText = ({
  content,
  workerNames,
  workerColors,
}: {
  content: string;
  workerNames: string[];
  workerColors: Record<string, string>;
}) => {
  const segments = parseMessageSegments(content, workerNames);
  const hasStructuredSegments = segments.some((segment) => segment.kind !== "text");
  if (!hasStructuredSegments) {
    return (
      <div className="t3-chat-message text-foreground">
        <ChatMarkdown content={content} lineBreaks />
      </div>
    );
  }
  return (
    <div className="chat-text-surface text-sm leading-relaxed text-foreground">
      {keyMessageSegments(segments).map(({ key, segment }) => (
        <MessageSegmentView key={key} segment={segment} workerColors={workerColors} />
      ))}
    </div>
  );
};

const MidRunHint = ({ kind }: { kind?: "queued" | "steered" }) =>
  kind ? (
    <p
      className="mb-2 font-mono text-[10px] font-medium tracking-[0.02em] text-muted-foreground"
      data-testid={`mid-run-hint-${kind}`}
    >
      {kind === "steered"
        ? "Steering — interrupting current reply"
        : "Queued — will run after current reply"}
    </p>
  ) : null;

const DocumentChips = ({ documents }: { documents: ChatSessionMessageDocument[] }) => {
  if (documents.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {documents.map((document) => (
        <Attachment
          key={document.id}
          name={document.fileName}
          state="done"
          href={document.url || undefined}
          className="font-mono"
        />
      ))}
    </div>
  );
};

const StructuredUserActionBadge = ({ action }: { action: ChatSessionMessage["action"] }) => {
  if (action?.type === "workflow-run") {
    return (
      <a
        data-testid="history-workflow-badge"
        className="history-action-badge"
        href={`/workflows/${encodeURIComponent(action.id ?? "")}`}
      >
        Workflow: #{action.sub}
      </a>
    );
  }
  if (action?.type !== "runtime-actions") return null;
  const actions = (action.proposal as import("@aop/common").RuntimeActionsFields | undefined)
    ?.actions;
  return (
    <div data-testid="history-runtime-actions" className="flex flex-col gap-1">
      {(actions ?? []).map((runtimeAction) => (
        <span key={runtimeAction.id} className="history-action-badge">
          {runtimeAction.runtimeConfigurationName ?? runtimeAction.provider} will{" "}
          {runtimeAction.intent} using {runtimeAction.model} · {runtimeAction.reasoning}
          {runtimeAction.fastMode ? " · fast" : ""}
        </span>
      ))}
    </div>
  );
};

const HistoryActionBadgeView = ({ badge }: { badge: HistoryActionBadge }) => (
  <span
    data-testid={badge.kind === "delegation" ? "history-delegation-badge" : "history-control-badge"}
    className="history-action-badge"
  >
    {badge.label}
  </span>
);

const keyMessageSegments = (
  segments: MessageSegment[],
): Array<{ key: string; segment: MessageSegment }> => {
  const occurrences = new Map<string, number>();
  return segments.map((segment) => {
    const base = `${segment.kind}:${segment.text}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { key: `${base}:${occurrence}`, segment };
  });
};

const MessageSegmentView = ({
  segment,
  workerColors,
}: {
  segment: MessageSegment;
  workerColors: Record<string, string>;
}) => {
  if (segment.kind === "command") {
    return (
      <span className="rounded-md bg-info/15 px-1.5 py-0.5 font-mono text-xs font-semibold text-info-foreground">
        {segment.text}
      </span>
    );
  }
  if (segment.kind === "mention") {
    const name = segment.text.slice(1).toLowerCase();
    const color = workerColors[name] ?? "var(--color-queued)";
    return (
      <span
        className="rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold"
        style={{ background: `color-mix(in srgb,${color} 15%,transparent)`, color }}
      >
        {segment.text}
      </span>
    );
  }
  return <span>{segment.text}</span>;
};
