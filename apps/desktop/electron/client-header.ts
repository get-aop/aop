import { CLIENT_HEADER, formatClientHeader } from "@aop/common";
import type { FetchLike } from "./connection/host-client";

/**
 * Every request this app and its dashboard make to the host says which app and version sent it
 * (`x-aop-client: desktop; version=…; platform=…`), so the host can show, per paired device,
 * an app that is out of date (AOP settings › Host).
 */
export const clientHeaderValue = (version: string, platform: string): string =>
  formatClientHeader({ version, platform });

/** The main process's own calls to the host (the connection check, pairing, notifications). */
export const withClientHeader =
  (fetchImpl: FetchLike, value: string): FetchLike =>
  (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set(CLIENT_HEADER, value);
    return fetchImpl(input, { ...init, headers });
  };

/** The part of Electron's session that can change a request's headers before it leaves. */
export interface HeaderSession {
  webRequest: {
    onBeforeSendHeaders: (
      filter: { urls: string[] },
      listener: (
        details: { url: string; requestHeaders: Record<string, string> },
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ) => void;
  };
}

/**
 * The dashboard's requests, its event streams and images included: the header goes on every
 * request to the host the app is connected to now, and on nothing else, so no other site learns
 * which app this is.
 */
export const installClientHeader = (
  session: HeaderSession,
  hostOrigin: () => string | null,
  value: string,
): void => {
  session.webRequest.onBeforeSendHeaders(
    { urls: ["http://*/*", "https://*/*"] },
    (details, callback) => {
      const host = hostOrigin();
      const toHost = host !== null && originOf(details.url) === originOf(host);
      callback({
        requestHeaders: toHost
          ? { ...details.requestHeaders, [CLIENT_HEADER]: value }
          : details.requestHeaders,
      });
    },
  );
};

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};
