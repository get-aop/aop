import { describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

const mockGetUpdateStatus = mock(async () => ({
  currentVersion: "0.1.0+commit",
  latestVersion: "0.2.2",
  updateAvailable: true,
  canAutoUpdate: true,
}));
const mockStartBinaryUpgrade = mock(async () => ({
  status: "started" as const,
  targetVersion: "0.2.2",
  message: "Upgrading",
}));

mock.module("./service.ts", () => ({
  getUpdateStatus: mockGetUpdateStatus,
  startBinaryUpgrade: mockStartBinaryUpgrade,
}));

const { createUpdateRoutes } = await import("./routes.ts");

describe("updates/routes", () => {
  test("returns update status", async () => {
    const app = new Hono().route("/api/updates", createUpdateRoutes());
    const response = await app.request("/api/updates");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      currentVersion: "0.1.0+commit",
      latestVersion: "0.2.2",
      updateAvailable: true,
      canAutoUpdate: true,
    });
  });

  test("starts install when an update is available", async () => {
    const app = new Hono().route("/api/updates", createUpdateRoutes());
    const response = await app.request("/api/updates/install", { method: "POST" });

    expect(response.status).toBe(202);
    expect(mockStartBinaryUpgrade).toHaveBeenCalledWith("0.2.2");
  });
});
