import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  createOriginGuard,
  isAllowedOrigin,
  isLoopbackHost,
  requireNavigationRequest,
} from "./origin-guard.ts";

const buildApp = (allowedOrigins: string[] = []) => {
  const app = new Hono();
  app.use("/api/*", createOriginGuard({ allowedOrigins }));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/ping", (c) => c.json({ ok: true }));
  return app;
};

describe("isLoopbackHost", () => {
  test("accepts loopback hosts with and without port", () => {
    expect(isLoopbackHost("127.0.0.1:25150")).toBe(true);
    expect(isLoopbackHost("localhost:25150")).toBe(true);
    expect(isLoopbackHost("aop.localhost:25150")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("[::1]:25150")).toBe(true);
  });

  test("rejects non-loopback, empty, and malformed hosts", () => {
    expect(isLoopbackHost("evil.com")).toBe(false);
    expect(isLoopbackHost("aop.localhost.evil.com")).toBe(false);
    expect(isLoopbackHost("127.0.0.1.evil.com")).toBe(false);
    expect(isLoopbackHost("localhost.evil.com:25150")).toBe(false);
    expect(isLoopbackHost(undefined)).toBe(false);
    expect(isLoopbackHost("")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  test("absent origin is allowed (CLI, same-origin navigation)", () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });

  test("loopback origins are allowed on any port", () => {
    expect(isAllowedOrigin("http://localhost:25160", [])).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:9999", [])).toBe(true);
  });

  test("web origins and null origins are rejected", () => {
    expect(isAllowedOrigin("https://evil.com", [])).toBe(false);
    expect(isAllowedOrigin("null", [])).toBe(false);
  });

  test("explicit allowlist entries are allowed", () => {
    expect(isAllowedOrigin("http://dev.box:25160", ["http://dev.box:25160"])).toBe(true);
  });
});

describe("createOriginGuard", () => {
  test("allows same-origin style requests with loopback host", async () => {
    const res = await buildApp().request("http://127.0.0.1:25150/api/ping");
    expect(res.status).toBe(200);
  });

  test("allows same-origin style requests with the branded loopback host", async () => {
    const res = await buildApp().request("http://aop.localhost:25150/api/ping");
    expect(res.status).toBe(200);
  });

  test("rejects non-loopback Host header (DNS rebinding)", async () => {
    const res = await buildApp().request("http://attacker.example/api/ping");
    expect(res.status).toBe(403);
  });

  test("rejects cross-origin browser requests from web origins", async () => {
    const res = await buildApp().request("http://127.0.0.1:25150/api/ping", {
      method: "POST",
      headers: { origin: "https://evil.com" },
    });
    expect(res.status).toBe(403);
  });

  test("origin guard covers chat-session terminal-style POST path", async () => {
    const app = new Hono();
    app.use("/api/*", createOriginGuard({ allowedOrigins: [] }));
    app.post("/api/chat-sessions/:id/terminal", (c) => c.json({ lines: [] }));

    const blocked = await app.request("http://127.0.0.1:25150/api/chat-sessions/s1/terminal", {
      method: "POST",
      headers: { origin: "https://evil.com", "content-type": "application/json" },
      body: JSON.stringify({ command: "ls" }),
    });
    expect(blocked.status).toBe(403);

    const allowed = await app.request("http://127.0.0.1:25150/api/chat-sessions/s1/terminal", {
      method: "POST",
      headers: { origin: "http://localhost:25160", "content-type": "application/json" },
      body: JSON.stringify({ command: "ls" }),
    });
    expect(allowed.status).toBe(200);
  });

  test("allows the dashboard dev origin and loopback origins", async () => {
    const dev = await buildApp(["http://localhost:25160"]).request(
      "http://127.0.0.1:25150/api/ping",
      { method: "POST", headers: { origin: "http://localhost:25160" } },
    );
    expect(dev.status).toBe(200);
  });
});

describe("requireNavigationRequest", () => {
  const app = new Hono();
  app.use("/cb", requireNavigationRequest);
  app.get("/cb", (c) => c.json({ ok: true }));

  test("allows top-level navigations and non-browser clients", async () => {
    const nav = await app.request("http://127.0.0.1/cb", {
      headers: { "sec-fetch-dest": "document" },
    });
    expect(nav.status).toBe(200);
    const curl = await app.request("http://127.0.0.1/cb");
    expect(curl.status).toBe(200);
  });

  test("rejects subresource and fetch requests (img-tag CSRF)", async () => {
    const img = await app.request("http://127.0.0.1/cb", {
      headers: { "sec-fetch-dest": "image" },
    });
    expect(img.status).toBe(403);
    const xhr = await app.request("http://127.0.0.1/cb", {
      headers: { "sec-fetch-dest": "empty" },
    });
    expect(xhr.status).toBe(403);
  });
});
