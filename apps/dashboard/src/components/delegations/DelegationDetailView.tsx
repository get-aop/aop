import type { ChatDelegationRunDto } from "@aop/common";
import { deriveDelegationViewStatus, formatChatDelegationKind } from "@aop/common";
import { ChevronLeftIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useState } from "react";
import {
  abortChatSession,
  type ChatDelegationOutput,
  getChatDelegationOutput,
} from "../../api/client";
import { ChatStreamActivity } from "../../views/sessions/ChatStreamActivity";
import { getModelLabel, getRuntimeUi } from "../../views/sessions/sessions-runtime";
import type { DelegationCardState } from "./delegation-center";
import { useAllDelegationCards } from "./delegation-center";
import {
  type DelegationStatusMeta,
  delegationStatusMeta,
  formatDelegationElapsed,
} from "./delegation-format";

export interface DelegationDetailViewProps {
  delegationId: string;
  onClose: () => void;
}

/**
 * Expanded live view of one delegated specialist. Non-modal: the host
 * conversation stays usable and Escape/Back never interrupts the runtime.
 */
export const DelegationDetailView = ({ delegationId, onClose }: DelegationDetailViewProps) => {
  // Explicitly opened details render regardless of session focus; the stack
  // decides visibility, the detail only needs the run state.
  const cards = useAllDelegationCards();
  const card = cards.find((item) => item.delegation.id === delegationId) ?? null;
  const now = useNow(1000);
  const terminalOutput = useTerminalOutput(card);

  if (!card) return null;
  const { delegation } = card;
  const meta = delegationStatusMeta(deriveDelegationViewStatus(delegation, now));
  const elapsed = formatDelegationElapsed(
    delegation.startedAt,
    delegation.status === "active" ? now : Date.parse(delegation.updatedAt),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`${formatChatDelegationKind(delegation.kind)}: ${delegation.label}`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={panelStyle}
    >
      <DetailHeader delegation={delegation} meta={meta} elapsed={elapsed} onClose={onClose} />
      <DetailMeta delegation={delegation} />
      <DetailOutput delegation={delegation} output={card.live ?? terminalOutput} />
      <DetailFooter delegation={delegation} onClose={onClose} />
    </div>
  );
};

