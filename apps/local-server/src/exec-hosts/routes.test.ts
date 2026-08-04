import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createExecHostRoutes } from "./routes.ts";

describe("exec-host routes", () => {
  let db: Kysely<Database>;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    app = new Hono();
    app.route("/api/exec-hosts", createExecHostRoutes(createCommandContext(db)));
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("lists empty hosts by default", async () => {
    const response = await app.request("/api/exec-hosts");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hosts: [] });
  });

  test("saves and lists hosts, assigning ids when missing", async () => {
    const put = await app.request("/api/exec-hosts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          name: "Desktop",
          host: "192.168.1.10",
          remoteRoot: "/tmp/aop",
        },
      ]),
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as AnyJson;
    expect(body.hosts).toHaveLength(1);
    expect(body.hosts[0]).toMatchObject({
      name: "Desktop",
      host: "192.168.1.10",
      remoteRoot: "/tmp/aop",
    });
    expect(typeof body.hosts[0].id).toBe("string");
    expect(body.hosts[0].id.length).toBeGreaterThan(0);

    const list = await app.request("/api/exec-hosts");
    expect(((await list.json()) as AnyJson).hosts).toHaveLength(1);
  });

  test("rejects invalid host payloads", async () => {
    const put = await app.request("/api/exec-hosts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ name: "NoHost" }]),
    });
    expect(put.status).toBe(400);
  });

  test("returns 404 when testing an unknown host", async () => {
    const response = await app.request("/api/exec-hosts/missing/test", { method: "POST" });
    expect(response.status).toBe(404);
  });
});
