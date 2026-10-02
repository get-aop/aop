import { z } from "zod";
import { IdSchema } from "./primitives.ts";

/*
 * What the host says about its GitHub access and a project's repositories on GitHub. Shared by
 * every GitHub view of a project (pull requests, issues, a pull request's page).
 */

/**
 * The host's `gh` session. Signed out and missing `gh` are told apart because the fix differs
 * (`gh auth login` against installing it); `unreachable` is a session the host could not check.
 */
export const GithubAuthSchema = z.discriminatedUnion("authenticated", [
  z.object({ authenticated: z.literal(true), login: z.string().min(1) }),
  z.object({
    authenticated: z.literal(false),
    reason: z.enum(["gh-missing", "signed-out", "unreachable"]),
    message: z.string(),
  }),
]);
export type GithubAuth = z.infer<typeof GithubAuthSchema>;

/** A repository attached to a project, and where it lives on GitHub (null: no github.com remote). */
export const GithubProjectRepoSchema = z.object({
  repoId: IdSchema,
  /** The folder's name, as the project shows it. */
  name: z.string().min(1),
  /** `owner/name`, read from the checkout's `origin` remote. */
  nameWithOwner: z.string().min(1).nullable(),
});
export type GithubProjectRepo = z.infer<typeof GithubProjectRepoSchema>;

/** `GET /api/projects/:projectId/github/status`. */
export const GithubStatusResponseSchema = z.object({
  auth: GithubAuthSchema,
  repos: z.array(GithubProjectRepoSchema),
});
export type GithubStatusResponse = z.infer<typeof GithubStatusResponseSchema>;

/** A GitHub account as a list shows it. */
export const GithubUserSchema = z.object({
  login: z.string().min(1),
  // The client renders it as an <img src>, so only an http(s) url parses.
  avatarUrl: z.url({ protocol: /^https?$/ }).nullable(),
});
export type GithubUser = z.infer<typeof GithubUserSchema>;

/** A label: its name and its colour as GitHub stores it (six hex digits, no `#`). */
export const GithubLabelSchema = z.object({
  name: z.string().min(1),
  color: z.string().regex(/^[0-9a-fA-F]{6}$/),
});
export type GithubLabel = z.infer<typeof GithubLabelSchema>;
