import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { z } from "zod";
import { createCommandContext, type LocalServerContext } from "../context.ts";
import type { Database } from "../db/schema.ts";
import { createTestDb } from "../db/test-utils.ts";
import { projectSettings } from "../project/test-utils.ts";
import { createGithubService } from "./service.ts";
import { fail, gitWithRemotes, ok, scriptedCommand } from "./test-utils.ts";

describe("the GitHub service", () => {
  let db: Kysely<Database>;
  let ctx: LocalServerContext;
  let scratch: string;

  beforeEach(async () => {
    db = await createTestDb();
    ctx = createCommandContext(db);
    scratch = mkdtempSync(join(tmpdir(), "github-service-"));
  });

  afterEach(async () => {
    await db.destroy();
    rmSync(scratch, { recursive: true, force: true });
  });

  const addRepo = async (id: string, name: string) => {
    const path = join(scratch, name);
    await ctx.repoRepository.create({ id, path, name, remote_origin: null });
    return path;
  };

  const addProject = (repoIds: string[]) =>
    ctx.projectRepository.create({ id: "proj_1", ...projectSettings({ repoIds }) });

  describe("authStatus", () => {
    test("a signed-in gh answers its login, and is asked once a minute", async () => {
      let at = 0;
      const gh = scriptedCommand(() => ok("ada\n"));
      const github = createGithubService(ctx, { runGh: gh.run, now: () => at });

      expect(await github.authStatus()).toEqual({ authenticated: true, login: "ada" });
      at += 59_000;
      await github.authStatus();
      expect(gh.calls).toEqual([["api", "user", "--jq", ".login"]]);
      await github.authStatus({ fresh: true });
      expect(gh.calls).toHaveLength(2);
    });

    test("a signed-out gh is told apart from a missing one, and asked again sooner", async () => {
      let at = 0;
      const gh = scriptedCommand(() =>
        fail("To get started with GitHub CLI, please run:  gh auth login"),
      );
      const github = createGithubService(ctx, { runGh: gh.run, now: () => at });

      expect(await github.authStatus()).toMatchObject({
        authenticated: false,
        reason: "signed-out",
      });
      at += 10_000;
      await github.authStatus();
      expect(gh.calls).toHaveLength(2);

      const missing = createGithubService(ctx, {
        runGh: async () => {
          throw new Error('Executable not found in $PATH: "gh"');
        },
      });
      expect(await missing.authStatus()).toMatchObject({
        authenticated: false,
        reason: "gh-missing",
      });
    });

    test("a network failure is unreachable, not signed out", async () => {
      const gh = scriptedCommand(() => fail("error connecting to api.github.com"));
      const github = createGithubService(ctx, { runGh: gh.run });

      expect(await github.authStatus()).toMatchObject({ reason: "unreachable" });
    });
  });

  describe("resolveProjectRepos", () => {
    test("reads each attached repository's owner/name from its remote", async () => {
      const shop = await addRepo("repo_shop", "shop");
      const docs = await addRepo("repo_docs", "docs");
      const local = await addRepo("repo_local", "local");
      const project = await addProject(["repo_shop", "repo_docs", "repo_local"]);
      const git = gitWithRemotes({
        [shop]: "git@github.com:acme/shop.git",
        [docs]: "https://github.com/acme/docs",
        [local]: "/srv/git/local.git",
      });
      const github = createGithubService(ctx, { runGit: git.run, runGh: async () => ok("ada") });

      expect(await github.resolveProjectRepos(project.id)).toEqual([
        { repoId: "repo_shop", name: "shop", nameWithOwner: "acme/shop", path: shop },
        { repoId: "repo_docs", name: "docs", nameWithOwner: "acme/docs", path: docs },
        { repoId: "repo_local", name: "local", nameWithOwner: null, path: local },
      ]);
      expect(await github.status(project.id)).toEqual({
        auth: { authenticated: true, login: "ada" },
        repos: [
          { repoId: "repo_shop", name: "shop", nameWithOwner: "acme/shop" },
          { repoId: "repo_docs", name: "docs", nameWithOwner: "acme/docs" },
          { repoId: "repo_local", name: "local", nameWithOwner: null },
        ],
      });
    });

    test("falls back to another github.com remote, and caches what it read", async () => {
      const path = await addRepo("repo_fork", "fork");
      const project = await addProject(["repo_fork"]);
      const git = scriptedCommand((args) =>
        args[1] === "-v"
          ? ok("mirror\t/srv/x.git (fetch)\nupstream\thttps://github.com/acme/fork.git (fetch)\n")
          : fail("error: No such remote 'origin'", 2),
      );
      const github = createGithubService(ctx, { runGit: git.run });

      const [first] = (await github.resolveProjectRepos(project.id)) ?? [];
      await github.resolveProjectRepos(project.id);

      expect(first).toMatchObject({ path, nameWithOwner: "acme/fork" });
      expect(git.calls).toHaveLength(2);
    });

    test("is null for a project that does not exist", async () => {
      const github = createGithubService(ctx, { runGit: gitWithRemotes({}).run });

      expect(await github.resolveProjectRepos("project_missing")).toBeNull();
      expect(await github.status("project_missing")).toBeNull();
    });
  });

  describe("graphql", () => {
    const Data = z.object({ n: z.number() });

    test("caches a good answer under its key, and not a failed one", async () => {
      let n = 0;
      let failing = true;
      const gh = scriptedCommand(() =>
        failing ? fail("HTTP 502") : ok(JSON.stringify({ data: { n: ++n } })),
      );
      const github = createGithubService(ctx, { runGh: gh.run });
      const read = (force = false) =>
        github.graphql("q", {}, Data, { key: "k", ttlMs: 60_000, force });

      expect((await read()).ok).toBe(false);
      failing = false;
      expect(await read()).toEqual({ ok: true, value: { n: 1 } });
      expect(await read()).toEqual({ ok: true, value: { n: 1 } });
      expect(await read(true)).toEqual({ ok: true, value: { n: 2 } });
      expect(gh.calls).toHaveLength(3);
    });
  });
});
