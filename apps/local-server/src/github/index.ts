/**
 * The host's GitHub data layer, shared by every GitHub view of a project (the pull requests
 * list, the issues list, a pull request's page). Everything goes through the host's own `gh`
 * session, so paired devices need no GitHub login.
 *
 * - `createGithubService(ctx, deps)`: `authStatus()`, `resolveProjectRepos(projectId)` (each
 *   attached repository and its `owner/name`, from its github.com remote), a cached
 *   `graphql(query, variables, schema, { key, ttlMs, force })`, and a conditional
 *   `restGet(path, { etag })` (a 304 is free against GitHub's rate limit).
 * - `createGithubRoutes(service)`: `GET /api/projects/:projectId/github/status`.
 * - `githubNameWithOwner(remoteUrl)`: `owner/name` of a github.com remote.
 *
 * Wire types (`GithubAuth`, `GithubProjectRepo`, `GithubUser`, `GithubLabel`) are in `@aop/common`.
 */
export { createKeyedCache, type KeyedCache } from "./cache.ts";
export type { GraphqlVariables, RestResponse } from "./gh-api.ts";
export { githubNameWithOwner } from "./remote.ts";
export { createGithubRoutes } from "./routes.ts";
export {
  createGithubService,
  type GithubService,
  type GithubServiceDeps,
  type GraphqlCache,
  type ProjectGithubRepo,
} from "./service.ts";
