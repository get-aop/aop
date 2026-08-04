import type { ChatDelegationViewStatus } from "@aop/common";

export interface DelegationStatusMeta {
  label: string;
  color: string;
  fill: string;
  border: string;
  pulse: boolean;
}

const STATUS_META: Record<ChatDelegationViewStatus, DelegationStatusMeta> = {
  starting: {
    label: "Starting",
    color: "var(--color-running)",
    fill: "var(rgb(91 157 255 / 12%))",
    border: "var(rgb(91 157 255 / 32%))",
    pulse: true,
  },
  working: {
    label: "Working",
    color: "var(--color-running)",
    fill: "var(rgb(91 157 255 / 12%))",
    border: "var(rgb(91 157 255 / 32%))",
    pulse: true,
  },
  waiting: {
    label: "Waiting",
    color: "var(--color-running)",
    fill: "var(rgb(91 157 255 / 12%))",
    border: "var(rgb(91 157 255 / 32%))",
    pulse: true,
  },
  completed: {
    label: "Completed",
    color: "var(--color-ok)",
    fill: "var(rgb(63 185 80 / 12%))",
    border: "var(rgb(63 185 80 / 32%))",
    pulse: false,
  },
  failed: {
    label: "Failed",
    color: "var(--color-blocked)",
    fill: "var(rgb(240 87 79 / 12%))",
    border: "var(rgb(240 87 79 / 32%))",
    pulse: false,
  },
  cancelled: {
    label: "Cancelled",
    color: "var(--color-text-muted)",
    fill: "color-mix(in srgb, var(--color-text-muted) 10%, transparent)",
    border: "var(--color-border)",
    pulse: false,
  },
};

export const delegationStatusMeta = (status: ChatDelegationViewStatus): DelegationStatusMeta =>
  STATUS_META[status];

/** Elapsed clock between a start ISO timestamp and an end epoch (ms). */
export const formatDelegationElapsed = (startedAt: string, endMs: number): string => {
  const startMs = Date.parse(startedAt);
  const totalSeconds = Math.max(
    0,
    Math.floor((endMs - (Number.isNaN(startMs) ? endMs : startMs)) / 1000),
  );
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(hours > 0 ? 2 : 1, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
};
