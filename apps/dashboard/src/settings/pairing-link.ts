/**
 * What the pairing QR code holds, for the phone app to scan: `aop://pair?code=…&host=…`.
 * `host` is this page's origin only when it is HTTPS, as it is through `tailscale serve`; a
 * loopback address names the host machine itself and means nothing to a phone, which then
 * asks for the address (apps/mobile/shared/.../host/Pairing.kt reads the same format).
 */
export const pairingLink = (code: string, origin: string | null): string => {
  const params = new URLSearchParams({ code });
  if (origin?.startsWith("https://")) params.set("host", origin);
  return `aop://pair?${params.toString()}`;
};
