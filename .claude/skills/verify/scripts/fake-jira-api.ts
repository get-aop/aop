/**
 * The REST endpoints of the fake Jira site (fake-jira.ts handles auth, controls and logging):
 * myself, the project list, the Cloud search (`/rest/api/3/search/jql`, token pages), the Data
 * Center search (`/rest/api/2/search`, startAt pages) and one issue. The removed Cloud
 * `/rest/api/3/search` answers 410 the way Atlassian's does.
 */
import {
  buildIssue,
  buildProject,
  FIELD_NAMES,
  type IssueSpec,
  type JiraApi,
  myself,
  PROJECTS,
} from "./jira-fixtures.ts";
import { JqlError, parseJql, runJql } from "./jira-jql.ts";

/** What a request asked for, from its query string and JSON body (the body wins). */
export interface ApiInput {
  jql?: string;
  fields?: string[];
  maxResults?: number;
  startAt?: number;
  nextPageToken?: string;
  expand?: string;
  query?: string;
}

export interface ApiContext {
  base: string;
  api: JiraApi;
  method: string;
  /** The path after `/rest/api/<version>`. */
  path: string;
  input: ApiInput;
  issues: IssueSpec[];
}

/** Answers one authenticated API request. */
export function routeApi(ctx: ApiContext): Response {
  const route = ROUTES.find(
    (entry) =>
      (entry.api === "both" || entry.api === ctx.api) &&
      entry.methods.includes(ctx.method) &&
      entry.path.test(ctx.path),
  );
  if (!route) return jiraError(404, ["The requested resource could not be found."]);
  try {
    return route.handle(ctx, ctx.path.match(route.path) ?? []);
  } catch (error) {
    if (error instanceof JqlError || error instanceof BadRequest) {
      return jiraError(400, [error.message]);
    }
    throw error;
  }
}

export async function readInput(request: Request, url: URL): Promise<ApiInput> {
  const fromQuery = queryInput(url.searchParams);
  if (request.method !== "POST") return fromQuery;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    ...fromQuery,
    ...body,
    fields: listOf(body.fields) ?? fromQuery.fields,
    expand: listOf(body.expand)?.join(",") ?? fromQuery.expand,
  };
}

