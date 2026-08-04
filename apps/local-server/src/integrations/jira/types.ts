export interface JiraIssueKeyList {
  keys: string[];
}

export interface JiraRawNamedEntity {
  id?: string | null;
  name?: string | null;
}

export interface JiraRawStatus extends JiraRawNamedEntity {
  statusCategory?: {
    key?: string | null;
    name?: string | null;
  } | null;
}

export interface JiraRawProject extends JiraRawNamedEntity {
  key?: string | null;
}

export interface JiraRawIssueLinkType {
  name?: string | null;
  inward?: string | null;
  outward?: string | null;
}

export interface JiraRawIssueLinkIssue {
  id: string;
  key: string;
  self?: string | null;
  browseUrl?: string | null;
  fields?: ({ summary?: string | null } & Record<string, unknown>) | null;
}

export interface JiraRawIssueLink {
  id?: string | null;
  type?: JiraRawIssueLinkType | null;
  inwardIssue?: JiraRawIssueLinkIssue | null;
  outwardIssue?: JiraRawIssueLinkIssue | null;
}

export interface JiraRawIssueFields extends Record<string, unknown> {
  summary?: string | null;
  description?: unknown;
  priority?: JiraRawNamedEntity | null;
  status?: JiraRawStatus | null;
  project?: JiraRawProject | null;
  issuelinks?: JiraRawIssueLink[] | null;
}

export interface JiraRawIssue {
  id: string;
  key: string;
  self?: string | null;
  browseUrl?: string | null;
  fields?: JiraRawIssueFields | null;
}

export interface JiraIssueSummary {
  id: string;
  key: string;
  ref: string;
  title: string;
  url: string;
}

export interface JiraResolvedPriority {
  id: string | null;
  name: string;
}

export interface JiraResolvedStatus {
  id: string | null;
  name: string;
  category: string | null;
}

export interface JiraResolvedProject {
  id: string | null;
  key: string;
  name: string;
}

export interface JiraResolvedTeam {
  id: string | null;
  name: string;
}

export interface JiraResolvedIssue extends JiraIssueSummary {
  blocks: JiraIssueSummary[];
  description: string | null;
  priority: JiraResolvedPriority | null;
  status: JiraResolvedStatus | null;
  project: JiraResolvedProject | null;
  team: JiraResolvedTeam | null;
}

export interface JiraConnectionInfo {
  ok: boolean;
  siteUrl: string;
  accountId: string;
  accountDisplayName: string;
  accountEmail: string;
}

export interface JiraIssueClient {
  getIssuesByKeys(keys: string[]): Promise<JiraRawIssue[]>;
  testConnection(): Promise<JiraConnectionInfo>;
}
