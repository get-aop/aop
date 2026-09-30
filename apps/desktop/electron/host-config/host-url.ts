export type HostUrlResult = { ok: true; url: string } | { ok: false; message: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Turns what a person typed into the origin of a host, or says why it cannot be one.
 *
 * The app reaches a remote host over HTTPS only. Its pages run on a secure origin, which the
 * browser will not let call plain HTTP (mixed content), and the device token would cross the
 * network in the clear. `tailscale serve` gives the host HTTPS with a real certificate (see
 * docs/HOST.md). A host on this same computer is the one exception: loopback is not a network.
 */
export const parseHostUrl = (input: string): HostUrlResult => {
  const text = input.trim();
  if (text === "") return fail("Enter the address of your AOP host.");

  const url = parse(SCHEME.test(text) ? text : `${defaultScheme(text)}${text}`);
  if (!url || url.hostname === "") return fail("That is not a valid address.");
  if (url.username !== "" || url.password !== "") {
    return fail("Leave the user name and password out of the address.");
  }
  if (url.protocol === "https:" || (url.protocol === "http:" && isLoopbackHostname(url.hostname))) {
    return { ok: true, url: url.origin };
  }
  return fail(
    url.protocol === "http:"
      ? "Use an https:// address. The app only talks to a host over HTTPS, such as `tailscale serve` provides, or to a host on this computer over http://127.0.0.1."
      : `The app cannot connect over ${url.protocol.replace(":", "")}. Use an https:// address.`,
  );
};

export const isLoopbackHostname = (hostname: string): boolean =>
  LOOPBACK_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");

export const isLoopbackUrl = (rawUrl: string): boolean => {
  const url = parse(rawUrl);
  return url !== null && isLoopbackHostname(url.hostname);
};

// A bare address on this computer is not on the network, so it needs no certificate.
const defaultScheme = (text: string): string =>
  isLoopbackHostname(text.split(/[/:?#]/)[0] ?? "") || text.startsWith("[::1]")
    ? "http://"
    : "https://";

const parse = (text: string): URL | null => {
  try {
    return new URL(text);
  } catch {
    return null;
  }
};

const fail = (message: string): HostUrlResult => ({ ok: false, message });
