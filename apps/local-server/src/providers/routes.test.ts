import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createProviderRoutes } from "./routes.ts";

describe("provider routes", () => {
  test("serves the capability matrix from the loader it is given", async () => {
    const app = new Hono().route("/api", createProviderRoutes({ getCapabilities: async () => [] }));

    const response = await app.request("/api/providers/capabilities");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ providers: [] });
  });

  test("has no route that updates the runtime CLIs", async () => {
    const app = new Hono().route("/api", createProviderRoutes({ getCapabilities: async () => [] }));

    expect((await app.request("/api/providers/update-all", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/providers/update-status")).status).toBe(404);
  });
});
