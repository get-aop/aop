import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AgentClisResponseSchema, PairedDeviceSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createAgentCliService } from "../agent-cli/service.ts";
import { fakeRuns, nativeProbe, testCli } from "../agent-cli/test-utils.ts";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";

const KEY = "agent_cli_skip_permissions";

describe("the skip-permission-checks setting over the API", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;

  const local = (path: string, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:25150${path}`, init, LOOPBACK_PEER);
  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);
  const put = (body: unknown, authorization?: string): RequestInit => ({
    method: "PUT",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: JSON.stringify(body),
  });

  const pairDevice = async (): Promise<string> => {
    const issued = await local("/api/auth/pairing-codes", { method: "POST" });
    const { code } = (await issued.json()) as { code: string };
    const paired = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Phone" }),
    });
    return `Bearer ${PairedDeviceSchema.parse(await paired.json()).token}`;
  };

  const panelState = async (read: Response | Promise<Response>) =>
    AgentClisResponseSchema.parse(await (await read).json()).skipPermissions;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    const agentClis = createAgentCliService({
      settings: ctx.settingsRepository,
      runs: fakeRuns(),
      definitions: [testCli()],
      probe: async () => nativeProbe("2.1.287"),
      identity: { uid: 501, env: () => ({}) },
    });
    app = createApp({ ctx, startTimeMs: Date.now(), agentClis });
  });

  afterEach(async () => {
    await db.destroy();
  });

  test("is off on a new host, for the owner and for a paired device", async () => {
    const authorization = await pairDevice();

    expect(await (await local(`/api/settings/${KEY}`)).json()).toEqual({
      key: KEY,
      value: "false",
    });
    expect(await panelState(local("/api/agent-clis"))).toEqual({
      enabled: false,
      blockedReason: null,
    });
    expect(await panelState(remote("/api/agent-clis", { headers: { authorization } }))).toEqual({
      enabled: false,
      blockedReason: null,
    });
  });

  test("the owner turns it on, and the panel says so", async () => {
    const res = await local(`/api/settings/${KEY}`, put({ value: "true" }));

    expect(res.status).toBe(200);
    expect(await ctx.settingsRepository.get(KEY)).toBe("true");
    expect((await panelState(local("/api/agent-clis"))).enabled).toBe(true);
  });

  test("a paired device sees it but cannot change it, by its own route or in a bulk write", async () => {
    const authorization = await pairDevice();
    await local(`/api/settings/${KEY}`, put({ value: "true" }));

    const single = await remote(`/api/settings/${KEY}`, put({ value: "false" }, authorization));
    const slash = await remote(`/api/settings/${KEY}/`, put({ value: "false" }, authorization));
    const encoded = await remote(
      "/api/settings/agent%5Fcli%5Fskip%5Fpermissions",
      put({ value: "false" }, authorization),
    );
    const bulk = await remote(
      "/api/settings",
      put(
        {
          settings: [
            { key: "display_name", value: "Phone" },
            { key: KEY, value: "false" },
          ],
        },
        authorization,
      ),
    );

    for (const res of [single, slash, encoded, bulk]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "Only available on the host machine",
        code: "HOST_ONLY",
      });
    }
    expect(await ctx.settingsRepository.get(KEY)).toBe("true");
    // The refused bulk write saved none of its keys.
    expect(await ctx.settingsRepository.get("display_name")).toBe("");

    const read = await remote(`/api/settings/${KEY}`, { headers: { authorization } });
    expect(await read.json()).toEqual({ key: KEY, value: "true" });
    expect(
      (await panelState(remote("/api/agent-clis", { headers: { authorization } }))).enabled,
    ).toBe(true);
  });

  test("a paired device still saves the settings that are its to change", async () => {
    const authorization = await pairDevice();

    const res = await remote(
      "/api/settings",
      put({ settings: [{ key: "display_name", value: "Phone" }] }, authorization),
    );

    expect(res.status).toBe(200);
    expect(await ctx.settingsRepository.get("display_name")).toBe("Phone");
  });

  test("the owner may write it in a bulk write too", async () => {
    const res = await local("/api/settings", put({ settings: [{ key: KEY, value: "true" }] }));

    expect(res.status).toBe(200);
    expect(await ctx.settingsRepository.get(KEY)).toBe("true");
  });
});
