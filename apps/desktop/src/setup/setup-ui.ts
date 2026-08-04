import type { SetupRequirementStatus } from "./types";

/** Statuses the UI renders, adding the frontend-only `unknown`/`checking` states to the
 * backend-reported requirement statuses. */
export type UiStatus = SetupRequirementStatus | "unknown" | "checking";

export interface StatusChip {
  bg: string;
  fg: string;
  label: string;
  spinning: boolean;
}

const CHIP_META: Record<UiStatus, { bg: string; fg: string; label: string; spinning: boolean }> = {
  unknown: {
    bg: "color-mix(in srgb,var(--subtle) 13%,transparent)",
    fg: "var(--subtle)",
    label: "Not checked",
    spinning: false,
  },
  checking: { bg: "var(--workFill)", fg: "var(--work)", label: "Checking…", spinning: true },
  ready: { bg: "var(--okFill)", fg: "var(--ok)", label: "Ready", spinning: false },
  missing: { bg: "var(--readyFill)", fg: "var(--ready)", label: "Action needed", spinning: false },
  "needs-auth": {
    bg: "var(--readyFill)",
    fg: "var(--ready)",
    label: "Sign-in needed",
    spinning: false,
  },
  installing: { bg: "var(--workFill)", fg: "var(--work)", label: "Working…", spinning: true },
  failed: { bg: "var(--badFill)", fg: "var(--bad)", label: "Failed", spinning: false },
};

/** Resolve the chip (background, foreground, label, spin) for a status, optionally overriding
 * the label (e.g. the runtime card's "Pick one"). */
export const chipFor = (status: UiStatus, label?: string): StatusChip => {
  const meta = CHIP_META[status] ?? CHIP_META.unknown;
  return { bg: meta.bg, fg: meta.fg, label: label ?? meta.label, spinning: meta.spinning };
};

/** Card border color for a status, matching the design's tinted outlines. */
export const borderFor = (status: UiStatus): string => {
  if (status === "installing") return "var(--work)";
  if (status === "ready") return "color-mix(in srgb,var(--ok) 30%,var(--border))";
  if (status === "missing" || status === "needs-auth") {
    return "color-mix(in srgb,var(--ready) 45%,var(--border))";
  }
  return "var(--border)";
};

/** Terminal line color from its leading glyph (`✓` success, `$` command, else progress). */
export const lineColor = (text: string): string => {
  const lead = text.charAt(0);
  if (lead === "✓") return "#5be59a";
  if (lead === "$") return "#eef2fb";
  return "#868ca2";
};
