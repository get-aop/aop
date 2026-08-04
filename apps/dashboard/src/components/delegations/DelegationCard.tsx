import { deriveDelegationViewStatus, formatChatDelegationKind } from "@aop/common";
import { XIcon } from "lucide-react";
import { getModelLabel, getRuntimeUi } from "../../views/sessions/sessions-runtime";
import type { DelegationCardState } from "./delegation-center";
import { delegationStatusMeta, formatDelegationElapsed } from "./delegation-format";

export interface DelegationCardProps {
  state: DelegationCardState;
  now: number;
  onOpen: (delegationId: string) => void;
  onDismiss: (delegationId: string) => void;
}

/**
 * Compact live card for one delegated specialist run. The card is a single
 * keyboard-focusable target; the X only hides the card and never cancels work.
 */
export const DelegationCard = ({ state, now, onOpen, onDismiss }: DelegationCardProps) => {
  const { delegation } = state;
  const runtimeUi = getRuntimeUi(delegation.runtime);
  const viewStatus = deriveDelegationViewStatus(delegation, now);
  const meta = delegationStatusMeta(viewStatus);
  const elapsed = formatDelegationElapsed(
    delegation.startedAt,
    delegation.status === "active" ? now : Date.parse(delegation.updatedAt),
  );
  const activity = delegation.activity ?? fallbackActivity(viewStatus);
  const open = () => onOpen(delegation.id);

  return (
    <div style={{ position: "relative", width: 240 }}>
      <button
        type="button"
        data-testid={`delegation-card-${delegation.id}`}
        onClick={open}
        aria-label={`Open ${delegation.label} ${formatChatDelegationKind(delegation.kind)}, ${meta.label}`}
        className="aop-h"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          width: "100%",
          padding: "10px 12px",
          background: "var(--color-surface)",
          border: `1px solid var(--color-border)`,
          borderRadius: "var(--radius-card)",
          boxShadow: "var(--shadow-2)-2)-2)",
          cursor: "pointer",
          textAlign: "left",
          font: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 7,
              background: `color-mix(in srgb, ${runtimeUi.color} 18%, transparent)`,
              color: runtimeUi.color,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {runtimeUi.glyph}
          </span>
          <span
            style={{
              fontFamily: "var(--font-sans)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--color-text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {delegation.label}
          </span>
          <span
            role="status"
            aria-live="polite"
            style={{
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
            }}
          >
            {meta.pulse ? <PulseDot /> : null}
            {meta.label}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-subtle)",
              fontVariantNumeric: "tabular-nums",
              flexShrink: 0,
              marginRight: 18,
            }}
          >
            {elapsed}
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--color-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {formatChatDelegationKind(delegation.kind)} · {runtimeUi.label} ·{" "}
          {getModelLabel(delegation.model)}
        </div>
        <div
          data-testid={`delegation-activity-${delegation.id}`}
          style={{
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--color-text-subtle)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {activity}
        </div>
      </button>
      <button
        type="button"
        aria-label={`Dismiss ${delegation.label} card`}
        onClick={(event) => {
          event.stopPropagation();
          onDismiss(delegation.id);
        }}
        className="aop-h"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 22,
          height: 22,
          border: "none",
          background: "transparent",
          color: "var(--color-text-subtle)",
          cursor: "pointer",
          borderRadius: 6,
        }}
      >
        <XIcon className="size-3" strokeWidth={1.7} />
      </button>
    </div>
  );
};

const fallbackActivity = (viewStatus: string): string => {
  if (viewStatus === "starting") return "Starting…";
  if (viewStatus === "waiting") return "Waiting for output…";
  if (viewStatus === "completed") return "Finished";
  if (viewStatus === "failed") return "Failed";
  if (viewStatus === "cancelled") return "Cancelled";
  return "Working…";
};

/** Animated working dot; disabled under reduced motion via data-ambient-motion. */
const PulseDot = () => (
  <span
    aria-hidden="true"
    data-testid="delegation-pulse"
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
