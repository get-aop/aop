import { apiUrl, authHeaders, isRemoteHost } from "./host";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: { path?: string | null; resettable?: boolean } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const UNAUTHENTICATED = "UNAUTHENTICATED";

type UnauthenticatedListener = () => void;
const unauthenticatedListeners = new Set<UnauthenticatedListener>();

/**
 * Called when the host answers 401 `UNAUTHENTICATED`: this client has no valid device token
 * (never paired, or revoked). The app answers by showing the pairing screen.
 */
export const onUnauthenticated = (listener: UnauthenticatedListener): (() => void) => {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
};

export const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(apiUrl(path), {
    // Every API answer can change between two visits, so a stale browser cache must never serve one.
    cache: "no-store",
    credentials: isRemoteHost() ? "include" : "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...options.headers,
    },
  });

  const data = await readResponseJson(response);
  if (!response.ok) {
    const error = apiErrorFromResponse(response, data);
    if (error.status === 401 && error.code === UNAUTHENTICATED) {
      for (const listener of unauthenticatedListeners) listener();
    }
    throw error;
  }

  return data as T;
};

/** What a conditional read got: the host's new answer and its ETag, or "you already have it". */
export type ConditionalRead<T> =
  | { changed: true; value: T; etag: string | null }
  | { changed: false };

/**
 * A `GET` that sends the ETag of the answer this client holds; a host that has nothing new
 * answers 304 with no body, which costs neither side a JSON parse or a re-render.
 */
export const requestIfChanged = async <T>(
  path: string,
  etag: string | null,
): Promise<ConditionalRead<T>> => {
  const response = await fetch(apiUrl(path), {
    cache: "no-store",
    credentials: isRemoteHost() ? "include" : "same-origin",
    headers: { ...authHeaders(), ...(etag ? { "If-None-Match": etag } : {}) },
  });
  if (response.status === 304) return { changed: false };
  const data = await readResponseJson(response);
  if (!response.ok) {
    const error = apiErrorFromResponse(response, data);
    if (error.status === 401 && error.code === UNAUTHENTICATED) {
      for (const listener of unauthenticatedListeners) listener();
    }
    throw error;
  }
  return { changed: true, value: data as T, etag: response.headers.get("ETag") };
};

/** The query of a messages list that asks for the page before message `before`; none is the latest page. */
export const beforeQuery = (before: string | undefined): string =>
  before === undefined ? "" : `?before=${encodeURIComponent(before)}`;

export const isUnauthenticated = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401 && error.code === UNAUTHENTICATED;

const readResponseJson = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const apiErrorFromResponse = (response: Response, data: Record<string, unknown>): ApiError => {
  const message =
    typeof data.error === "string"
      ? data.error
      : typeof data.message === "string"
        ? data.message
        : `Request failed (${response.status})`;
  return new ApiError(
    response.status,
    typeof data.code === "string" ? data.code : "UNKNOWN",
    message,
    {
      path: typeof data.path === "string" ? data.path : null,
      resettable: data.resettable === true,
    },
  );
};
