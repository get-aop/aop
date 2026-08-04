import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { ProviderUpdateService } from "./provider-updates.ts";
import { createProviderRoutes } from "./routes.ts";

describe("provider routes", () => {
  test("starts all CLI updates without waiting for the background work", async () => {
    let starts = 0;
    const app = new Hono().route(
      "/api",
      createProviderRoutes({
        getCapabilities: async () => [],
        updater: {
          getStates: () => {
            throw new Error("not used");
          },
          startAll: async () => {
            starts += 1;
            return { accepted: true };
          },
          waitForIdle: async () => {},
        },
      }),
    );

    const response = await app.request("/api/providers/update-all", { method: "POST" });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(starts).toBe(1);
  });

  test("returns updater state without re-running provider doctor probes", async () => {
    let capabilityLoads = 0;
    const idle = { status: "idle", startedAt: null, finishedAt: null, message: null } as const;
    const states = {
      "claude-code": {
        status: "running",
        startedAt: "2026-07-30T12:00:00.000Z",
        finishedAt: null,
        message: null,
      },
      "codex-cli": idle,
      "grok-build": idle,
      opencode: idle,
      pi: idle,
    } satisfies ReturnType<ProviderUpdateService["getStates"]>;
    const app = new Hono().route(
      "/api",
      createProviderRoutes({
        getCapabilities: async () => {
          capabilityLoads += 1;
          return [];
        },
        updater: {
          getStates: () => states,
          startAll: async () => ({ accepted: true }),
          waitForIdle: async () => {},
        },
      }),
    );

    const response = await app.request("/api/providers/update-status");

    expect(response.status).toBe(200);
    expect(capabilityLoads).toBe(0);
    expect(await response.json()).toMatchObject({
      states: { "claude-code": { status: "running" } },
    });
  });
});
