import { Hono } from "hono";
import { getUpdateStatus, startBinaryUpgrade } from "./service.ts";

export const createUpdateRoutes = () => {
  const app = new Hono();

  app.get("/", async (c) => c.json(await getUpdateStatus()));

  app.post("/install", async (c) => {
    const status = await getUpdateStatus();
    if (!status.updateAvailable || !status.latestVersion) {
      return c.json({ error: "No update is available" }, 409);
    }

    try {
      const result = await startBinaryUpgrade(status.latestVersion);
      return c.json(result, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to start upgrade";
      return c.json({ error: message }, 400);
    }
  });

  return app;
};
