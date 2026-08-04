import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandContext } from "../../context.ts";
import { createTestDb } from "../../db/test-utils.ts";
import { SettingKey } from "../../settings/types.ts";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("GitHub App integration service", () => {
  test("stores callback installation metadata server-side", async () => {
    const { handleGitHubAppCallback, getGitHubStatus } = await import("./service.ts");
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    try {
      await ctx.settingsRepository.set(SettingKey.GITHUB_APP_ID, "1234");
      await ctx.settingsRepository.set(SettingKey.GITHUB_APP_PRIVATE_KEY, "test-private-key");

      const status = await handleGitHubAppCallback(ctx, {
        installationId: "98765",
        setupAction: "install",
        accountLogin: "get-aop",
        userLogin: "alex-demo",
      });

      expect(status).toEqual({
        configured: true,
        connected: true,
        installationId: "98765",
        accountLogin: "get-aop",
        userLogin: "alex-demo",
      });
      expect(await ctx.settingsRepository.get(SettingKey.GITHUB_APP_INSTALLATION_ID)).toBe("98765");
      expect(await ctx.settingsRepository.get(SettingKey.GITHUB_APP_ACCOUNT_LOGIN)).toBe("get-aop");
      expect(await getGitHubStatus(ctx)).toEqual(status);
    } finally {
      await db.destroy();
    }
  });

  test("rejects callbacks without an installation id", async () => {
    const { handleGitHubAppCallback } = await import("./service.ts");
    const db = await createTestDb();
    const ctx = createCommandContext(db);

    try {
      await expect(handleGitHubAppCallback(ctx, { setupAction: "install" })).rejects.toThrow(
        "Missing GitHub installation id",
      );
    } finally {
      await db.destroy();
    }
  });

  test("syncs assigned PR summaries from deterministic fixtures", async () => {
    const { syncAssignedPullRequests } = await import("./service.ts");
    const db = await createTestDb();
    const ctx = createCommandContext(db);
    const tempDir = await mkdtemp(join(tmpdir(), "aop-github-fixtures-"));
    tempDirs.push(tempDir);
    const fixturesPath = join(tempDir, "github-prs.json");
    await writeFile(
      fixturesPath,
      JSON.stringify({
        assignedPullRequests: [
          {
            id: "pr_55",
            repo: "get-aop/aop-mono",
            number: 55,
            title: "Fix demo rehearsal",
            state: "open",
            url: "https://github.com/get-aop/aop-mono/pull/55",
            author: "alex-demo",
            assignees: ["alex-demo"],
            reviewContext: "Review requested from Alex Demo",
            updatedAt: "2026-05-15T21:00:00.000Z",
          },
          {
            id: "pr_56",
            repo: "get-aop/aop-mono",
            number: 56,
            title: "Other assignee",
            state: "open",
            url: "https://github.com/get-aop/aop-mono/pull/56",
            author: "teammate",
            assignees: ["teammate"],
            reviewContext: "Assigned to teammate",
            updatedAt: "2026-05-15T21:01:00.000Z",
          },
        ],
      }),
    );

    const previousMode = process.env.AOP_TEST_MODE;
    const previousFixtures = process.env.AOP_TEST_GITHUB_FIXTURES_PATH;
    process.env.AOP_TEST_MODE = "true";
    process.env.AOP_TEST_GITHUB_FIXTURES_PATH = fixturesPath;

    try {
      await ctx.settingsRepository.set(SettingKey.GITHUB_APP_USER_LOGIN, "alex-demo");

      const prs = await syncAssignedPullRequests(ctx, {});

      expect(prs).toEqual([
        {
          id: "pr_55",
          repo: "get-aop/aop-mono",
          number: 55,
          title: "Fix demo rehearsal",
          state: "open",
          url: "https://github.com/get-aop/aop-mono/pull/55",
          author: "alex-demo",
          reviewContext: "Review requested from Alex Demo",
          updatedAt: "2026-05-15T21:00:00.000Z",
        },
      ]);
    } finally {
      if (previousMode === undefined) delete process.env.AOP_TEST_MODE;
      else process.env.AOP_TEST_MODE = previousMode;
      if (previousFixtures === undefined) delete process.env.AOP_TEST_GITHUB_FIXTURES_PATH;
      else process.env.AOP_TEST_GITHUB_FIXTURES_PATH = previousFixtures;
      await db.destroy();
    }
  });
});
