#!/usr/bin/env bun
/**
 * A stand-in for `tailscale serve`: a reverse proxy in front of a host, for checking that a request
 * that arrives through a proxy is not taken for the host owner. Real `tailscale serve` needs a
 * tailnet, so this plays its part on loopback.
 *
 *   bun .claude/skills/verify/scripts/serve-proxy.ts --listen 25451 --target http://127.0.0.1:25450 [--mode forwarded|rewrite-host]
 *
 * `forwarded` (default) keeps the client's `Host` and adds `X-Forwarded-For`, `X-Forwarded-Host` and
 * the `Tailscale-User-*` headers, which is what `tailscale serve` documents. `rewrite-host` sends
 * `Host: 127.0.0.1:<target port>` and no forwarding header, the case docs/HOST.md warns about (an
 * nginx `proxy_pass` with defaults): the host cannot tell that request from its owner's.
 * Bodies and event streams pass through unbuffered.
 */
const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string => {
  const at = args.indexOf(`--${name}`);
  const value = at === -1 ? fallback : args[at + 1];
  if (value === undefined) throw new Error(`missing --${name}`);
  return value;
};

const listen = Number(flag("listen"));
const target = new URL(flag("target"));
const mode = flag("mode", "forwarded");
if (mode !== "forwarded" && mode !== "rewrite-host") throw new Error(`unknown --mode ${mode}`);

const server = Bun.serve({
  port: listen,
  hostname: flag("hostname", "127.0.0.1"),
  idleTimeout: 0,
  async fetch(request, bunServer) {
    const incoming = new URL(request.url);
    const upstream = new URL(incoming.pathname + incoming.search, target);
    const headers = new Headers(request.headers);
    headers.delete("accept-encoding");
    if (mode === "rewrite-host") {
      headers.set("host", target.host);
    } else {
      const client = bunServer.requestIP(request)?.address ?? "100.64.0.2";
      headers.set("x-forwarded-for", client);
      headers.set("x-forwarded-host", request.headers.get("host") ?? incoming.host);
      headers.set("tailscale-user-login", "second-computer@example.ts.net");
      headers.set("tailscale-user-name", "Second Computer");
    }
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
      signal: request.signal,
    }).catch((error: unknown) => new Response(`proxy: ${String(error)}`, { status: 502 }));
    const out = new Headers(response.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(response.body, { status: response.status, headers: out });
  },
});

process.stdout.write(`proxy ${mode} on ${server.hostname}:${server.port} -> ${target.origin}\n`);
