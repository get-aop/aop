export interface FailureLimiter {
  /** Milliseconds until another attempt is allowed; 0 when attempts are open. */
  retryAfterMs: () => number;
  recordFailure: () => void;
}

export interface FailureLimiterOptions {
  maxFailures: number;
  windowMs: number;
  now?: () => Date;
}

/**
 * Sliding-window cap on failed attempts, shared by every caller. It is deliberately not
 * keyed by source address: behind `tailscale serve` every request arrives from loopback,
 * so a per-address budget would be one budget anyway, and a spoofed forwarding header
 * must not be able to buy a fresh one.
 */
export const createFailureLimiter = (options: FailureLimiterOptions): FailureLimiter => {
  const now = options.now ?? (() => new Date());
  let failures: number[] = [];

  const forgetExpired = () => {
    const cutoff = now().getTime() - options.windowMs;
    failures = failures.filter((at) => at > cutoff);
  };

  return {
    retryAfterMs: () => {
      forgetExpired();
      const oldest = failures[0];
      if (failures.length < options.maxFailures || oldest === undefined) return 0;
      return oldest + options.windowMs - now().getTime();
    },
    recordFailure: () => {
      failures.push(now().getTime());
    },
  };
};
