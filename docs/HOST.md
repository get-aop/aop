# Running the AOP host

The AOP host is the local server on the machine that keeps your projects, threads, and settings. Other computers reach it as clients. This guide covers how clients are authenticated, how to pair one, and how to reach the host from another machine with `tailscale serve`.

## Who can call the API

Every `/api/*` route needs credentials except the few a client must reach before it has any. A request is one of three things.

| Caller | How it identifies itself | Can do |
| --- | --- | --- |
| Host owner | Nothing. A request made directly on the host machine (see [The host owner](#the-host-owner)). | Everything, including administering the host. |
| Paired device | `Authorization: Bearer <token>`, or the `aop_device` cookie the host set for it. | Everything except administering the host. |
| Anyone else | Nothing. | `GET /api/health`, `POST /api/auth/pair`, and `/api/mcp`, which checks its own per-session token. |

Administering the host means pairing devices, listing and revoking them, `POST /api/updates/install`, and `POST /api/chat-sessions/:id/terminal`. Only the host owner can do these, so a stolen laptop cannot mint itself a new token or remove the owner's other devices. The list lives in `apps/local-server/src/auth/route-policy.ts`. A route that is not listed there is open to paired devices and closed to everyone else.

### The host owner

The dashboard and the `aop` CLI running on the host need no pairing. A request counts as the host owner's when all of these hold:

1. The TCP peer is a loopback address.
2. The `Host` header names loopback: `localhost`, `aop.localhost`, `127.0.0.1`, or `::1`.
3. The request carries no header a reverse proxy adds when it forwards: `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, `Via`, `CF-Connecting-IP`, `True-Client-IP`, or any `Tailscale-*` header.

Loopback alone is not enough. `tailscale serve`, Caddy, and every other reverse proxy connect to the server from `127.0.0.1` on behalf of remote clients, so a rule that trusted the socket would give the whole network owner access. Condition 2 rejects a proxy that forwards the client's `Host`, condition 3 rejects one that rewrites it, and each rule also stops a DNS-rebound web page.

A request that fails any condition is authenticated like any other remote request.

Browser requests must also come from the API's own origin. A page on another origin, including another local port, gets `403`. To allow more, list them in `AOP_ALLOWED_ORIGINS`.

## Pair a device

Pairing needs the host owner, so run the first command on the host.

1. On the host, ask for a one-time code. It works once and expires after ten minutes. Asking again replaces it.

   ```bash
   curl -s -X POST http://127.0.0.1:25150/api/auth/pairing-codes
   # {"code":"K7QM-4XNP","expiresAt":"..."}
   ```

2. On the new device, trade the code for a token. Use the host's address as the client sees it, such as the `tailscale serve` URL.

   ```bash
   curl -s -X POST https://mac.tail1234.ts.net/api/auth/pair \
     -H 'Content-Type: application/json' \
     -d '{"code":"K7QM-4XNP","name":"Work laptop"}'
   # {"device":{"id":"...","name":"Work laptop",...},"token":"aop_..."}
   ```

   The token appears in this response only. The host keeps a SHA-256 hash of it, so a lost token means pairing again. The same response sets the `aop_device` cookie, which is all a browser needs.

Five wrong codes in a minute lock pairing for the rest of that minute, including for the right code. The response is `429` with `Retry-After`.

### Use the token

- Programs send `Authorization: Bearer aop_...`.
- Browsers send the cookie automatically, which is how an `EventSource` authenticates: it cannot set headers. A client that holds a token and needs the cookie calls `POST /api/auth/session` with the bearer header.
- `GET /api/auth/me` reports who the host thinks you are.

The cookie is `HttpOnly` and `SameSite=Strict`, and it is `Secure` when the request came in over HTTPS.

### List and revoke devices

Run these on the host.

```bash
curl -s http://127.0.0.1:25150/api/auth/devices
curl -s -X DELETE http://127.0.0.1:25150/api/auth/devices/<id>
```

Revoking takes effect on the device's next request, and the host closes any event stream the device already holds open. A device can also sign itself out with `DELETE /api/auth/session`, which revokes it.

## Reach the host with Tailscale

Keep the server on loopback and let `tailscale serve` terminate TLS in front of it. The tailnet then reaches the host over HTTPS with a certificate Tailscale provisions.

1. Install Tailscale on the host and on each client, and sign in to the same tailnet.
2. In the Tailscale admin console, enable MagicDNS and HTTPS certificates.
3. On the host, publish the local server. The default port is 25150.

   ```bash
   tailscale serve --bg --https=443 http://127.0.0.1:25150
   tailscale serve status
   ```

4. From a client, open `https://<host-name>.<tailnet>.ts.net` and pair as above.
5. Check that the proxy did not become a way in. From a client that is not paired, this must return `401`:

   ```bash
   curl -i https://<host-name>.<tailnet>.ts.net/api/auth/me
   ```

   A `200` with `{"kind":"owner"}` means the proxy makes remote requests look local. Stop the proxy and do not use it until it forwards the client's `Host` or adds a forwarding header.

To stop publishing the host, run `tailscale serve reset`. Do not use `tailscale funnel` for the host: it puts the API on the public internet, where the only protection is a token.

Tailscale's documentation confirms that `tailscale serve` adds `Tailscale-User-Login`, `Tailscale-User-Name`, and `Tailscale-User-Profile-Pic` for tailnet traffic, which condition 3 above catches. It does not say whether the client's `Host` is preserved or whether `X-Forwarded-*` headers are added. Run the check in step 5 on your own setup.

If a browser is refused with `403: cross-origin requests are not allowed`, the proxy rewrote `Host` and sent no `X-Forwarded-Host`, so the page's origin no longer matches. Set the public origin explicitly:

```bash
AOP_ALLOWED_ORIGINS=https://<host-name>.<tailnet>.ts.net
```

### Other proxies

Caddy works when it forwards the client's `Host`, which it does by default, or when it adds `X-Forwarded-For`, which `reverse_proxy` also does by default:

```caddyfile
aop.example.com {
	reverse_proxy 127.0.0.1:25150
}
```

A proxy that rewrites `Host` to `127.0.0.1` and adds no forwarding header passes all three conditions, so its remote clients would be treated as the host owner. nginx's default `proxy_pass` does this. Add `proxy_set_header X-Forwarded-For $remote_addr;` or `proxy_set_header Host $host;`, then run the check in step 5.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `AOP_LOCAL_SERVER_PORT` | none, required | Port the server listens on. |
| `AOP_BIND_HOST` | `127.0.0.1` | Address the server listens on. Set `0.0.0.0` to serve the network directly over plain HTTP. |
| `AOP_ALLOWED_ORIGINS` | none | Comma-separated browser origins, besides the API's own, that may call the API. |

Prefer `tailscale serve` to `AOP_BIND_HOST`. A direct bind sends tokens over plain HTTP, so use it only on a network you trust, and the browser will not treat the page as a secure context. If you bind one specific non-loopback address, the host's own agents can no longer reach the MCP endpoint at `127.0.0.1`; set `AOP_MCP_URL` to an address they can reach.

## Limits

- Pairing codes and the wrong-code counter live in memory, so a host restart closes an open pairing.
- Paired devices are trusted equally. There are no per-device permissions.
- The `aop` CLI sends no token, so it works only on the host. It cannot reach a host across the network yet.
- The dashboard has no pairing screen yet. Pair with the commands above or from the browser console with `fetch('/api/auth/pair', { method: 'POST', ... })`.
