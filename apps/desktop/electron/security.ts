const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

export const isAllowedDesktopSender = (rawUrl: string, development: boolean): boolean => {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol === "app:" && url.hostname === "aop") return true;
  return development && LOOPBACK_HOSTS.has(url.hostname) && url.port === "25170";
};

export const isAllowedNavigation = (rawUrl: string, development: boolean): boolean => {
  const url = parseUrl(rawUrl);
  if (!url) return false;
  if (url.protocol === "app:" && url.hostname === "aop") return true;
  if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return false;
  if (development) return true;
  return url.port === "25150";
};

export const isSafeExternalUrl = (rawUrl: string): boolean => {
  const url = parseUrl(rawUrl);
  return url?.protocol === "https:" || url?.protocol === "http:";
};

const parseUrl = (rawUrl: string): URL | null => {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
};
