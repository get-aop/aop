import type { JiraAccount, JiraCredentials, JiraProjectSummary } from "@aop/common";

/**
 * Jira's REST API, signed in with a project's credentials: Jira Cloud with the account's email
 * and API token (Basic, API v3), Data Center and Server with a personal access token (Bearer,
 * API v2). The token goes in the Authorization header and nowhere else: never in a log line, an
 * error message or anything a client receives.
 *
 * Jira answers a burst with 429 (or 503) and a Retry-After. A short wait is waited out here, at
 * most twice; a longer one is handed back as `rate-limited`, so the loader stops asking until it
 * has passed.
 */
export type JiraFetch = (url: string, init: RequestInit) => Promise<Response>;

export type JiraFailureKind =
  | "unauthorized"
  | "rate-limited"
  | "bad-request"
  | "not-found"
  | "error";

export interface JiraFailure {
  kind: JiraFailureKind;
  message: string;
  /** How long Jira asked to be left alone, for `rate-limited`. */
  retryAfterMs?: number;
}

export type JiraRead<T> = { ok: true; value: T } | { ok: false; failure: JiraFailure };

/** An issue as Jira's REST API answers it; only `fields` the request named are there. */
export interface JiraIssueNode {
  id: string;
  key: string;
  fields?: Record<string, unknown>;
}

export interface JiraSearchPage {
  issues: JiraIssueNode[];
  /** Where the next page starts (Cloud's `nextPageToken`, Data Center's `startAt`); null at the end. */
  next: string | null;
}

export interface JiraApi {
  myself: (credentials: JiraCredentials) => Promise<JiraRead<JiraAccount>>;
  projects: (credentials: JiraCredentials) => Promise<JiraRead<JiraProjectSummary[]>>;
  searchPage: (
    credentials: JiraCredentials,
    request: { jql: string; fields: readonly string[]; maxResults: number; cursor: string | null },
  ) => Promise<JiraRead<JiraSearchPage>>;
  /** One issue with every field and their names (to find acceptance criteria); null when unknown. */
  issue: (
    credentials: JiraCredentials,
    key: string,
  ) => Promise<JiraRead<{ issue: JiraIssueNode; names: Record<string, string> } | null>>;
}

export interface JiraApiOptions {
  fetch?: JiraFetch;
  sleep?: (ms: number) => Promise<void>;
  /** The longest Retry-After waited out in place; longer ones fail as `rate-limited`. */
  maxWaitMs?: number;
}

const MAX_RETRIES = 2;
const PROJECT_PAGES_MAX = 5;

export const createJiraApi = (options: JiraApiOptions = {}): JiraApi => {
  const call = createCaller(options);
  return {
    myself: async (credentials) => {
      const read = await call<MyselfBody>(credentials, "GET", "/myself");
      return read.ok ? { ok: true, value: accountOf(read.value) } : read;
    },
    projects: (credentials) =>
      credentials.deployment === "cloud"
        ? cloudProjects(call, credentials)
        : dataCenterProjects(call, credentials),
    searchPage: (credentials, request) =>
      credentials.deployment === "cloud"
        ? cloudSearch(call, credentials, request)
        : dataCenterSearch(call, credentials, request),
    issue: async (credentials, key) => {
      const path = `/issue/${encodeURIComponent(key)}?fields=*all&expand=names`;
      const read = await call<JiraIssueNode & { names?: Record<string, string> }>(
        credentials,
        "GET",
        path,
      );
      if (!read.ok) {
        return read.failure.kind === "not-found" ? { ok: true, value: null } : read;
      }
      const { names = {}, ...issue } = read.value;
      return { ok: true, value: { issue, names } };
    },
  };
};

/** The Authorization header for a connection's credentials. */
export const authorizationOf = (credentials: JiraCredentials): string =>
  credentials.deployment === "cloud"
    ? `Basic ${Buffer.from(`${credentials.email}:${credentials.apiToken}`).toString("base64")}`
    : `Bearer ${credentials.token}`;

