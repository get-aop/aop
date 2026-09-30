import {
  type AuthPrincipal,
  AuthPrincipalSchema,
  type HostHealth,
  HostHealthSchema,
  PairedDeviceSchema,
  PairingCodeSchema,
} from "@aop/common";

/** `net.fetch` in the app, a fake in tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HealthResult =
  | { status: "ok"; health: HostHealth }
  | { status: "not-aop" }
  | { status: "unreachable"; message: string; failure: NetworkFailure };

export type PrincipalResult =
  | { status: "ok"; principal: AuthPrincipal }
  | { status: "unauthorized" }
  | { status: "unreachable"; message: string }
  | { status: "failed"; message: string };

export type PairResult =
  | { status: "paired"; token: string }
  | { status: "wrong-code" }
  | { status: "rate-limited"; retryAfterSeconds: number | null }
  | { status: "unreachable"; message: string }
  | { status: "failed"; message: string };

export type PairingCodeResult =
  | { status: "ok"; code: string; expiresAt: string }
  | { status: "not-owner" }
  | { status: "unreachable"; message: string }
  | { status: "failed"; message: string };

/** The few calls the app makes to a host itself, as opposed to the ones its dashboard makes. */
export interface HostClient {
  health: () => Promise<HealthResult>;
  /** Who the host thinks the caller is. `null` sends no token: the owner on the host's own Mac. */
  principal: (token: string | null) => Promise<PrincipalResult>;
  pair: (code: string, deviceName: string) => Promise<PairResult>;
  /** Asks a host for a one-time pairing code. Only the host owner may. */
  createPairingCode: () => Promise<PairingCodeResult>;
  /** Removes this device from the host. Best effort: the caller drops its token either way. */
  signOut: (token: string) => Promise<void>;
}

const REQUEST_TIMEOUT_MS = 6_000;

export const createHostClient = (
  baseUrl: string,
  fetchImpl: FetchLike,
  timeoutMs = REQUEST_TIMEOUT_MS,
): HostClient => {
  // No cookies: the app authenticates with the bearer token alone, so nothing ambient rides along.
  const call = (path: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(`${baseUrl}/api${path}`, {
      ...init,
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });

  return {
    health: async () => {
      try {
        const response = await call("/health");
        const parsed = response.ok ? HostHealthSchema.safeParse(await readJson(response)) : null;
        return parsed?.success ? { status: "ok", health: parsed.data } : { status: "not-aop" };
      } catch (error) {
        return {
          status: "unreachable",
          message: describeNetworkError(error),
          failure: classifyNetworkError(error),
        };
      }
    },

    principal: async (token) => {
      try {
        const response = await call("/auth/me", { headers: bearer(token) });
        if (response.status === 401) return { status: "unauthorized" };
        const parsed = response.ok ? AuthPrincipalSchema.safeParse(await readJson(response)) : null;
        return parsed?.success
          ? { status: "ok", principal: parsed.data }
          : { status: "failed", message: `The host answered ${response.status}.` };
      } catch (error) {
        return { status: "unreachable", message: describeNetworkError(error) };
      }
    },

    pair: async (code, deviceName) => {
      try {
        const response = await call("/auth/pair", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, name: deviceName }),
        });
        return await readPairResponse(response);
      } catch (error) {
        return { status: "unreachable", message: describeNetworkError(error) };
      }
    },

    createPairingCode: async () => {
      try {
        const response = await call("/auth/pairing-codes", { method: "POST" });
        if (response.status === 401 || response.status === 403) return { status: "not-owner" };
        const parsed = response.ok ? PairingCodeSchema.safeParse(await readJson(response)) : null;
        return parsed?.success
          ? { status: "ok", ...parsed.data }
          : { status: "failed", message: `The host answered ${response.status}.` };
      } catch (error) {
        return { status: "unreachable", message: describeNetworkError(error) };
      }
    },

    signOut: async (token) => {
      await call("/auth/session", { method: "DELETE", headers: bearer(token) }).catch(
        () => undefined,
      );
    },
  };
};

const readPairResponse = async (response: Response): Promise<PairResult> => {
  if (response.status === 401) return { status: "wrong-code" };
  if (response.status === 429) {
    const seconds = Number(response.headers.get("retry-after"));
    return {
      status: "rate-limited",
      retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    };
  }
  const paired = response.ok ? PairedDeviceSchema.safeParse(await readJson(response)) : null;
  return paired?.success
    ? { status: "paired", token: paired.data.token }
    : { status: "failed", message: `The host answered ${response.status}.` };
};

const bearer = (token: string | null): Record<string, string> =>
  token === null ? {} : { Authorization: `Bearer ${token}` };

const readJson = (response: Response): Promise<unknown> => response.json().catch(() => null);

export type NetworkFailure =
  | "timeout"
  | "not-found"
  | "refused"
  | "certificate"
  | "offline"
  | "other";

const FAILURE_PATTERNS: [NetworkFailure, RegExp][] = [
  ["timeout", /TimeoutError|ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|ETIMEDOUT/i],
  ["not-found", /ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i],
  ["refused", /ERR_CONNECTION_REFUSED|ECONNREFUSED/i],
  ["certificate", /ERR_CERT|CERT_|SSL|TLS/i],
  ["offline", /ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENETUNREACH|EHOSTUNREACH/i],
];

const FAILURE_MESSAGES: Record<NetworkFailure, string> = {
  timeout: "The host did not answer in time.",
  "not-found": "The address could not be found. Check it, and that Tailscale is connected.",
  refused: "The host refused the connection. Check that AOP is running on it.",
  certificate:
    "The host's certificate is not trusted. Use the https:// address that `tailscale serve` shows.",
  offline: "This computer cannot reach the network.",
  other: "Could not reach the host.",
};

/**
 * Sorts a failed request by what a person can do about it. Chromium reports `net::ERR_*`, Node
 * reports `ECONNREFUSED` and friends, and a timeout is an `AbortSignal` error.
 */
export const classifyNetworkError = (error: unknown): NetworkFailure => {
  const text = `${error instanceof Error ? `${error.name} ${error.message}` : String(error)} ${causeCode(error)}`;
  return FAILURE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "other";
};

/** Says what went wrong in words a person can act on. */
export const describeNetworkError = (error: unknown): string =>
  FAILURE_MESSAGES[classifyNetworkError(error)];

const causeCode = (error: unknown): string => {
  const cause =
    error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
  return typeof cause?.code === "string" ? cause.code : "";
};
