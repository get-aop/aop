import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Kysely } from "kysely";
import { createLoopbackApp } from "../auth/test-utils.ts";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { projectSettings } from "../project/test-utils.ts";
import { createGithubService } from "./service.ts";
import { fail, gitWithRemotes, ok, scriptedCommand } from "./test-utils.ts";

describe("GET /api/projects/:projectId/github/status", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let signedIn: boolean;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    signedIn = true;
    await ctx.repoRepository.create({ id: "repo_a", path: "/r/a", name: "a", remote_origin: null });
    await ctx.projectRepository.create({
      id: "proj_1",
      ...projectSettings({ repoIds: ["repo_a"] }),
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  const appWith = () => {
    const gh = scriptedCommand(() => (signedIn ? ok("ada\n") : fail("run gh auth login")));
    const github = createGithubService(ctx, {
      runGh: gh.run,
      runGit: gitWithRemotes({ "/r/a": "https://github.com/acme/a.git" }).run,
    });
    return { app: createLoopbackApp({ ctx, startTimeMs: Date.now(), github }), gh };
  };

  test("answers the host's GitHub login and the project's repositories", async () => {
    const { app } = appWith();

    const res = await app.request("/api/projects/proj_1/github/status");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      auth: { authenticated: true, login: "ada" },
      repos: [{ repoId: "repo_a", name: "a", nameWithOwner: "acme/a" }],
    });
  });

  test("?fresh=1 asks gh again, so a sign-out shows at once", async () => {
    const { app, gh } = appWith();
    await app.request("/api/projects/proj_1/github/status");
    signedIn = false;

    const res = await app.request("/api/projects/proj_1/github/status?fresh=1");

    expect(((await res.json()) as { auth: unknown }).auth).toMatchObject({
      authenticated: false,
      reason: "signed-out",
    });
    expect(gh.calls).toHaveLength(2);
  });

  test("404 for a project that does not exist", async () => {
    const { app } = appWith();

    const res = await app.request("/api/projects/missing/github/status");

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
