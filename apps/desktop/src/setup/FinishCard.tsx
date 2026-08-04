import type { ReactElement } from "react";
import { ArrowIcon, CheckIcon, FlagIcon } from "./icons";

interface FinishCardProps {
  done: boolean;
  finishTitle: string;
  finishNote: string;
  onQuit: () => void;
  onOpenDashboard: () => void;
}

export const FinishCard = ({
  done,
  finishTitle,
  finishNote,
  onQuit,
  onOpenDashboard,
}: FinishCardProps): ReactElement => {
  const finishBg = done ? "color-mix(in srgb,var(--ok) 6%,var(--surface))" : "var(--surface)";
  const finishBd = done ? "color-mix(in srgb,var(--ok) 35%,var(--border))" : "var(--border)";
  const iconBg = done ? "var(--okFill)" : "var(--raised)";
  const iconFg = done ? "var(--ok)" : "var(--subtle)";

  return (
    <div
      className="aop-card"
      style={{
        marginTop: 18,
        background: finishBg,
        border: `1px solid ${finishBd}`,
        borderRadius: 18,
        padding: "20px 24px",
        display: "flex",
        alignItems: "center",
        gap: 17,
        boxShadow: "var(--card1)",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          width: 50,
          height: 50,
          borderRadius: 14,
          flexShrink: 0,
          display: "grid",
          placeItems: "center",
          background: iconBg,
          color: iconFg,
        }}
      >
        {done ? <CheckIcon size={24} /> : <FlagIcon />}
      </span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ font: "600 18px 'Jura',sans-serif" }}>{finishTitle}</div>
        <div style={{ fontSize: "13.5px", color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>
          {finishNote}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onQuit}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--subtle)",
            font: "600 13px 'Instrument Sans'",
            cursor: "pointer",
            padding: "11px 12px",
          }}
        >
          Quit setup
        </button>
        <button
          type="button"
          onClick={onOpenDashboard}
          disabled={!done}
          className="aop-h"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 9,
            background: done ? "var(--action)" : "var(--raised)",
            color: done ? "var(--onAction)" : "var(--subtle)",
            border: "none",
            borderRadius: 12,
            padding: "13px 20px",
            font: "600 14px 'Instrument Sans'",
            cursor: done ? "pointer" : "not-allowed",
            opacity: done ? 1 : 0.55,
            boxShadow: done
              ? "0 10px 28px -10px color-mix(in srgb,var(--action) 60%,transparent)"
              : "none",
          }}
        >
          <ArrowIcon />
          Open dashboard
        </button>
      </div>
    </div>
  );
};
