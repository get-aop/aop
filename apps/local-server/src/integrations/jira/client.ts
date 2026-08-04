import { Buffer } from "node:buffer";
import { normalizeJiraIssueKey } from "./input-parser.ts";
import type { JiraConnectionInfo, JiraIssueClient, JiraRawIssue } from "./types.ts";

const JIRA_ISSUE_FIELDS = [
  "summary",
  "description",
  "priority",
  "status",
  "project",
  "team",
  "customfield_10001",
  "customfield_10010",
  "issuelinks",
];

const JIRA_SITE_URL_ERROR = "Jira site URL must be an HTTPS atlassian.net site";

export type JiraFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CreateJiraClientOptions {
  siteUrl?: string;
  email?: string;
  apiToken?: string;
  accessToken?: string;
  cloudId?: string;
  fetch?: JiraFetch;
}

interface JiraOAuthClientConfig {
  mode: "oauth";
  siteUrl: string;
  accessToken: string;
  cloudId: string;
}

interface JiraBasicClientConfig {
  mode: "basic";
  siteUrl: string;
  email: string;
  apiToken: string;
}

type JiraClientConfig = JiraOAuthClientConfig | JiraBasicClientConfig;

export const createJiraClient = (options: CreateJiraClientOptions): JiraIssueClient => {
  const config = resolveConfig(options);
  const fetchImpl = options.fetch ?? fetch;

  return {
    getIssuesByKeys: async (keys) => {
      if (keys.length === 0) {
        return [];
      }

      const issues = await Promise.all(
        keys.map((key) => fetchIssue(fetchImpl, config, normalizeJiraIssueKey(key))),
      );

      return issues.filter((issue): issue is JiraRawIssue => issue !== null);
    },
    testConnection: () => fetchCurrentUser(fetchImpl, config),
  };
};

const fetchCurrentUser = async (
  fetchImpl: JiraFetch,
  config: JiraClientConfig,
): Promise<JiraConnectionInfo> => {
  const response = await fetchImpl(buildCurrentUserUrl(config), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: buildAuthorizationHeader(config),
    },
  });

  if (!response.ok) {
    throw new Error(`Jira connection test failed (${response.status})`);
  }

  const body = (await response.json()) as {
    accountId?: string | null;
    displayName?: string | null;
    emailAddress?: string | null;
  };
  const accountId = body.accountId ?? "";
  const accountDisplayName = body.displayName ?? "";
  const accountEmail = body.emailAddress ?? (config.mode === "basic" ? config.email : "");

  return {
    ok: accountId.length > 0 || accountDisplayName.length > 0,
    siteUrl: config.siteUrl,
    accountId,
    accountDisplayName,
    accountEmail,
  };
};

const fetchIssue = async (
  fetchImpl: JiraFetch,
  config: JiraClientConfig,
  key: string,
): Promise<JiraRawIssue | null> => {
  const response = await fetchImpl(buildIssueUrl(config, key), {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: buildAuthorizationHeader(config),
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Jira issue query failed (${response.status})`);
  }

  return normalizeRawIssue((await response.json()) as JiraRawIssue, config.siteUrl, key);
};

const normalizeRawIssue = (
  issue: JiraRawIssue,
  siteUrl: string,
  requestedKey: string,
): JiraRawIssue => {
  const key = normalizeJiraIssueKey(issue.key || requestedKey);
  return {
    ...issue,
    key,
    browseUrl: issue.browseUrl ?? buildBrowseUrl(siteUrl, key),
  };
};

const resolveConfig = (options: CreateJiraClientOptions): JiraClientConfig => {
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  const accessToken = options.accessToken?.trim() ?? "";

  if (accessToken) {
    const cloudId = options.cloudId?.trim() ?? "";
    if (!siteUrl || !cloudId) {
      throw new Error("Jira is not configured");
    }

    return { mode: "oauth", siteUrl, accessToken, cloudId };
  }

  const email = options.email?.trim() ?? "";
  const apiToken = options.apiToken?.trim() ?? "";

  if (!siteUrl || !email || !apiToken) {
    throw new Error("Jira is not configured");
  }

  return { mode: "basic", siteUrl, email, apiToken };
};

const normalizeSiteUrl = (siteUrl: string | undefined): string | null => {
  const trimmed = siteUrl?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = normalizeJiraCloudSiteUrl(trimmed);
  if (!normalized) {
    throw new Error(JIRA_SITE_URL_ERROR);
  }

  return normalized;
};

const normalizeJiraCloudSiteUrl = (siteUrl: string): string | null => {
  try {
    const url = new URL(siteUrl);
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !hostname.endsWith(".atlassian.net") ||
      hostname === "atlassian.net" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.port.length > 0
    ) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
};

const OAUTH_API_BASE = "https://api.atlassian.com/ex/jira";

const buildCurrentUserUrl = (config: JiraClientConfig): string =>
  buildApiUrl(config, "/rest/api/3/myself");

const buildIssueUrl = (config: JiraClientConfig, key: string): string => {
  const url = new URL(buildApiUrl(config, `/rest/api/3/issue/${encodeURIComponent(key)}`));
  url.searchParams.set("fields", JIRA_ISSUE_FIELDS.join(","));
  return url.toString();
};

const buildApiUrl = (config: JiraClientConfig, path: string): string =>
  config.mode === "oauth"
    ? `${OAUTH_API_BASE}/${config.cloudId}${path}`
    : new URL(path, config.siteUrl).toString();

const buildBrowseUrl = (siteUrl: string, key: string): string =>
  new URL(`/browse/${encodeURIComponent(key)}`, siteUrl).toString();

const buildAuthorizationHeader = (config: JiraClientConfig): string =>
  config.mode === "oauth"
    ? `Bearer ${config.accessToken}`
    : `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
