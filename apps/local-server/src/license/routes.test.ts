import { beforeEach, describe, expect, test } from "bun:test";
import {
  buildSignedLicensePayload,
  generateLicenseSigningKeyPair,
  signLicenseKey,
} from "@aop/license";
import { Hono } from "hono";
import type { Kysely } from "kysely";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb, createTestRepo } from "../db/test-utils.ts";
import { createLicenseRoutes } from "./routes.ts";

// Ephemeral signing keypair: the production private key is never committed.
const TEST_KEYPAIR = generateLicenseSigningKeyPair();
process.env.AOP_LICENSE_PUBLIC_KEY = TEST_KEYPAIR.publicDerB64;
const DEV_PRIVATE_KEY_DER_B64 = TEST_KEYPAIR.privateDerB64;

describe("license routes", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: Hono;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await createTestRepo(db, "repo-1", "/tmp/aop-license-routes");
    app = new Hono();
    app.route("/api/license", createLicenseRoutes(ctx));
  });

  test("GET /status returns free tier by default", async () => {
    const response = await app.request("/api/license/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: { plan: string; maxActiveWorkers: number } };
    expect(body.status.plan).toBe("free");
    expect(body.status.maxActiveWorkers).toBe(4);
  });

  test("POST /activate accepts signed team keys", async () => {
    const licenseKey = signLicenseKey(
      buildSignedLicensePayload("team", null),
      DEV_PRIVATE_KEY_DER_B64,
    );
    const response = await app.request("/api/license/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: { plan: string; maxActiveWorkers: null } };
    expect(body.status.plan).toBe("team");
    expect(body.status.maxActiveWorkers).toBeNull();
  });
});