/** A log-friendly line: the query, page size and which page. Never anything secret. */
export function describeInput(input: ApiInput): string {
  const parts = [
    input.jql !== undefined ? `jql=${JSON.stringify(input.jql)}` : "",
    input.maxResults !== undefined ? `maxResults=${input.maxResults}` : "",
    input.startAt !== undefined ? `startAt=${input.startAt}` : "",
    input.nextPageToken !== undefined
      ? `pageToken(offset=${tokenOffset(input.nextPageToken)})`
      : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** A Jira error body: `{errorMessages, errors}`. */
export function jiraError(status: number, messages: string[], headers?: HeadersInit): Response {
  return Response.json({ errorMessages: messages, errors: {} }, { status, headers });
}

class BadRequest extends Error {}

interface Route {
  api: JiraApi | "both";
  methods: string[];
  path: RegExp;
  handle: (ctx: ApiContext, match: string[]) => Response;
}

const ROUTES: Route[] = [
  {
    api: "both",
    methods: ["GET"],
    path: /^\/myself$/,
    handle: (ctx) => Response.json(myself(ctx.base, ctx.api)),
  },
  { api: "cloud", methods: ["GET"], path: /^\/project\/search$/, handle: projectSearch },
  {
    api: "dc",
    methods: ["GET"],
    path: /^\/project$/,
    handle: (ctx) => Response.json(PROJECTS.map((entry) => buildProject(entry, ctx.base, "dc"))),
  },
  { api: "cloud", methods: ["GET", "POST"], path: /^\/search\/jql$/, handle: searchJql },
  {
    api: "cloud",
    methods: ["GET", "POST"],
    path: /^\/search$/,
    handle: () =>
      jiraError(410, [
        "The requested API has been removed. Please migrate to the /rest/api/3/search/jql API.",
      ]),
  },
  { api: "dc", methods: ["GET", "POST"], path: /^\/search$/, handle: searchV2 },
  { api: "both", methods: ["GET"], path: /^\/issue\/([^/]+)$/, handle: getIssue },
];

// Fields Jira leaves out of `*navigable` because they cannot be a column in the issue list.
const NOT_NAVIGABLE = new Set(["comment"]);

function projectSearch(ctx: ApiContext): Response {
  const startAt = Math.max(0, ctx.input.startAt ?? 0);
  const maxResults = clamp(ctx.input.maxResults ?? 50, 1, 100);
  const needle = (ctx.input.query ?? "").toLowerCase();
  const matching = PROJECTS.filter(
    (entry) =>
      entry.key.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle),
  );
  const values = matching.slice(startAt, startAt + maxResults);
  const isLast = startAt + maxResults >= matching.length;
  const page = (at: number) =>
    `${ctx.base}/rest/api/3/project/search?maxResults=${maxResults}&startAt=${at}`;
  return Response.json({
    self: page(startAt),
    ...(isLast ? {} : { nextPage: page(startAt + maxResults) }),
    maxResults,
    startAt,
    total: matching.length,
    isLast,
    values: values.map((entry) => buildProject(entry, ctx.base, "cloud")),
  });
}

function searchJql(ctx: ApiContext): Response {
  const source = ctx.input.jql ?? "";
  const jql = parseJql(source);
  if (!jql.where) {
    return jiraError(400, [
      "Unbounded JQL queries are not allowed here. Please add a search restriction to your query.",
    ]);
  }
  const token = ctx.input.nextPageToken;
  const offset = token ? readToken(token, source) : 0;
  const maxResults = clamp(ctx.input.maxResults ?? 50, 1, 100);
  const matched = runJql(jql, ctx.issues);
  const more = offset + maxResults < matched.length;
  return Response.json({
    issues: matched
      .slice(offset, offset + maxResults)
      .map((spec) => issuePayload(spec, ctx, ctx.input.fields ?? [])),
    ...(more ? { nextPageToken: makeToken(offset + maxResults, source) } : {}),
    isLast: !more,
  });
}

function searchV2(ctx: ApiContext): Response {
  const matched = runJql(parseJql(ctx.input.jql ?? ""), ctx.issues);
  const startAt = Math.max(0, ctx.input.startAt ?? 0);
  const maxResults = clamp(ctx.input.maxResults ?? 50, 1, 1000);
  return Response.json({
    expand: "schema,names",
    startAt,
    maxResults,
    total: matched.length,
    issues: matched
      .slice(startAt, startAt + maxResults)
      .map((spec) => issuePayload(spec, ctx, ctx.input.fields ?? ["*navigable"])),
  });
}

function getIssue(ctx: ApiContext, match: string[]): Response {
  const wanted = decodeURIComponent(match[1] ?? "").toUpperCase();
  const spec = ctx.issues.find((entry) => entry.key === wanted || entry.id === wanted);
  if (!spec) {
    return jiraError(404, ["Issue does not exist or you do not have permission to see it."]);
  }
  const payload = issuePayload(spec, ctx, ctx.input.fields ?? ["*all"]);
  if (!(ctx.input.expand ?? "").split(",").includes("names")) return Response.json(payload);
  const names = Object.fromEntries(
    Object.keys("fields" in payload ? payload.fields : {}).map((field) => [
      field,
      FIELD_NAMES[field] ?? field,
    ]),
  );
  return Response.json({ ...payload, names });
}

/** An issue with only the fields asked for; id, key and self are always there. */
function issuePayload(spec: IssueSpec, ctx: ApiContext, requested: string[]) {
  const { fields, ...issue } = buildIssue(spec, ctx.base, ctx.api);
  const chosen = pickFields(Object.keys(fields), requested);
  if (chosen.size === 0) return issue;
  const all = fields as Record<string, unknown>;
  return { ...issue, fields: Object.fromEntries([...chosen].map((name) => [name, all[name]])) };
}

function pickFields(available: string[], requested: string[]): Set<string> {
  const chosen = new Set(requested.flatMap((name) => expandField(name, available)));
  for (const name of requested) if (name.startsWith("-")) chosen.delete(name.slice(1));
  return chosen;
}

function expandField(name: string, available: string[]): string[] {
  if (name === "*all") return available;
  if (name === "*navigable") return available.filter((field) => !NOT_NAVIGABLE.has(field));
  return available.includes(name) ? [name] : [];
}

// The page token is opaque to clients; here it carries the offset and the query it belongs to,
// so a token replayed with a different query is refused the way Jira refuses it.
function makeToken(offset: number, jql: string): string {
  return Buffer.from(JSON.stringify({ offset, jql })).toString("base64url");
}

function readToken(token: string, jql: string): number {
  const decoded = decodeToken(token);
  if (!decoded || decoded.jql !== jql) {
    throw new BadRequest("The provided next page token is invalid or expired.");
  }
  return decoded.offset;
}

function decodeToken(token: string): { offset: number; jql: string } | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    return typeof decoded?.offset === "number" && typeof decoded?.jql === "string" ? decoded : null;
  } catch {
    return null;
  }
}

function tokenOffset(token: string): string {
  return String(decodeToken(token)?.offset ?? "invalid");
}

function queryInput(params: URLSearchParams): ApiInput {
  const text = (name: string) => params.get(name) ?? undefined;
  const number = (name: string) => (params.has(name) ? Number(params.get(name)) : undefined);
  return {
    jql: text("jql"),
    fields: listOf(text("fields")),
    maxResults: number("maxResults"),
    startAt: number("startAt"),
    nextPageToken: text("nextPageToken"),
    expand: text("expand"),
    query: text("query"),
  };
}

/** `fields` and `expand` come as a comma-separated string or, in a JSON body, an array. */
function listOf(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? splitFields(value) : undefined;
}

function splitFields(value: string): string[] {
  return value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
}
