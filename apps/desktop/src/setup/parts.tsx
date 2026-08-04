import type { CSSProperties, ReactElement } from "react";
import { SpinnerIcon } from "./icons";
import type { StatusChip } from "./setup-ui";
import { lineColor } from "./setup-ui";

export interface TerminalLine {
  text: string;
}

/** Coloured status chip with a spinner while in flight, otherwise a dot. */
export const Chip = ({ chip }: { chip: StatusChip }): ReactElement => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      font: "600 11px 'Geist Mono'",
      borderRadius: 7,
      padding: "3px 9px",
      whiteSpace: "nowrap",
      background: chip.bg,
      color: chip.fg,
    }}
  >
    {chip.spinning ? (
      <SpinnerIcon size={11} />
    ) : (
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: chip.fg }} />
    )}
    {chip.label}
  </span>
);

const barStyle: CSSProperties = {
  height: 5,
  borderRadius: 3,
  background: "var(--raised)",
  overflow: "hidden",
};

const fillStyle: CSSProperties = {
  height: "100%",
  background: "linear-gradient(90deg,var(--work),var(--teal))",
  borderRadius: 3,
};

const terminalStyle: CSSProperties = {
  marginTop: 12,
  background: "#0b0e16",
  border: "1px solid #1c2233",
  borderRadius: 11,
  padding: "13px 15px",
  font: "500 12px 'Geist Mono'",
  lineHeight: 1.9,
  maxHeight: 172,
  overflowY: "auto",
};

/**
 * Install progress block: an indeterminate fill bar plus a terminal showing the real
 * command being run. The backend runs setup actions synchronously, so we cannot stream
 * real installer output — the bar animates while the call is in flight and resolves when
 * it returns, keeping the card honest about what is running.
 */
export const InstallStream = ({ lines }: { lines: TerminalLine[] }): ReactElement => (
  <div style={{ marginTop: 16, animation: "aop-in .2s ease" }}>
    <div style={barStyle}>
      <div className="aop-fill" style={fillStyle} />
    </div>
    <div className="aop-scroll" style={terminalStyle}>
      {lines.map((line) => (
        <div
          key={line.text}
          className="aop-line"
          style={{ whiteSpace: "pre-wrap", color: lineColor(line.text) }}
        >
          {line.text}
        </div>
      ))}
      <span
        className="aop-blink"
        style={{
          display: "inline-block",
          width: 8,
          height: 14,
          background: "#3a4156",
          verticalAlign: "-2px",
        }}
      />
    </div>
  </div>
);
