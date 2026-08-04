import { CheckIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { ChatMarkdown } from "./ChatMarkdown";

export interface StreamCommandRow {
  id: string;
  command: string;
  detail?: string;
  status: "running" | "done" | "failed";
  exitCode?: number | null;
}

export interface StreamCommandGroup {
  id: string;
  commands: StreamCommandRow[];
}

export interface ChatStreamActivityProps {
  thinking: string;
  content: string;
  commandGroups: StreamCommandGroup[];
  typing: boolean;
}

/**
 * Provider-neutral live activity: compact tool summaries, muted reasoning,
 * and details on demand without letting long runs take over the conversation.
 */
export const ChatStreamActivity = ({
  thinking,
  content,
  commandGroups,
  typing,
}: ChatStreamActivityProps) => {
  const hasBody = Boolean(thinking || content || commandGroups.length > 0);
  // Show the Thinking header while the run is live, even before the first thought token.
  const showThinking = Boolean(thinking) || (typing && !content && commandGroups.length === 0);
  // Blink only during the thinking phase — stop once answer prose starts streaming.
  const thinkingActive = typing && !content;
  if (!hasBody && typing) {
    return (
      <div
        data-testid="chat-stream-activity"
        style={{ display: "flex", flexDirection: "column", gap: 12 }}
      >
        <ThinkingHeader active open={false} onToggle={() => {}} showChevron={false} />
      </div>
    );
  }

  return (
    <div
      data-testid="chat-stream-activity"
      style={{ display: "flex", flexDirection: "column", gap: 12 }}
    >
      {showThinking ? <ReasoningBlock text={thinking} active={thinkingActive} /> : null}
      {commandGroups.map((group) => (
        <CommandGroup key={group.id} group={group} active={typing} />
      ))}
      {content ? (
        <div data-testid="assistant-stream-content">
          {typing ? (
            <div
              style={{
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                fontFamily: "var(--font-sans)",
                fontSize: 15,
                lineHeight: 1.65,
              }}
            >
              {content}
            </div>
          ) : (
            <ChatMarkdown content={content} />
          )}
        </div>
      ) : null}
    </div>
  );
};

const ReasoningBlock = ({ text, active }: { text: string; active: boolean }) => {
  const [open, setOpen] = useState(false);
  const hasText = Boolean(text);
  return (
    <div data-testid="assistant-thinking">
      <ThinkingHeader
        active={active}
        open={open}
        onToggle={() => setOpen((value) => !value)}
        showChevron={hasText}
      />
      {open && hasText ? (
        <div
          style={{
            marginTop: 6,
            color: "var(--color-text-muted)",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 400,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </div>
      ) : null}
    </div>
  );
};

const ThinkingHeader = ({
  active,
  open,
  onToggle,
  showChevron,
}: {
  active: boolean;
  open: boolean;
  onToggle: () => void;
  showChevron: boolean;
}) => (
  <button
    type="button"
    onClick={showChevron ? onToggle : undefined}
    className="aop-h"
    data-testid="assistant-thinking-label"
    data-active={active ? "true" : "false"}
    aria-live="polite"
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      border: "none",
      background: "transparent",
      color: "var(--color-text-subtle)",
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      fontWeight: 500,
      minHeight: 28,
      marginTop: 2,
      padding: 0,
      cursor: showChevron ? "pointer" : "default",
    }}
  >
    {showChevron ? <Chevron open={open} /> : null}
    {active ? <ThinkingPulseDot /> : null}
    <span
      style={{
        animation: active ? "aop-blink 1.1s ease-in-out infinite" : undefined,
      }}
    >
      Thinking
    </span>
    {active ? <ThinkingEllipsis /> : null}
  </button>
);

const ThinkingPulseDot = () => (
  <span
    aria-hidden="true"
    data-testid="thinking-pulse"
    style={{
      width: 7,
      height: 7,
      borderRadius: "50%",
      background: "var(--color-running)",
      flexShrink: 0,
      animation: "aop-pulse 1s ease-in-out infinite",
    }}
  />
);

const ThinkingEllipsis = () => (
  <span
    aria-hidden="true"
    style={{
      display: "inline-flex",
      gap: 3,
      marginLeft: 1,
    }}
  >
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        style={{
          width: 3,
          height: 3,
          borderRadius: "50%",
          background: "var(--color-text-subtle)",
          animation: "aop-pulse 1s ease-in-out infinite",
          animationDelay: `${i * 0.18}s`,
        }}
      />
    ))}
  </span>
);

