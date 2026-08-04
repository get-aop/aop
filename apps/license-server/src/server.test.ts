import { afterEach, describe, expect, test } from "bun:test";
import server from "./server.ts";

describe("license-server", () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.LEMON_SQUEEZY_API_KEY;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.LEMON_SQUEEZY_API_KEY;
    } else {
      process.env.LEMON_SQUEEZY_API_KEY = originalApiKey;
    }
  });

  test("GET /health returns ok", async () => {
    const response = await server.fetch(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("POST /v1/validate requires licenseKey and machineId", async () => {
    const response = await server.fetch(
      new Request("http://localhost/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ licenseKey: "" }),
      }),
    );
    expect(response.status).toBe(400);
  });

  test("POST /v1/validate proxies Lemon Squeezy when configured", async () => {
    process.env.LEMON_SQUEEZY_API_KEY = "test-api-key";
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (!url.includes("lemonsqueezy.com/v1/licenses/validate")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      return Response.json({
        activated: true,
        license_key: {
          id: 1,
          status: "active",
          key: "LS-TEST",
          activation_limit: 2,
          activation_usage: 1,
          expires_at: null,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        instance: { id: "inst-42", name: "machine-a", created_at: "2026-01-01T00:00:00.000Z" },
        meta: {
          store_id: 1,
          order_id: 1,
          order_item_id: 1,
          variant_id: 1,
          variant_name: "Pro Monthly",
          product_id: 1,
          product_name: "Pro",
        },
      });
    }) as typeof fetch;

    const response = await server.fetch(
      new Request("http://localhost/v1/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseKey: "LS-TEST",
          machineId: "machine-a",
          lemonInstanceId: "inst-42",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      entitlement: { plan: string; maxActiveWorkers: number };
      lemonInstanceId?: string;
    };
    expect(body.entitlement.plan).toBe("pro");
    expect(body.entitlement.maxActiveWorkers).toBe(8);
    expect(body.lemonInstanceId).toBe("inst-42");
  });
});
