/**
 * Where the AOP host's API lives and how this client introduces itself.
 *
 * The default is the page's own origin: the host serves the dashboard, so `/api` is the API
 * and the browser's `aop_device` cookie is the credential, on plain requests and on
 * `EventSource` alike. A client that is served from elsewhere (the desktop app, a dev build)
 * stores the host's base URL and its device token instead, and every request then carries the
 * token as a bearer header.
 */
const HOST_STORAGE_KEY = "aop:host:v1";

export interface HostConfig {
  /** Origin of the host, without a trailing slash; null means the page's own origin. */
  baseUrl: string | null;
  /** Device token for a host on another origin; null when the cookie authenticates. */
  token: string | null;
}

export const getHostConfig = (): HostConfig => {
  const raw = readStorage();
  if (raw === null) return { baseUrl: null, token: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    const { baseUrl, token } = (parsed ?? {}) as Partial<Record<keyof HostConfig, unknown>>;
    return {
      baseUrl: typeof baseUrl === "string" && baseUrl ? baseUrl.replace(/\/+$/, "") : null,
      token: typeof token === "string" && token ? token : null,
    };
  } catch {
    return { baseUrl: null, token: null };
  }
};

export const setHostConfig = (config: HostConfig): void => {
  try {
    if (config.baseUrl === null && config.token === null) {
      window.localStorage.removeItem(HOST_STORAGE_KEY);
    } else {
      window.localStorage.setItem(HOST_STORAGE_KEY, JSON.stringify(config));
    }
  } catch {
    // Storage can be unavailable (private mode); the client then stays on its own origin.
  }
};

/** The absolute-or-relative URL of an API path such as `/projects`. */
export const apiUrl = (path: string): string => `${getHostConfig().baseUrl ?? ""}/api${path}`;

/** Headers that authenticate a request to a host on another origin. Empty when the cookie does. */
export const authHeaders = (): Record<string, string> => {
  const { token } = getHostConfig();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** A host on another origin needs cookies sent across origins; the page's own origin does not. */
export const isRemoteHost = (): boolean => getHostConfig().baseUrl !== null;

const readStorage = (): string | null => {
  try {
    return window.localStorage.getItem(HOST_STORAGE_KEY);
  } catch {
    return null;
  }
};
