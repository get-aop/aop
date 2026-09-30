import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isDirectLocalRequest } from "./local-request.ts";
import { LOOPBACK_PEER, peerAt, REMOTE_PEER } from "./test-utils.ts";

const app = new Hono();
app.all("/probe", (c) => c.json({ direct: isDirectLocalRequest(c) }));

const isDirect = async (
  url: string,
  options: { peer?: ReturnType<typeof peerAt> | undefined; headers?: Record<string, string> } = {},
): Promise<boolean> => {
  const res = await app.request(url, { headers: options.headers }, options.peer);
  return ((await res.json()) as { direct: boolean }).direct;
};

describe("isDirectLocalRequest", () => {
  test("a request from a loopback peer to a loopback host is the host's own", async () => {
    for (const host of [
      "127.0.0.1:25150",
      "localhost:25150",
      "aop.localhost:25150",
      "[::1]:25150",
    ]) {
      expect(await isDirect(`http://${host}/probe`, { peer: LOOPBACK_PEER })).toBe(true);
    }
  });

  test("accepts every loopback form of the peer address", async () => {
    for (const address of ["127.0.0.1", "127.0.0.2", "::1", "::ffff:127.0.0.1"]) {
      expect(await isDirect("http://127.0.0.1/probe", { peer: peerAt(address) })).toBe(true);
    }
  });

  test("a request with no socket behind it is not the host's own", async () => {
    expect(await isDirect("http://127.0.0.1:25150/probe")).toBe(false);
  });

  test("a peer that is not loopback is never the host's own, whatever it says its Host is", async () => {
    expect(await isDirect("http://127.0.0.1:25150/probe", { peer: REMOTE_PEER })).toBe(false);
    expect(await isDirect("http://100.64.0.5:25150/probe", { peer: REMOTE_PEER })).toBe(false);
    for (const address of ["192.168.1.20", "10.0.0.5", "fd7a:115c:a1e0::1", "::ffff:100.64.0.7"]) {
      expect(await isDirect("http://localhost/probe", { peer: peerAt(address) })).toBe(false);
    }
  });

  test("a loopback peer asking for a non-loopback host is a DNS-rebound page or a proxy", async () => {
    expect(await isDirect("http://mac.tail1234.ts.net/probe", { peer: LOOPBACK_PEER })).toBe(false);
    expect(await isDirect("http://aop.localhost.evil.com/probe", { peer: LOOPBACK_PEER })).toBe(
      false,
    );
    expect(
      await isDirect("http://127.0.0.1/probe", {
        peer: LOOPBACK_PEER,
        headers: { host: "mac.tail1234.ts.net" },
      }),
    ).toBe(false);
  });

  test("a proxy's connection is not the host's own even when it keeps a loopback Host", async () => {
    const forwarded: Record<string, string> = {
      "x-forwarded-for": "100.64.0.7",
      "x-forwarded-host": "mac.tail1234.ts.net",
      "x-forwarded-proto": "https",
      "x-forwarded-port": "443",
      forwarded: "for=100.64.0.7;proto=https",
      "x-real-ip": "100.64.0.7",
      via: "1.1 caddy",
      "cf-connecting-ip": "203.0.113.9",
      "true-client-ip": "203.0.113.9",
      "tailscale-user-login": "marcelo@example.com",
      "tailscale-user-name": "Marcelo",
    };
    for (const [name, value] of Object.entries(forwarded)) {
      const direct = await isDirect("http://127.0.0.1:25150/probe", {
        peer: LOOPBACK_PEER,
        headers: { [name]: value },
      });
      expect({ header: name, direct }).toEqual({ header: name, direct: false });
    }
  });
});
