import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createOriginGuard } from "./origin-guard.ts";

const buildApp = (allowedOrigins: string[] = []) => {
  const app = new Hono();
  app.use("/api/*", createOriginGuard({ allowedOrigins }));
  app.get("/api/ping", (c) => c.json({ ok: true }));
  app.post("/api/ping", (c) => c.json({ ok: true }));
  return app;
};

const post = (app: Hono, url: string, headers: Record<string, string>) =>
  app.request(url, { method: "POST", headers });

describe("createOriginGuard", () => {
  test("lets through requests that name no origin (CLI, curl, same-origin GET)", async () => {
    const res = await buildApp().request("http://127.0.0.1:25150/api/ping");
    expect(res.status).toBe(200);
  });

  test("allows a page on the API's own origin", async () => {
    const res = await post(buildApp(), "http://127.0.0.1:25150/api/ping", {
      origin: "http://127.0.0.1:25150",
    });
    expect(res.status).toBe(200);
  });

  test("allows a page on the API's own origin behind TLS, where the scheme differs", async () => {
    const res = await post(buildApp(), "http://mac.tail1234.ts.net/api/ping", {
      origin: "https://mac.tail1234.ts.net",
    });
    expect(res.status).toBe(200);
  });

  test("compares against the host a proxy forwarded when it rewrote Host", async () => {
    const res = await post(buildApp(), "http://127.0.0.1:25150/api/ping", {
      origin: "https://mac.tail1234.ts.net",
      "x-forwarded-host": "mac.tail1234.ts.net",
    });
    expect(res.status).toBe(200);
  });

  test("rejects a page on another site", async () => {
    const res = await post(buildApp(), "http://127.0.0.1:25150/api/ping", {
      origin: "https://evil.com",
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden: cross-origin requests are not allowed" });
  });

  test("rejects a page on another loopback port, which used to pass", async () => {
    const res = await post(buildApp(), "http://127.0.0.1:25150/api/ping", {
      origin: "http://localhost:9999",
    });
    expect(res.status).toBe(403);
  });

  test("rejects a page that borrows a host suffix", async () => {
    const res = await post(buildApp(), "http://mac.tail1234.ts.net/api/ping", {
      origin: "https://mac.tail1234.ts.net.evil.com",
    });
    expect(res.status).toBe(403);
  });

  test("rejects opaque and malformed origins", async () => {
    for (const origin of ["null", "not a url"]) {
      const res = await post(buildApp(), "http://127.0.0.1:25150/api/ping", { origin });
      expect(res.status).toBe(403);
    }
  });

  test("allows an origin the operator listed, such as the dev dashboard", async () => {
    const app = buildApp(["http://127.0.0.1:25160"]);

    const listed = await post(app, "http://127.0.0.1:25150/api/ping", {
      origin: "http://127.0.0.1:25160",
    });
    const unlisted = await post(app, "http://127.0.0.1:25150/api/ping", {
      origin: "http://127.0.0.1:25161",
    });

    expect(listed.status).toBe(200);
    expect(unlisted.status).toBe(403);
  });
});
