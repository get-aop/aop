import { formatJiraDescription } from "./description-formatter.ts";
import { normalizeJiraIssueKey, parseJiraIssueInput } from "./input-parser.ts";
import type {
  JiraIssueClient,
  JiraIssueSummary,
  JiraRawIssue,
  JiraRawIssueFields,
  JiraRawIssueLink,
  JiraRawIssueLinkIssue,
  JiraRawNamedEntity,
  JiraRawProject,
  JiraRawStatus,
  JiraResolvedIssue,
  JiraResolvedPriority,
  JiraResolvedProject,
  JiraResolvedStatus,
  JiraResolvedTeam,
} from "./types.ts";

interface CreateJiraIssueResolverOptions {
  client: JiraIssueClient;
}

const TEAM_FIELD_KEYS = ["team", "customfield_10001", "customfield_10010"];

export const createJiraIssueResolver = (options: CreateJiraIssueResolverOptions) => ({
  resolve: async (input: string): Promise<JiraResolvedIssue[]> => {
    const { keys } = parseJiraIssueInput(input);
    const issues = await options.client.getIssuesByKeys(keys);
    const issuesByKey = new Map(issues.map((issue) => [normalizeJiraIssueKey(issue.key), issue]));
    const missingKeys = keys.filter((key) => !issuesByKey.has(key));

    if (missingKeys.length > 0) {
      throw new Error(`Jira issues not found: ${missingKeys.join(", ")}`);
    }

    return keys.map((key) => normalizeIssue(getIssueByKey(issuesByKey, key)));
  },
});

const normalizeIssue = (issue: JiraRawIssue): JiraResolvedIssue => {
  const key = normalizeJiraIssueKey(issue.key);
  const fields = getFields(issue);
  const browseBaseUrl = getBrowseBaseUrl(issue);

  return {
    ...toIssueSummary(issue, browseBaseUrl),
    title: getString(fields.summary) ?? key,
    description: formatJiraDescription(fields.description),
    priority: toPriority(fields.priority),
    status: toStatus(fields.status),
    project: toProject(fields.project),
    team: extractTeam(fields),
    blocks: getBlockingIssues(fields.issuelinks, browseBaseUrl),
  };
};

const getIssueByKey = (issuesByKey: Map<string, JiraRawIssue>, key: string): JiraRawIssue => {
  const issue = issuesByKey.get(key);
  if (!issue) {
    throw new Error(`Jira issue not found in resolver: ${key}`);
  }
  return issue;
};

const getFields = (issue: JiraRawIssue): JiraRawIssueFields => issue.fields ?? {};

const getBlockingIssues = (
  links: JiraRawIssueLink[] | null | undefined,
  browseBaseUrl: string | null,
): JiraIssueSummary[] =>
  uniqueIssueSummaries((links ?? []).flatMap((link) => getBlockingIssue(link, browseBaseUrl)));

const getBlockingIssue = (
  link: JiraRawIssueLink,
  browseBaseUrl: string | null,
): JiraIssueSummary[] => {
  if (link.inwardIssue && isInwardBlocker(link)) {
    return [toIssueSummary(link.inwardIssue, browseBaseUrl)];
  }

  if (link.outwardIssue && isOutwardBlocker(link)) {
    return [toIssueSummary(link.outwardIssue, browseBaseUrl)];
  }

  return [];
};

const isInwardBlocker = (link: JiraRawIssueLink): boolean =>
  relationTextIncludes(link.type?.inward, "blocked by") ||
  relationTextIncludes(link.type?.name, "blocked by");

const isOutwardBlocker = (link: JiraRawIssueLink): boolean =>
  relationTextIncludes(link.type?.outward, "blocked by");

const relationTextIncludes = (value: string | null | undefined, token: string): boolean =>
  (value ?? "").toLowerCase().includes(token);

const toIssueSummary = (
  issue: JiraRawIssue | JiraRawIssueLinkIssue,
  browseBaseUrl: string | null,
): JiraIssueSummary => {
  const key = normalizeJiraIssueKey(issue.key);
  return {
    id: issue.id,
    key,
    ref: key,
    title: getString(issue.fields?.summary) ?? key,
    url: getIssueUrl(issue, browseBaseUrl, key),
  };
};

const toPriority = (
  priority: JiraRawNamedEntity | null | undefined,
): JiraResolvedPriority | null => {
  const name = getString(priority?.name);
  if (!name) {
    return null;
  }

  return {
    id: getString(priority?.id),
    name,
  };
};

const toStatus = (status: JiraRawStatus | null | undefined): JiraResolvedStatus | null => {
  const name = getString(status?.name);
  if (!name) {
    return null;
  }

  return {
    id: getString(status?.id),
    name,
    category: getString(status?.statusCategory?.name),
  };
};

const toProject = (project: JiraRawProject | null | undefined): JiraResolvedProject | null => {
  const key = getString(project?.key);
  const name = getString(project?.name);
  if (!key || !name) {
    return null;
  }

  return {
    id: getString(project?.id),
    key,
    name,
  };
};

const extractTeam = (fields: JiraRawIssueFields): JiraResolvedTeam | null => {
  for (const fieldKey of TEAM_FIELD_KEYS) {
    const team = toTeam(fields[fieldKey]);
    if (team) {
      return team;
    }
  }

  return null;
};

const toTeam = (value: unknown): JiraResolvedTeam | null => {
  const record = toRecord(value);
  const name = getFirstString(record, ["name", "displayName", "title", "value"]);
  if (!record || !name) {
    return null;
  }

  return {
    id: getString(record.id),
    name,
  };
};

const uniqueIssueSummaries = (summaries: JiraIssueSummary[]): JiraIssueSummary[] => {
  const byKey = new Map<string, JiraIssueSummary>();

  for (const summary of summaries) {
    if (!byKey.has(summary.key)) {
      byKey.set(summary.key, summary);
    }
  }

  return [...byKey.values()];
};

const getIssueUrl = (
  issue: JiraRawIssue | JiraRawIssueLinkIssue,
  browseBaseUrl: string | null,
  key: string,
): string => {
  const browseUrl = getString(issue.browseUrl);
  if (browseUrl) {
    return browseUrl;
  }

  if (browseBaseUrl) {
    return new URL(`/browse/${encodeURIComponent(key)}`, browseBaseUrl).toString();
  }

  return getString(issue.self) ?? key;
};

const getBrowseBaseUrl = (issue: JiraRawIssue): string | null => {
  const candidate = getString(issue.browseUrl) ?? getString(issue.self);
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
};

const getFirstString = (record: Record<string, unknown> | null, keys: string[]): string | null => {
  if (!record) {
    return null;
  }

  for (const key of keys) {
    const value = getString(record[key]);
    if (value) {
      return value;
    }
  }

  return null;
};

const getString = (value: unknown): string | null => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
};

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
