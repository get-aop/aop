/** What to show for a failed request: the host's own words when it sent some. */
export const messageOf = (cause: unknown, fallback: string): string =>
  cause instanceof Error ? cause.message : fallback;