/** Load persisted output for terminal runs that have no live buffer. */
const useTerminalOutput = (card: DelegationCardState | null): ChatDelegationOutput | null => {
  const [output, setOutput] = useState<ChatDelegationOutput | null>(null);
  const delegation = card?.delegation ?? null;
  const terminal = delegation !== null && delegation.status !== "active";

  useEffect(() => {
    setOutput(null);
    if (!delegation || !terminal || card?.live) return;
    let stale = false;
    void getChatDelegationOutput(delegation.sessionId, delegation.id)
      .then((result) => {
        if (!stale) setOutput(result.output);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [delegation, terminal, card?.live]);

  return output;
};

const DetailHeader = ({
  delegation,
  meta,
  elapsed,
  onClose,
}: {
  delegation: ChatDelegationRunDto;
  meta: DelegationStatusMeta;
  elapsed: string;
  onClose: () => void;
}) => {
  const runtimeUi = getRuntimeUi(delegation.runtime);
  return (
    <div style={headerStyle}>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close delegated session detail"
        className="aop-h"
        style={iconButtonStyle}
      >
        <ChevronLeftIcon className="size-3.5" strokeWidth={1.7} />
      </button>
      <span aria-hidden="true" style={glyphStyle(runtimeUi.color)}>
        {runtimeUi.glyph}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={titleStyle}>{delegation.label}</div>
        <div style={subtitleStyle}>
          {runtimeUi.label} · {getModelLabel(delegation.model)} · {delegation.reasoning}
          {delegation.fastMode ? " · fast" : ""}
        </div>
      </div>
      <span role="status" aria-live="polite" style={statusChipStyle(meta)}>
        {meta.pulse ? <PulseDot /> : null}
        {meta.label}
      </span>
      <span style={elapsedStyle}>{elapsed}</span>
    </div>
  );
};

const DetailMeta = ({ delegation }: { delegation: ChatDelegationRunDto }) => (
  <div style={metaSectionStyle}>
    <MetaRow label="Type" value={formatChatDelegationKind(delegation.kind)} />
    {delegation.kind === "background-task" ? (
      <MetaRow label="Source" value="Model-spawned background task" />
    ) : (
      <MetaRow label="Specialist session" value={delegation.runtimeSessionId ?? "pending…"} mono />
    )}
    {delegation.activity ? <MetaRow label="Activity" value={delegation.activity} /> : null}
  </div>
);

const DetailOutput = ({
  delegation,
  output,
}: {
  delegation: ChatDelegationRunDto;
  output: ChatDelegationOutput | null;
}) => (
  <div style={outputSectionStyle}>
    {delegation.status === "failed" && delegation.error ? (
      <div role="alert" style={errorBoxStyle}>
        {delegation.error}
      </div>
    ) : null}
    {output ? (
      <ChatStreamActivity
        thinking={output.thinking}
        content={output.content}
        commandGroups={output.commandGroups}
        typing={delegation.status === "active"}
      />
    ) : (
      <div style={emptyOutputStyle}>
        {delegation.status === "active"
          ? delegation.kind === "background-task"
            ? "Waiting for background task output…"
            : "Waiting for specialist output…"
          : "No output recorded."}
      </div>
    )}
  </div>
);

const DetailFooter = ({
  delegation,
  onClose,
}: {
  delegation: ChatDelegationRunDto;
  onClose: () => void;
}) => (
  <div style={footerStyle}>
    <button type="button" onClick={onClose} className="aop-h" style={footerButtonStyle}>
      Back to conversation
    </button>
    <FooterActiveAction delegation={delegation} />
  </div>
);

/** Specialist cancel vs background-task host-turn note. */
const FooterActiveAction = ({ delegation }: { delegation: ChatDelegationRunDto }) => {
  if (delegation.status !== "active") return null;
  if (delegation.kind === "background-task") {
    return (
      <span
        style={{
          fontFamily: "var(--font-sans)",
          fontSize: 12,
          color: "var(--color-text-subtle)",
          maxWidth: 220,
          textAlign: "right",
        }}
      >
        Ends with the host turn. Stop the host chat to interrupt.
      </span>
    );
  }
  return <CancelSpecialistButton sessionId={delegation.sessionId} />;
};

const CancelSpecialistButton = ({ sessionId }: { sessionId: string }) => {
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const cancel = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setCancelling(true);
    try {
      await abortChatSession(sessionId);
    } finally {
      setCancelling(false);
      setConfirming(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void cancel()}
      disabled={cancelling}
      aria-label={confirming ? "Confirm cancel delegated run" : "Cancel delegated run"}
      className="aop-h"
      style={{
        ...footerButtonStyle,
        color: "var(--color-blocked)",
        border: "1px solid var(rgb(240 87 79 / 32%))",
        background: confirming ? "var(rgb(240 87 79 / 12%))" : "transparent",
      }}
    >
      {cancelling ? "Cancelling…" : confirming ? "Confirm cancel" : "Cancel delegated run"}
    </button>
  );
};

const MetaRow = ({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) => (
  <div style={{ display: "flex", gap: 8, fontFamily: "var(--font-sans)", fontSize: 12 }}>
    <span style={{ color: "var(--color-text-subtle)", minWidth: 110 }}>{label}</span>
    <span
      style={{
        color: "var(--color-text-muted)",
        fontFamily: mono ? "var(--font-mono)" : "var(--font-sans)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  </div>
);

const PulseDot = () => (
  <span
    aria-hidden="true"
    data-ambient-motion
    style={{
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: "currentColor",
      animation: "aop-pulse 1s ease-in-out infinite",
    }}
  />
);

const useNow = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
};

const panelStyle = {
  position: "fixed",
  top: 64,
  right: 16,
  bottom: 24,
  zIndex: "var(--z-overlay)",
  width: "min(460px, calc(100vw - 32px))",
  display: "flex",
  flexDirection: "column",
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-card)",
  boxShadow: "var(--shadow-2)-2)-3)",
  overflow: "hidden",
} as const;

const headerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "12px 14px",
  borderBottom: "1px solid var(--color-border)",
} as const;

const iconButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  border: "none",
  background: "transparent",
  color: "var(--color-text-subtle)",
  cursor: "pointer",
  borderRadius: 8,
} as const;

const titleStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 13.5,
  fontWeight: 650,
  color: "var(--color-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const subtitleStyle = {
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  color: "var(--color-text-muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const elapsedStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: 11.5,
  color: "var(--color-text-subtle)",
  fontVariantNumeric: "tabular-nums",
} as const;

const metaSectionStyle = {
  padding: "8px 14px",
  borderBottom: "1px solid var(--color-border)",
  display: "flex",
  flexDirection: "column",
  gap: 2,
} as const;

const outputSectionStyle = { flex: 1, overflowY: "auto", padding: "12px 14px" } as const;

const errorBoxStyle = {
  marginBottom: 12,
  padding: "8px 10px",
  borderRadius: "var(--radius-control)",
  background: "var(rgb(240 87 79 / 12%))",
  border: "1px solid var(rgb(240 87 79 / 32%))",
  color: "var(--color-blocked)",
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
} as const;

const emptyOutputStyle = {
  color: "var(--color-text-subtle)",
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
} as const;

const footerStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "10px 14px",
  borderTop: "1px solid var(--color-border)",
} as const;

const footerButtonStyle = {
  padding: "6px 12px",
  borderRadius: "var(--radius-control)",
  border: "1px solid var(--color-border)",
  background: "transparent",
  color: "var(--color-text)",
  fontFamily: "var(--font-sans)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
} as const;

const glyphStyle = (color: string) =>
  ({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: 8,
    background: `color-mix(in srgb, ${color} 18%, transparent)`,
    color,
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  }) as const;

const statusChipStyle = (meta: DelegationStatusMeta) =>
  ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: "var(--radius-pill)",
    background: meta.fill,
    border: `1px solid ${meta.border}`,
    color: meta.color,
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    fontWeight: 600,
    flexShrink: 0,
  }) as const;
