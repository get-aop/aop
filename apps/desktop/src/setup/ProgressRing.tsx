import type { ReactElement, ReactNode } from "react";

interface ProgressRingProps {
  /** Three segment colors (git, github, runtime); border-color when not yet ready. */
  segments: [string, string, string];
  /** Ring center: the ready count or a finished check. */
  center: ReactNode;
}

const RADIUS = 50;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const ARC = 92;
const GAP = CIRCUMFERENCE - ARC;

/** Three-segment progress ring. Each segment lights up (ok color) as its check passes. */
export const ProgressRing = ({ segments, center }: ProgressRingProps): ReactElement => (
  <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
    <svg
      width="120"
      height="120"
      viewBox="0 0 120 120"
      style={{ display: "block" }}
      aria-hidden="true"
    >
      <circle
        cx="60"
        cy="60"
        r={RADIUS}
        fill="none"
        stroke="var(--border)"
        strokeWidth="9"
        opacity="0.45"
      />
      <circle
        cx="60"
        cy="60"
        r={RADIUS}
        fill="none"
        stroke={segments[0]}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${ARC} ${GAP}`}
        transform="rotate(-83 60 60)"
      />
      <circle
        cx="60"
        cy="60"
        r={RADIUS}
        fill="none"
        stroke={segments[1]}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${ARC} ${GAP}`}
        transform="rotate(37 60 60)"
      />
      <circle
        cx="60"
        cy="60"
        r={RADIUS}
        fill="none"
        stroke={segments[2]}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${ARC} ${GAP}`}
        transform="rotate(157 60 60)"
      />
    </svg>
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        placeItems: "center",
        textAlign: "center",
      }}
    >
      {center}
    </div>
  </div>
);