/** Where an issue is read in a browser. */
export const browseUrl = (credentials: JiraCredentials, key: string): string =>
  `${credentials.siteUrl}/browse/${encodeURIComponent(key)}`;

type Call = <T>(
  credentials: JiraCredentials,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) => Promise<JiraRead<T>>;

const createCaller = (options: JiraApiOptions): Call => {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? ((ms) => new Promise<void>((done) => setTimeout(done, ms)));
  const maxWaitMs = options.maxWaitMs ?? 5_000;

  return async <T>(
    credentials: JiraCredentials,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ) => {
    const url = `${credentials.siteUrl}${apiBase(credentials)}${path}`;
    for (let attempt = 0; ; attempt++) {
      const read = await callOnce<T>(doFetch, url, method, credentials, body);
      const wait = attempt < MAX_RETRIES ? waitBeforeRetry(read, maxWaitMs) : null;
      if (wait === null) return read;
      await sleep(wait);
    }
  };
};

/** How long to wait before asking again: only for a rate limit short enough to wait out. */
const waitBeforeRetry = <T>(read: JiraRead<T>, maxWaitMs: number): number | null => {
  const wait = read.ok ? undefined : read.failure.retryAfterMs;
  return wait !== undefined && wait <= maxWaitMs ? wait : null;
};

const callOnce = async <T>(
  doFetch: JiraFetch,
  url: string,
  method: "GET" | "POST",
  credentials: JiraCredentials,
  body: unknown,
): Promise<JiraRead<T>> => {
  const answered = await send(doFetch, url, method, credentials, body);
  return "failure" in answered
    ? { ok: false, failure: answered.failure }
    : readResponse<T>(answered.response);
};

const apiBase = (credentials: JiraCredentials): string =>
  credentials.deployment === "cloud" ? "/rest/api/3" : "/rest/api/2";

const send = async (
  doFetch: JiraFetch,
  url: string,
  method: "GET" | "POST",
  credentials: JiraCredentials,
  body: unknown,
): Promise<{ response: Response } | { failure: JiraFailure }> => {
  try {
    const response = await doFetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authorizationOf(credentials),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    return { response };
  } catch (error) {
    const host = new URL(url).host;
    return {
      failure: {
        kind: "error",
        message: `Jira could not be reached at ${host} (${errorName(error)})`,
      },
    };
  }
};

const readResponse = async <T>(response: Response): Promise<JiraRead<T>> => {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (response.ok && payload !== null) return { ok: true, value: payload as T };
  return { ok: false, failure: failureOf(response, payload) };
};

const failureOf = (response: Response, payload: unknown): JiraFailure => {
  const { status } = response;
  if (status === 401 || isLoginFailure(response)) {
    return {
      kind: "unauthorized",
      message: "Jira refused the token: it may have expired or been revoked",
    };
  }
  if (status === 429 || (status === 503 && response.headers.has("retry-after"))) {
    const retryAfterMs = retryAfterOf(response.headers.get("retry-after"));
    return {
      kind: "rate-limited",
      message: `Jira asked AOP to slow down; it tries again in ${Math.ceil(retryAfterMs / 1000)} s`,
      retryAfterMs,
    };
  }
  const detail = jiraMessage(payload) ?? `HTTP ${status}`;
  if (status === 404) return { kind: "not-found", message: detail };
  if (status === 400) return { kind: "bad-request", message: detail };
  if (status >= 300 && status < 400) {
    return { kind: "error", message: "Jira redirected the request: check the site address" };
  }
  return { kind: "error", message: `Jira answered with an error: ${detail}` };
};

// Jira Server answers a refused login with 403 and says why in this header, e.g. after too many
// failed attempts (it then wants a CAPTCHA in the browser).
const isLoginFailure = (response: Response): boolean =>
  response.status === 403 &&
  /AUTHENTICATED_FAILED|AUTHENTICATION_DENIED/.test(
    response.headers.get("x-seraph-loginreason") ?? "",
  );

const DEFAULT_RETRY_AFTER_MS = 60_000;

/** Retry-After in seconds or as an HTTP date; a minute when Jira does not say. */
export const retryAfterOf = (header: string | null, now = Date.now()): number => {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - now);
};

