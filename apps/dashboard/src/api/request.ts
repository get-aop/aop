const API_BASE = "/api";

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

export const request = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE}${path}`, {
    // Session chat and other local APIs must never serve a stale browser cache after
    // navigating away and back (or after background assistant writes).
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  const data = await readResponseJson(response);
  if (!response.ok) throw apiErrorFromResponse(response, data);

  return data as T;
};

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
