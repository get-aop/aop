import { normalizeReleaseVersion } from "@aop/common";

export interface ProbeOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
}

/** The release the host on `port` reports on `/api/health`, or null when nothing answers. */
export const readHostVersion = async (
  port: number,
  fetchFn: typeof fetch = fetch,
): Promise<string | null> => {
  try {
    const response = await fetchFn(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
};

/** True once the host reports `version` (build metadata ignored), false when `timeoutMs` runs out. */
export const waitForHostVersion = (
  port: number,
  version: string,
  timeoutMs: number,
  options: ProbeOptions = {},
): Promise<boolean> =>
  pollUntil(
    async () => {
      const reported = await readHostVersion(port, options.fetchFn);
      return reported !== null && normalizeReleaseVersion(reported) === version;
    },
    timeoutMs,
    options,
  );

/** True once nothing answers on `port`, false when `timeoutMs` runs out. */
export const waitUntilHostDown = (
  port: number,
  timeoutMs: number,
  options: ProbeOptions = {},
): Promise<boolean> =>
  pollUntil(
    async () => (await readHostVersion(port, options.fetchFn)) === null,
    timeoutMs,
    options,
  );

const pollUntil = async (
  done: () => Promise<boolean>,
  timeoutMs: number,
  { sleep = Bun.sleep, now = Date.now, intervalMs = 500 }: ProbeOptions,
): Promise<boolean> => {
  const deadline = now() + timeoutMs;
  while (true) {
    if (await done()) return true;
    if (now() >= deadline) return false;
    await sleep(intervalMs);
  }
};
