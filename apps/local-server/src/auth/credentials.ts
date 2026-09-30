import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

/**
 * Browsers cannot put an `Authorization` header on an `EventSource`, but they send cookies
 * on every same-origin request, so the browser client holds its device token in a cookie.
 * The cookie value is the device token itself: revoking the device ends the cookie and the
 * bearer token in one step, with no second session store to keep in sync.
 */
const DEVICE_COOKIE = "aop_device";
// The longest lifetime browsers honor. The token, not the cookie, decides how long access lasts.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const bearerTokenOf = (c: Context): string | undefined =>
  /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];

export const readSessionCookie = (c: Context): string | undefined => getCookie(c, DEVICE_COOKIE);

export const setSessionCookie = (c: Context, token: string): void => {
  setCookie(c, DEVICE_COOKIE, token, {
    httpOnly: true,
    // Strict: the dashboard and the API share an origin, so nothing legitimate is cross-site.
    sameSite: "Strict",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    // Plain http is allowed for a direct tailnet or LAN bind, where Secure would drop the cookie.
    secure: isHttps(c),
  });
};

export const clearSessionCookie = (c: Context): void => {
  deleteCookie(c, DEVICE_COOKIE, { path: "/" });
};

const isHttps = (c: Context): boolean => {
  const forwarded = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "https" || new URL(c.req.url).protocol === "https:";
};
