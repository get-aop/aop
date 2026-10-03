/**
 * Turns fixture issues (jira-fixtures.ts) into what the fake Jira site answers: Jira Cloud
 * payloads (REST v3, ADF bodies, account ids) or Data Center ones (REST v2, wiki markup, user
 * names). Every field is built; fake-jira.ts filters them down to what a request asked for.
 */
import {
  type AdfNode,
  COMMENTS,
  DESCRIPTIONS,
  doc,
  OFFLINE_ACCEPTANCE,
  p,
} from "./jira-adf-fixtures.ts";
import {
  COMPONENTS,
  ISSUE_TYPES,
  type IssueSpec,
  PRIORITIES,
  PROJECTS,
  type PriorityName,
  STATUS_CATEGORIES,
  STATUSES,
  type StatusKey,
  type TypeName,
} from "./jira-catalog.ts";
import { type JiraApi, jiraUser } from "./jira-people.ts";
import { adfToText, adfToWiki } from "./jira-wiki.ts";

/** Jira's timestamp form: `2026-09-28T14:03:11.000+0000`. */
export const jiraTime = (iso: string) => iso.replace("Z", "+0000");
const apiVersion = (api: JiraApi) => (api === "cloud" ? "3" : "2");
const body = (node: AdfNode | null, api: JiraApi) => (api === "cloud" ? node : adfToWiki(node));

/** The description, `doc(...)` or null; issues added by /__fixture/many get a stock line. */
export function descriptionOf(spec: IssueSpec): AdfNode | null {
  if (spec.key in DESCRIPTIONS) return DESCRIPTIONS[spec.key] ?? null;
  return doc(p("Found by the quarterly cleanup script."));
}

/** Summary, description and comments as plain words, for `text ~`. */
export function issueText(spec: IssueSpec): string {
  const comments = (COMMENTS[spec.key] ?? []).map((entry) => adfToText(entry.body));
  return [spec.summary, adfToText(descriptionOf(spec)), ...comments].join(" ");
}

export function projectOf(spec: IssueSpec) {
  const key = spec.key.split("-")[0];
  const found = PROJECTS.find((project) => project.key === key);
  if (!found) throw new Error(`No fixture project for ${spec.key}`);
  return found;
}

export function buildProject(project: (typeof PROJECTS)[number], base: string, api: JiraApi) {
  const avatar = `${base}/rest/api/${apiVersion(api)}/universal_avatar/view/type/project/avatar/${project.avatarId}`;
  return {
    expand: "description,lead,issueTypes,url,projectKeys,permissions,insight",
    self: `${base}/rest/api/${apiVersion(api)}/project/${project.id}`,
    id: project.id,
    key: project.key,
    name: project.name,
    avatarUrls: {
      "48x48": avatar,
      "24x24": `${avatar}?size=small`,
      "16x16": `${avatar}?size=xsmall`,
      "32x32": `${avatar}?size=medium`,
    },
    projectTypeKey: "software",
    simplified: false,
    style: "classic",
    isPrivate: false,
    properties: {},
  };
}

/** Every field the site has for an issue; fake-jira.ts filters them to what was asked for. */
export function buildIssueFields(spec: IssueSpec, base: string, api: JiraApi) {
  const rest = `${base}/rest/api/${apiVersion(api)}`;
  const updated = spec.touchedAt ?? spec.updated;
  const project = buildProject(projectOf(spec), base, api);
  return {
    summary: spec.summary,
    issuetype: buildType(spec.type, rest),
    project: {
      self: project.self,
      id: project.id,
      key: project.key,
      name: project.name,
      projectTypeKey: "software",
      simplified: false,
      avatarUrls: project.avatarUrls,
    },
    status: buildStatus(STATUSES[spec.status], base, rest),
    priority: buildPriority(spec.priority, base, rest),
    assignee: spec.assignee ? jiraUser(spec.assignee, base, api) : null,
    reporter: jiraUser(spec.reporter, base, api),
    creator: jiraUser(spec.reporter, base, api),
    labels: spec.labels,
    components: spec.components.map((name) => ({
      self: `${rest}/component/${COMPONENTS[name]}`,
      id: COMPONENTS[name],
      name,
    })),
    fixVersions: spec.fixVersion
      ? [
          {
            self: `${rest}/version/10031`,
            id: "10031",
            name: "2.4.0",
            archived: false,
            released: false,
            releaseDate: "2026-10-20",
          },
        ]
      : [],
    resolution: spec.resolution
      ? {
          self: `${rest}/resolution/${spec.resolution === "Done" ? 10000 : 10001}`,
          id: spec.resolution === "Done" ? "10000" : "10001",
          name: spec.resolution,
          description: "",
        }
      : null,
    resolutiondate: spec.resolution ? jiraTime(updated) : null,
    created: jiraTime(spec.created),
    updated: jiraTime(updated),
    description: body(descriptionOf(spec), api),
    comment: buildComments(spec, base, api),
    customfield_10050: spec.key === "APP-2" ? body(OFFLINE_ACCEPTANCE, api) : null,
  };
}

export function buildIssue(spec: IssueSpec, base: string, api: JiraApi) {
  return {
    expand: "renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations",
    id: spec.id,
    self: `${base}/rest/api/${apiVersion(api)}/issue/${spec.id}`,
    key: spec.key,
    fields: buildIssueFields(spec, base, api),
  };
}

function buildType(name: TypeName, rest: string) {
  const type = ISSUE_TYPES[name];
  return {
    self: `${rest}/issuetype/${type.id}`,
    id: type.id,
    description: type.description,
    iconUrl: `${rest}/universal_avatar/view/type/issuetype/avatar/${type.avatarId}?size=medium`,
    name,
    subtask: false,
    avatarId: type.avatarId,
    hierarchyLevel: type.level,
  };
}

function buildStatus(status: (typeof STATUSES)[StatusKey], base: string, rest: string) {
  const category = STATUS_CATEGORIES[status.category];
  return {
    self: `${rest}/status/${status.id}`,
    description: "",
    iconUrl: `${base}/images/icons/statuses/generic.png`,
    name: status.name,
    id: status.id,
    statusCategory: { self: `${rest}/statuscategory/${category.id}`, ...category },
  };
}

function buildPriority(name: PriorityName | null, base: string, rest: string) {
  const priority = PRIORITIES.find((entry) => entry.name === name);
  if (!priority) return null;
  return {
    self: `${rest}/priority/${priority.id}`,
    iconUrl: `${base}/images/icons/priorities/${priority.icon}.svg`,
    name: priority.name,
    id: priority.id,
  };
}

function buildComments(spec: IssueSpec, base: string, api: JiraApi) {
  const self = `${base}/rest/api/${apiVersion(api)}/issue/${spec.id}/comment`;
  const comments = (COMMENTS[spec.key] ?? []).map((entry, index) => {
    const at = jiraTime(
      new Date(Date.parse(spec.updated) - entry.minutesBefore * 60_000).toISOString(),
    );
    const author = jiraUser(entry.author, base, api);
    return {
      self: `${self}/${Number(spec.id) * 10 + index}`,
      id: String(Number(spec.id) * 10 + index),
      author,
      body: body(entry.body, api),
      updateAuthor: author,
      created: at,
      updated: at,
      jsdPublic: true,
    };
  });
  return { comments, self, maxResults: comments.length, total: comments.length, startAt: 0 };
}