/** Jira's own words for what went wrong (`errorMessages`, or the first of `errors`), shortened. */
const jiraMessage = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") return null;
  const { errorMessages, errors } = payload as { errorMessages?: unknown; errors?: unknown };
  const first =
    (Array.isArray(errorMessages) ? errorMessages.find(isText) : undefined) ??
    (errors && typeof errors === "object" ? Object.values(errors).find(isText) : undefined);
  return typeof first === "string" ? first.slice(0, 300) : null;
};

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

const cloudSearch = async (
  call: Call,
  credentials: JiraCredentials,
  { jql, fields, maxResults, cursor }: Parameters<JiraApi["searchPage"]>[1],
): Promise<JiraRead<JiraSearchPage>> => {
  // The first page has no token; Jira refuses a null one.
  const body = { jql, fields, maxResults, ...(cursor ? { nextPageToken: cursor } : {}) };
  const read = await call<CloudSearchBody>(credentials, "POST", "/search/jql", body);
  if (!read.ok) return read;
  const issues = read.value.issues ?? [];
  const token = read.value.nextPageToken;
  // A page with no issues ends it too, so a token that never runs out cannot loop.
  const more = read.value.isLast !== true && typeof token === "string" && issues.length > 0;
  return { ok: true, value: { issues, next: more ? token : null } };
};

const dataCenterSearch = async (
  call: Call,
  credentials: JiraCredentials,
  { jql, fields, maxResults, cursor }: Parameters<JiraApi["searchPage"]>[1],
): Promise<JiraRead<JiraSearchPage>> => {
  const startAt = Number(cursor ?? 0) || 0;
  const read = await call<DataCenterSearchBody>(credentials, "POST", "/search", {
    jql,
    fields,
    maxResults,
    startAt,
  });
  if (!read.ok) return read;
  const issues = read.value.issues ?? [];
  const reached = startAt + issues.length;
  const more = issues.length > 0 && reached < (read.value.total ?? 0);
  return { ok: true, value: { issues, next: more ? String(reached) : null } };
};

const cloudProjects = async (
  call: Call,
  credentials: JiraCredentials,
): Promise<JiraRead<JiraProjectSummary[]>> => {
  const projects: JiraProjectSummary[] = [];
  for (let page = 0; page < PROJECT_PAGES_MAX; page++) {
    const path = `/project/search?orderBy=key&maxResults=100&startAt=${projects.length}`;
    const read = await call<{ values?: ProjectBody[]; isLast?: boolean }>(credentials, "GET", path);
    if (!read.ok) return read;
    const values = read.value.values ?? [];
    projects.push(...values.map(projectOf));
    if (read.value.isLast !== false || values.length === 0) break;
  }
  return { ok: true, value: projects };
};

const dataCenterProjects = async (
  call: Call,
  credentials: JiraCredentials,
): Promise<JiraRead<JiraProjectSummary[]>> => {
  const read = await call<ProjectBody[]>(credentials, "GET", "/project");
  if (!read.ok) return read;
  const values = Array.isArray(read.value) ? read.value : [];
  return { ok: true, value: values.map(projectOf) };
};

const projectOf = (project: ProjectBody): JiraProjectSummary => ({
  key: String(project.key ?? ""),
  name: String(project.name ?? project.key ?? ""),
});

const accountOf = (body: MyselfBody): JiraAccount => ({
  displayName: body.displayName || body.name || "",
  email: body.emailAddress || null,
  avatarUrl: webUrl(body.avatarUrls?.["48x48"]),
});

/** An http(s) address, or null: anything else must never reach a client as a link or image. */
export const webUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "network error";

interface MyselfBody {
  displayName?: string;
  name?: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

interface ProjectBody {
  key?: string;
  name?: string;
}

interface CloudSearchBody {
  issues?: JiraIssueNode[];
  nextPageToken?: string | null;
  isLast?: boolean;
}

interface DataCenterSearchBody {
  issues?: JiraIssueNode[];
  total?: number;
}
