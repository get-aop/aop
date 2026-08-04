import type { ReactElement, ReactNode } from "react";
import { CheckIcon } from "./icons";
import { Chip, InstallStream, type TerminalLine } from "./parts";
import { borderFor, chipFor, type UiStatus } from "./setup-ui";

export interface RequirementAction {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}

interface RequirementCardProps {
  label: string;
  icon: ReactNode;
  iconTint: string;
  status: UiStatus;
  message: string;
  action: RequirementAction | null;
  installing: boolean;
  installLines: TerminalLine[];
}

export const RequirementCard = ({
  label,
  icon,
  iconTint,
  status,
  message,
  action,
  installing,
  installLines,
}: RequirementCardProps): ReactElement => {
  const showAction = action !== null && !installing;
  const isReady = status === "ready";

  return (
    <div
      className="aop-card"
      style={{
        background: "var(--surface)",
        border: `1px solid ${borderFor(status)}`,
        borderRadius: 18,
        padding: "18px 22px",
        boxShadow: "var(--card1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 15 }}>
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: 13,
            flexShrink: 0,
            display: "grid",
            placeItems: "center",
            background: `color-mix(in srgb,${iconTint} 14%,transparent)`,
            color: iconTint,
          }}
        >
          {icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
            <span style={{ font: "600 17px 'Jura',sans-serif" }}>{label}</span>
            <Chip chip={chipFor(status)} />
          </div>
          <div
            style={{ fontSize: "13.5px", color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}
          >
            {message}
          </div>
        </div>
        {showAction && action ? (
          <button
            type="button"
            onClick={action.onClick}
            className="aop-h"
            style={{
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              whiteSpace: "nowrap",
              background: "var(--surface)",
              border: "1px solid var(--border2)",
              color: "var(--text)",
              borderRadius: 11,
              padding: "10px 15px",
              font: "600 13px 'Instrument Sans'",
              cursor: "pointer",
            }}
          >
            {action.icon}
            {action.label}
          </button>
        ) : null}
        {isReady ? (
          <span
            className="aop-pop"
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 10,
              display: "grid",
              placeItems: "center",
              background: "var(--okFill)",
              color: "var(--ok)",
            }}
          >
            <CheckIcon size={17} />
          </span>
        ) : null}
      </div>
      {installing ? <InstallStream lines={installLines} /> : null}
    </div>
  );
};
