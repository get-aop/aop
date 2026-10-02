import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PairedDeviceSchema, PullRequestListResponseSchema } from "@aop/common";
import type { Kysely } from "kysely";
import { createApp } from "../app.ts";
import { LOOPBACK_PEER, REMOTE_PEER } from "../auth/test-utils.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { type AnyJson, createTestDb } from "../db/test-utils.ts";
import { createGithubService } from "../github/service.ts";
import { gitWithRemotes } from "../github/test-utils.ts";
import { projectSettings } from "../project/test-utils.ts";
import { createFakeGithub, makeNode } from "./test-utils.ts";

describe("the pull request list on the host's API", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    await ctx.repoRepository.create({ id: "repo_a", path: "/r/a", name: "a", remote_origin: null });
    await ctx.projectRepository.create({
      id: "proj_1",
      ...projectSettings({ repoIds: ["repo_a"] }),
    });
    const fake = createFakeGithub();
    fake.setPulls("acme/a", [makeNode({ url: "https://github.com/acme/a/pull/1" })]);
    const github = createGithubService(ctx, {
      runGh: fake.run,
      runGit: gitWithRemotes({ "/r/a": "https://github.com/acme/a.git" }).run,
    });
    app = createApp({ ctx, startTimeMs: Date.now(), github });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const remote = (path: string, init: RequestInit = {}) =>
    app.request(`https://mac.tail1234.ts.net${path}`, init, REMOTE_PEER);

  test("a paired device reads it through the host's gh; an unpaired one cannot", async () => {
    expect((await remote("/api/projects/proj_1/github/pulls")).status).toBe(401);

    const code = (
      (await (
        await app.request(
          "http://127.0.0.1:25150/api/auth/pairing-codes",
          { method: "POST" },
          LOOPBACK_PEER,
        )
      ).json()) as AnyJson
    ).code;
    const paired = await remote("/api/auth/pair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, name: "Phone" }),
    });
    const token = PairedDeviceSchema.parse(await paired.json()).token;

    const res = await remote("/api/projects/proj_1/github/pulls", {
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const list = PullRequestListResponseSchema.parse(await res.json());
    expect(list.status === "ready" && list.items.map((item) => item.repo)).toEqual(["acme/a"]);
  });
});
