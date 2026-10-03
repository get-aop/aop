import { AGENT_SESSION_HEADER, buildChannel } from "@aop/common";

const DEFAULT_LOCAL_SERVER_URL = `http://127.0.0.1:${buildChannel().hostPort}`;

export const getServerUrl = (): string => {
  const configuredUrl = process.env.AOP_LOCAL_SERVER_URL?.trim();
  return configuredUrl && configuredUrl.length > 0 ? configuredUrl : DEFAULT_LOCAL_SERVER_URL;
};

export interface ServerError {
  error: string;
  [key: string]: unknown;
}

export const fetchServer = async <T>(
  path: string,
  options?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; error: ServerError; status: number }> => {
  const serverUrl = getServerUrl();
  const response = await fetch(`${serverUrl}${path}`, asAgentWhenInTurn(options));

  if (!response.ok) {
    const error = (await response.json()) as ServerError;
    return { ok: false, error, status: response.status };
  }

  const data = (await response.json()) as T;
  return { ok: true, data };
};

/**
 * Inside an agent's turn (the host sets AOP_CHAT_SESSION_ID for it), the request says so: the
 * host then refuses what only a person may do on it, such as updating it or changing who may.
 */
export const asAgentWhenInTurn = (
  options: RequestInit | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RequestInit | undefined => {
  const session = env.AOP_CHAT_SESSION_ID?.trim();
  if (!session) return options;
  const headers = new Headers(options?.headers);
  headers.set(AGENT_SESSION_HEADER, session);
  return { ...options, headers };
};
