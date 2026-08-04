import { describe, expect, test } from "bun:test";
import { Hono as HonoApp } from "hono";
import type { LocalServerContext } from "../context.ts";
import { createCreateTaskRoutes } from "./routes.ts";

const createApp = () => {
  const app = new HonoApp();
  app.route("/create-task", createCreateTaskRoutes({} as LocalServerContext));
  return app;
};

describe("create-task routes", () => {
  test("POST /start returns deprecated response", async () => {
    const app = createApp();
    const response = await app.request("/create-task/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: "Add scroll support", cwd: "/repo" }),
    });

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("deprecated"),
    });
  });

  test("POST /:sessionId/answer returns deprecated response", async () => {
    const app = createApp();
    const response = await app.request("/create-task/sess-1/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer: "n/a" }),
    });

    expect(response.status).toBe(410);
  });
});
