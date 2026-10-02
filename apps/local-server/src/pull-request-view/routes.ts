import { createHash } from "node:crypto";
import {
  PullRequestCommentBodySchema,
  PullRequestMergeBodySchema,
  PullRequestReviewBodySchema,
  PullRequestUpdateBodySchema,
} from "@aop/common";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { AuthEnv } from "../auth/api-auth.ts";
import { readBody } from "../project/http.ts";
import type {
  PullRequestAddress,
  PullRequestViewError,
  PullRequestViewResult,
  PullRequestViewService,
} from "./service.ts";

const PULL = "/:projectId/github/repos/:repoId/pulls/:number{[1-9][0-9]*}";

/**
 * Mounted at /api/projects: one pull request's page, read by any paired device and acted on by
 * the host owner only (`auth/route-policy.ts` closes the writes to devices; the service checks
 * again). Reads carry an ETag of what they hold, so a client polling an unchanged page gets a 304.
 */
export const createPullRequestViewRoutes = (service: PullRequestViewService) => {
  const routes = new Hono<AuthEnv>();

  routes.get(PULL, async (c) => {
    const result = await service.detail(addressOf(c), c.get("principal"), {
      refresh: c.req.query("refresh") === "1",
    });
    return answer(c, result);
  });

  routes.get(`${PULL}/checks`, async (c) => answer(c, await service.checks(addressOf(c))));
  routes.get(`${PULL}/files`, async (c) => answer(c, await service.files(addressOf(c))));

  routes.post(`${PULL}/comments`, async (c) => {
    const parsed = await readBody(c, PullRequestCommentBodySchema);
    if ("response" in parsed) return parsed.response;
    return done(c, await service.comment(addressOf(c), c.get("principal"), parsed.body));
  });

  routes.post(`${PULL}/reviews`, async (c) => {
    const parsed = await readBody(c, PullRequestReviewBodySchema);
    if ("response" in parsed) return parsed.response;
    return done(c, await service.review(addressOf(c), c.get("principal"), parsed.body));
  });

  routes.post(`${PULL}/merge`, async (c) => {
    const parsed = await readBody(c, PullRequestMergeBodySchema);
    if ("response" in parsed) return parsed.response;
    return done(c, await service.merge(addressOf(c), c.get("principal"), parsed.body));
  });

  routes.patch(PULL, async (c) => {
    const parsed = await readBody(c, PullRequestUpdateBodySchema);
    if ("response" in parsed) return parsed.response;
    return done(c, await service.update(addressOf(c), c.get("principal"), parsed.body));
  });

  return routes;
};

const NumberSchema = z.coerce.number().int().positive();

const addressOf = (c: Context): PullRequestAddress => ({
  projectId: c.req.param("projectId") ?? "",
  repoId: c.req.param("repoId") ?? "",
  number: NumberSchema.parse(c.req.param("number")),
});

/** A read: 304 when the client already holds this answer, else the answer and its ETag. */
const answer = <T extends object>(c: Context, result: PullRequestViewResult<T>) => {
  if (!result.ok) return errorOf(c, result.error);
  const etag = etagOf(result.value);
  c.header("ETag", etag);
  c.header("Cache-Control", "no-cache");
  if (c.req.header("If-None-Match") === etag) return c.body(null, 304);
  return c.json(result.value);
};

const done = (c: Context, result: PullRequestViewResult<null>) =>
  result.ok ? c.json({ ok: true }) : errorOf(c, result.error);

// When the host read it is not part of what it says: an unchanged page keeps its ETag.
const etagOf = (value: object): string => {
  const { fetchedAt: _when, ...content } = value as { fetchedAt?: string };
  return `"${createHash("sha256").update(JSON.stringify(content)).digest("base64url").slice(0, 27)}"`;
};

const STATUS: Record<PullRequestViewError["code"], 403 | 404 | 409 | 422 | 429 | 502 | 503> = {
  GITHUB_REFUSED: 422,
  PROJECT_NOT_FOUND: 404,
  REPO_NOT_IN_PROJECT: 404,
  PULL_REQUEST_NOT_FOUND: 404,
  NO_GITHUB_REMOTE: 409,
  GITHUB_NOT_CONNECTED: 503,
  GITHUB_RATE_LIMITED: 429,
  GITHUB_FAILED: 502,
  READ_ONLY: 403,
};

const errorOf = (c: Context, error: PullRequestViewError) =>
  c.json({ error: describe(error), code: error.code }, STATUS[error.code]);

export const describe = (error: PullRequestViewError): string => {
  switch (error.code) {
    case "PROJECT_NOT_FOUND":
      return "Project not found";
    case "REPO_NOT_IN_PROJECT":
      return `Repository ${error.repoId} is not one of this project's repositories`;
    case "NO_GITHUB_REMOTE":
      return `${error.name} has no GitHub remote, so it has no pull requests to show`;
    case "GITHUB_NOT_CONNECTED":
      return error.reason === "gh-missing"
        ? "The GitHub CLI (gh) is not installed on the host"
        : `The host is not signed in to GitHub: ${error.message}`;
    case "PULL_REQUEST_NOT_FOUND":
      return `${error.nameWithOwner} has no pull request #${error.number}`;
    case "GITHUB_RATE_LIMITED":
      return `GitHub is rate limiting the host's account; try again in a few minutes (${error.message})`;
    case "GITHUB_REFUSED":
      return `GitHub refused: ${error.message}`;
    case "GITHUB_FAILED":
    case "READ_ONLY":
      return error.message;
  }
};
