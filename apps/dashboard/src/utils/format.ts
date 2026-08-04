export const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

export const formatDuration = (startedAt: string, finishedAt?: string): string => {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return formatDurationMs(Math.max(0, end - start));
};

export const formatDurationMs = (durationMs: number): string => {
  if (durationMs < 1000) return `${durationMs}ms`;

  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
};

export const formatRelativeAge = (createdAt: string, now: number = Date.now()): string => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "";

  const ageMs = Math.max(0, now - created);
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};
