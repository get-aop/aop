import { z } from "zod";

/**
 * A project's Jira connection. Jira Cloud signs in with an account's email and an API token
 * (Basic auth, REST API v3); Jira Data Center and Server with a personal access token (Bearer,
 * REST API v2). The token stays on the host: no answer to a client carries it.
 */
export const JiraDeploymentSchema = z.enum(["cloud", "datacenter"]);
export type JiraDeployment = z.infer<typeof JiraDeploymentSchema>;

/**
 * The site's address, without a trailing slash or path. Plain http is only for this machine (a
 * Jira on localhost, or the fake one verification runs), so a token never crosses a network
 * unencrypted.
 */
export const JiraSiteUrlSchema = z
  .string()
  .trim()
  .max(300)
  .transform((value) => value.replace(/\/+$/, ""))
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine(isSafeSiteUrl, {
    message: "Use the site's https:// address, e.g. https://your-team.atlassian.net",
  });

/** A Jira project key: letters first, then letters, digits or underscores. */
export const JiraProjectKeySchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,29}$/, "Not a Jira project key")
  .transform((key) => key.toUpperCase());

export const JIRA_JQL_MAX = 2000;
export const JIRA_PROJECTS_MAX = 20;

/**
 * Which issues the project shows: the open issues of some Jira projects, newest first, or what
 * an advanced JQL query finds (both, when both are given). The tab's Open/Closed/All filter is
 * added on top, so the JQL need not say.
 */
export const JiraFilterSchema = z
  .object({
    projects: z.array(JiraProjectKeySchema).max(JIRA_PROJECTS_MAX),
    jql: z
      .string()
      .trim()
      .max(JIRA_JQL_MAX)
      .transform((jql) => jql || null)
      .nullable(),
  })
  .refine((filter) => filter.projects.length > 0 || filter.jql !== null, {
    message: "Pick a Jira project or write a JQL query",
  });
export type JiraFilter = z.infer<typeof JiraFilterSchema>;

/** What the host owner types to sign in: Cloud's email and API token, or a Data Center PAT. */
export const JiraCredentialsSchema = z.discriminatedUnion("deployment", [
  z.object({
    deployment: z.literal("cloud"),
    siteUrl: JiraSiteUrlSchema,
    email: z.string().trim().min(3).max(320),
    apiToken: z.string().trim().min(1).max(1000),
  }),
  z.object({
    deployment: z.literal("datacenter"),
    siteUrl: JiraSiteUrlSchema,
    token: z.string().trim().min(1).max(1000),
  }),
]);
export type JiraCredentials = z.infer<typeof JiraCredentialsSchema>;

/** The Jira account a token signs in as, as `/myself` names it. */
export const JiraAccountSchema = z.object({
  displayName: z.string(),
  email: z.string().nullable(),
  avatarUrl: z.url({ protocol: /^https?$/ }).nullable(),
});
export type JiraAccount = z.infer<typeof JiraAccountSchema>;

export const JiraProjectSummarySchema = z.object({ key: z.string(), name: z.string() });
export type JiraProjectSummary = z.infer<typeof JiraProjectSummarySchema>;

/**
 * A project's Jira connection as any client sees it: where it points and what it shows, never
 * the token or the email it signs in with.
 */
export const JiraConnectionSchema = z.object({
  configured: z.boolean(),
  deployment: JiraDeploymentSchema.nullable(),
  siteUrl: z.string().nullable(),
  /** The account's display name, as Jira gave it when the connection was saved. */
  account: z.string().nullable(),
  filter: z.object({ projects: z.array(z.string()), jql: z.string().nullable() }).nullable(),
  /** A thread started from a Jira issue puts its key in its pull request's title. */
  linkPullRequests: z.boolean(),
});
export type JiraConnection = z.infer<typeof JiraConnectionSchema>;

export const JIRA_NOT_CONNECTED: JiraConnection = {
  configured: false,
  deployment: null,
  siteUrl: null,
  account: null,
  filter: null,
  linkPullRequests: true,
};

/**
 * `POST /api/projects/:id/jira/test` (host owner only): signs in with these credentials, or the
 * stored ones, and answers who they sign in as and the projects they see.
 */
export const JiraTestInputSchema = z.object({ credentials: JiraCredentialsSchema.optional() });
export type JiraTestInput = z.infer<typeof JiraTestInputSchema>;

export const JiraTestResultSchema = z.object({
  account: JiraAccountSchema,
  projects: z.array(JiraProjectSummarySchema),
});
export type JiraTestResult = z.infer<typeof JiraTestResultSchema>;

/**
 * `PUT /api/projects/:id/jira` (host owner only). Without `credentials` it keeps the stored ones
 * and changes only what is shown. The host signs in and runs the filter once before keeping it.
 */
export const JiraConnectInputSchema = z.object({
  credentials: JiraCredentialsSchema.optional(),
  filter: JiraFilterSchema,
  linkPullRequests: z.boolean().default(true),
});
export type JiraConnectInput = z.infer<typeof JiraConnectInputSchema>;

function isSafeSiteUrl(value: string): boolean {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) return false;
  return url.protocol === "https:" || LOOPBACK.has(url.hostname);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