const CommandGroup = ({ group, active }: { group: StreamCommandGroup; active: boolean }) => {
  const n = group.commands.length;
  const running = active && group.commands.some((row) => row.status === "running");
  const [open, setOpen] = useState(false);
  const generatedId = useId();
  const label = running
    ? n === 1
      ? "Running 1 action"
      : `Running ${n} actions`
    : n === 1
      ? "Ran 1 action"
      : `Ran ${n} actions`;
  const summary = summarizeActivity(group.commands);
  const detailId = `activity-${generatedId.replaceAll(":", "")}`;
  const lastRunningId = [...group.commands].reverse().find((row) => row.status === "running")?.id;

  return (
    <div data-testid="stream-command-group">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="aop-h"
        aria-expanded={open}
        aria-controls={detailId}
        style={{
          display: "inline-flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 6,
          border: "none",
          background: "transparent",
          color: "var(--color-text-subtle)",
          fontFamily: "var(--font-sans)",
          fontSize: 12.5,
          fontWeight: 500,
          padding: 0,
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Chevron open={open} />
        <span style={{ opacity: 0.85 }} aria-hidden="true">
          ›_
        </span>
        <span>{label}</span>
        {summary ? (
          <span
            data-testid="stream-command-summary"
            style={{ color: "var(--color-text-muted)", fontSize: 11.5, fontWeight: 400 }}
          >
            · {summary}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          id={detailId}
          data-testid="stream-command-list"
          style={{
            marginTop: 8,
            maxHeight: 288,
            overflowY: "auto",
            scrollbarGutter: "stable",
            display: "flex",
            flexDirection: "column",
            gap: 7,
            padding: "9px 10px",
            borderLeft:
              "1px solid color-mix(in srgb, var(--color-running) 38%, var(--color-border))",
            background: "color-mix(in srgb, var(--panel) 62%, transparent)",
            borderRadius: "0 8px 8px 0",
          }}
        >
          {group.commands.map((row) => (
            <div
              key={row.id}
              data-testid="stream-command-row"
              style={{
                display: "grid",
                gridTemplateColumns: "14px minmax(52px, max-content) minmax(0, 1fr)",
                alignItems: "start",
                columnGap: 8,
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 500,
                color: "var(--color-text-muted)",
                lineHeight: 1.45,
              }}
            >
              <StatusMark
                status={row.status}
                active={active && row.status === "running" && row.id === lastRunningId}
              />
              <code
                style={{
                  fontFamily: "inherit",
                  color: "var(--color-text)",
                  background: "color-mix(in srgb, var(--color-text-subtle) 10%, transparent)",
                  borderRadius: 6,
                  padding: "2px 7px",
                  wordBreak: "break-word",
                }}
              >
                {row.command}
              </code>
              {row.detail ? (
                <pre
                  data-testid="stream-command-detail"
                  title={row.detail}
                  style={{
                    minWidth: 0,
                    margin: "2px 0 0",
                    maxHeight: 64,
                    overflow: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    font: "inherit",
                    fontWeight: 400,
                    color: "var(--color-text-muted)",
                  }}
                >
                  {row.detail}
                </pre>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const summarizeActivity = (commands: StreamCommandRow[]): string | null => {
  const counts = new Map<string, number>();
  for (const row of commands) counts.set(row.command, (counts.get(row.command) ?? 0) + 1);
  const repeated = [...counts.entries()].filter(([, count]) => count > 1);
  if (repeated.length === 0) return null;
  repeated.sort((a, b) => b[1] - a[1]);
  const visible = repeated.slice(0, 3).map(([command, count]) => `${command} ${count}`);
  const hiddenTypes = counts.size - visible.length;
  if (hiddenTypes > 0) visible.push(`+${hiddenTypes} more`);
  return visible.join(" · ");
};

const StatusMark = ({
  status,
  active,
}: {
  status: StreamCommandRow["status"];
  active: boolean;
}) => {
  if (status === "running") {
    return (
      <span
        data-testid="stream-command-status"
        data-active={active ? "true" : "false"}
        style={{
          width: 7,
          height: 7,
          marginTop: 5,
          borderRadius: "50%",
          background: active ? "var(--color-running)" : "var(--color-text-subtle)",
          flexShrink: 0,
          animation: active ? "aop-pulse 1s ease-in-out infinite" : undefined,
        }}
      />
    );
  }
  if (status === "failed") {
    return (
      <span
        data-testid="stream-command-status"
        data-active="false"
        style={{ color: "var(--color-blocked)", flexShrink: 0 }}
      >
        <XIcon className="size-3.5 shrink-0 text-blocked" strokeWidth={1.7} />
      </span>
    );
  }
  return (
    <span
      data-testid="stream-command-status"
      data-active="false"
      style={{ color: "var(--color-ok)", flexShrink: 0 }}
    >
      <CheckIcon className="size-3.5 shrink-0 text-ok" strokeWidth={1.7} />
    </span>
  );
};

const Chevron = ({ open }: { open: boolean }) => (
  <span
    aria-hidden="true"
    style={{
      display: "inline-block",
      transform: open ? "rotate(90deg)" : "rotate(0deg)",
      transition: "transform .12s ease",
      fontSize: 11,
      width: 10,
    }}
  >
    <ChevronRightIcon className="size-3 shrink-0" strokeWidth={1.7} />
  </span>
);
