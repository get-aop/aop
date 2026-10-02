/** Where a search typed in the address bar goes. */
export const SEARCH_URL = "https://www.google.com/search?q=";

/**
 * What the address bar loads for what was typed: a web address as it stands, a bare host with
 * the scheme it most likely means, or a search. Local and private-network hosts (`localhost:5173`,
 * `my-app.localhost`, `192.168.1.20:3000`, `[::1]:8080`) get `http://`, since a dev server rarely
 * has a certificate; every other host gets `https://`. Other schemes (`file:`, `javascript:`,
 * `mailto:`…) are searched for, never loaded. Empty input loads nothing.
 */
export const resolveAddress = (typed: string): string | null => {
  const text = typed.trim();
  if (!text) return null;
  if (text === "about:blank") return text;
  if (/^https?:\/\//i.test(text)) return webUrl(text) ?? searchUrl(text);
  if (/\s/.test(text)) return searchUrl(text);
  const host = hostOf(text);
  if (host && looksLikeHost(host)) {
    return webUrl(`${isLocalHost(host) ? "http" : "https"}://${text}`) ?? searchUrl(text);
  }
  return searchUrl(text);
};

/** What the address bar shows for a loaded page when it is not being edited. */
export const displayAddress = (url: string | null): string =>
  !url || url === "about:blank" ? "" : url;

/** A short name for a page with no title yet: its host, or what it is. */
export const pageLabel = (url: string | null, title?: string): string => {
  if (title?.trim()) return title.trim();
  if (!url || url === "about:blank") return "New tab";
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

const searchUrl = (text: string): string => `${SEARCH_URL}${encodeURIComponent(text)}`;

const webUrl = (text: string): string | null => {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};

// The host part of something typed without a scheme: up to the first `/`, `?` or `#`, without a
// port. An IPv6 literal keeps its brackets.
const hostOf = (text: string): string | null => {
  const authority = text.split(/[/?#]/, 1)[0] ?? "";
  if (authority.includes("@")) return null;
  if (authority.startsWith("[")) {
    const end = authority.indexOf("]");
    return end > 0 ? authority.slice(0, end + 1) : null;
  }
  const [host, port, ...extra] = authority.split(":");
  if (extra.length > 0 || (port !== undefined && !/^\d{1,5}$/.test(port))) return null;
  return host || null;
};

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// A dotted name with a letters-only last label (`example.com`, `docs.bun.sh`), an IP address,
// `localhost`, or an IPv6 literal. A single word is a search.
const looksLikeHost = (host: string): boolean => {
  if (host.startsWith("[")) return true;
  if (isIpv4(host)) return true;
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  return /^([a-z0-9-]+\.)+[a-z]{2,63}$/i.test(lower) && !lower.startsWith("-");
};

const isIpv4 = (host: string): boolean => {
  const parts = IPV4.exec(host);
  return parts?.slice(1).every((part) => Number(part) <= 255) ?? false;
};

const LOCAL_SUFFIXES = [".localhost", ".local", ".test", ".internal", ".lan", ".home.arpa"];

const isLocalHost = (host: string): boolean => {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.startsWith("[")) return true;
  if (LOCAL_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return true;
  return isIpv4(lower) && isPrivateIpv4(lower);
};

const isPrivateIpv4 = (host: string): boolean => {
  const [a = 0, b = 0] = host.split(".").map(Number);
  return (
    a === 127 ||
    a === 10 ||
    a === 0 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127)
  );
};
