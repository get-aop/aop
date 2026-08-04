// Derived from T3 Code (https://github.com/pingdotgg/t3code), MIT, Copyright (c) 2026 T3 Tools Inc.
export const ChipCaret = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    aria-hidden="true"
    style={{ opacity: 0.55 }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const EffortGauge = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    aria-hidden="true"
    style={{ opacity: 0.7 }}
  >
    <path d="M3.8 15.5a9 9 0 1116.4 0M12 15l3.5-3.5" />
  </svg>
);

export const MoreDotsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="10" r="1.5" />
    <circle cx="10" cy="10" r="1.5" />
    <circle cx="15" cy="10" r="1.5" />
  </svg>
);

export const ImageIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5.5-5.5L8 18" />
  </svg>
);

export const chipButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  color: "var(--color-text-muted)",
  borderRadius: 999,
  padding: "5px 10px",
  fontFamily: "var(--font-sans)",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  background: "transparent",
  border: "1px solid transparent",
} as const;

export const chipStyle = {
  ...chipButtonStyle,
  background: "var(--color-raised)",
  border: "1px solid var(--color-border)",
  color: "var(--color-text)",
} as const;

/** Circular icon-only chips so +, worktree, commit, and terminal line up (t3code). */
export const toolbarIconChipStyle = {
  ...chipButtonStyle,
  width: 32,
  height: 32,
  padding: 0,
  justifyContent: "center",
  gap: 0,
  flexShrink: 0,
  borderRadius: 999,
  border: "1px solid var(--color-border)",
  background: "color-mix(in srgb, var(--color-raised) 70%, transparent)",
} as const;
