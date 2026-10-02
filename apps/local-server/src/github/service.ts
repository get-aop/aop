import { homedir } from "node:os";
import type { GithubAuth, GithubProjectRepo, GithubStatusResponse } from "@aop/common";
import type { z } from "zod";
import { defaultGhRunner, defaultGitRunner, type RunCommand } from "../command-runner.ts";
import type { LocalServerContext } from "../context.ts";
import { attemptGh, type GhRead } from "../github-cli/read.ts";
import type { RunGh } from "../github-cli/run-gh.ts";
import { extractRepoName } from "../repo/repository.ts";
import { createKeyedCache } from "./cache.ts";
import { type GraphqlVariables, graphqlQuery, type RestResponse, restGet } from "./gh-api.ts";
import { githubNameWithOwner } from "./remote.ts";

/** A project's repository with where it is on disk, for host code that runs `gh` in it. */
export type ProjectGithubRepo = GithubProjectRepo & { path: string };

/** How a cached GraphQL read is keyed and how long it answers for. */
export interface GraphqlCache {
  /** Unique per query and variables; reads with the same key share one answer. */
  key: string;
  ttlMs: number;
  /** Skip a fresh cached answer (a person's Refresh). */
  force?: boolean;
}

/**
 * The host's GitHub access, shared by every GitHub view of a project. Reads go through the
 * host's own `gh` session, so a paired device needs no GitHub login of its own.
 */
export interface GithubService {
  /** Whether `gh` is signed in, and as whom. Cached for a minute (`fresh` asks again). */
  authStatus: (options?: { fresh?: boolean }) => Promise<GithubAuth>;
  /** The project's repositories and their `owner/name` on GitHub, or null for no such project. */
  resolveProjectRepos: (projectId: string) => Promise<ProjectGithubRepo[] | null>;
  /** The auth state and the repositories, as `GET .../github/status` answers. */
  status: (projectId: string) => Promise<GithubStatusResponse | null>;
  /** A GraphQL read, cached under `cache.key`; a failed read is not cached. */
  graphql: <T>(
    query: string,
    variables: GraphqlVariables,
    schema: z.ZodType<T>,
    cache: GraphqlCache,
  ) => Promise<GhRead<T>>;
  /** A REST `GET`, conditional on `etag` (a 304 is free against the rate limit). Never cached. */
  restGet: (path: string, options?: { etag?: string | null }) => Promise<GhRead<RestResponse>>;
}

export interface GithubServiceDeps {
  runGh?: RunGh;
  runGit?: RunCommand;
  now?: () => number;
}

const AUTH_TTL_MS = 60_000;
const AUTH_FAILURE_TTL_MS = 10_000;
const REMOTE_TTL_MS = 5 * 60_000;
const SIGNED_OUT = /auth login|not logged|authentication|bad credentials|HTTP 401|GH_TOKEN/i;
const MISSING = /ENOENT|not found|no such file/i;

export const createGithubService = (
  ctx: Pick<LocalServerContext, "projectRepository" | "repoRepository">,
  { runGh = defaultGhRunner, runGit = defaultGitRunner, now = Date.now }: GithubServiceDeps = {},
): GithubService => {
  const cache = createKeyedCache(now);
  // `gh api` needs no checkout; any directory that exists will do.
  const cwd = homedir();

  const authStatus: GithubService["authStatus"] = ({ fresh = false } = {}) =>
    // Signed out is asked again sooner, so a `gh auth login` shows within seconds.
    cache.get("auth", () => readAuth(runGh, cwd), {
      ttlMs: (auth) => (auth.authenticated ? AUTH_TTL_MS : AUTH_FAILURE_TTL_MS),
      force: fresh,
    });

  const remoteOf = (path: string): Promise<string | null> =>
    cache.get(`remote:${path}`, () => readGithubRemote(runGit, path), { ttlMs: REMOTE_TTL_MS });

  const resolveProjectRepos: GithubService["resolveProjectRepos"] = async (projectId) => {
    const project = await ctx.projectRepository.getById(projectId);
    if (!project) return null;
    const repos = await Promise.all(
      project.repoIds.map((repoId) => ctx.repoRepository.getById(repoId)),
    );
    return Promise.all(
      repos.flatMap((repo) =>
        repo
          ? [
              remoteOf(repo.path).then((nameWithOwner) => ({
                repoId: repo.id,
                name: extractRepoName(repo.path),
                nameWithOwner,
                path: repo.path,
              })),
            ]
          : [],
      ),
    );
  };

  return {
    authStatus,
    resolveProjectRepos,
    status: async (projectId) => {
      const repos = await resolveProjectRepos(projectId);
      if (!repos) return null;
      return {
        auth: await authStatus(),
        repos: repos.map(({ repoId, name, nameWithOwner }) => ({ repoId, name, nameWithOwner })),
      };
    },
    graphql: (query, variables, schema, { key, ttlMs, force }) =>
      cache.get(`graphql:${key}`, () => graphqlQuery(runGh, cwd, query, variables, schema), {
        ttlMs,
        force,
        keep: (read) => read.ok,
      }),
    restGet: (path, options) => restGet(runGh, cwd, path, options),
  };
};

const readAuth = async (runGh: RunGh, cwd: string): Promise<GithubAuth> => {
  const run = await attemptGh(runGh, ["api", "user", "--jq", ".login"], cwd);
  if (!run.ran) {
    return {
      authenticated: false,
      reason: MISSING.test(run.message) ? "gh-missing" : "unreachable",
      message: run.message,
    };
  }
  const login = run.result.stdout.trim();
  if (run.result.exitCode === 0 && login) return { authenticated: true, login };
  const message =
    run.result.stderr.trim() || run.result.stdout.trim() || "gh could not reach GitHub";
  return {
    authenticated: false,
    reason: SIGNED_OUT.test(message) ? "signed-out" : "unreachable",
    message,
  };
};

/** `owner/name` of the checkout's `origin`, else of its first github.com remote. */
const readGithubRemote = async (runGit: RunCommand, path: string): Promise<string | null> => {
  try {
    const origin = await runGit(["remote", "get-url", "origin"], path);
    const fromOrigin = origin.exitCode === 0 ? githubNameWithOwner(origin.stdout) : null;
    if (fromOrigin) return fromOrigin;
    const all = await runGit(["remote", "-v"], path);
    if (all.exitCode !== 0) return null;
    for (const line of all.stdout.split("\n")) {
      const found = githubNameWithOwner(line.split(/\s+/)[1] ?? "");
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
};
