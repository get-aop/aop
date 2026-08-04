import type { LocalServerContext } from "../../context.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import { assignTaskWorker } from "../../task/handlers.ts";
import type { TaskRepository } from "../../task/repository.ts";
import { toTaskSlug } from "../../task-docs/scaffold.ts";
import {
  createExternalIssueImporter,
  createProviderIssueImportStore,
  type ExternalIssueImportFailure,
  type ExternalIssueImportRecord,
  type ExternalIssueImportResult,
} from "../external-issues/importer.ts";
import { buildJiraIssueSourceText } from "../external-issues/source-text.ts";
import type { ExternalIssueStore } from "../external-issues/store.ts";
import type { JiraResolvedIssue } from "./types.ts";

const JIRA_PROVIDER = "jira";

export type JiraImportRecord = ExternalIssueImportRecord;
export type JiraImportFailure = ExternalIssueImportFailure;
export type JiraImportResult = ExternalIssueImportResult;

interface CreateJiraImporterOptions {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  externalIssueStore: ExternalIssueStore;
  ctx?: LocalServerContext;
  resolveIssuesByRefs(refs: string[]): Promise<JiraResolvedIssue[]>;
}

export const createJiraImporter = (options: CreateJiraImporterOptions) => {
  const ctx = options.ctx;
  return createExternalIssueImporter<JiraResolvedIssue>({
    provider: JIRA_PROVIDER,
    missingBlockersLabel: "Jira blockers",
    repoRepository: options.repoRepository,
    taskRepository: options.taskRepository,
    issueStore: createProviderIssueImportStore(options.externalIssueStore, JIRA_PROVIDER),
    resolveIssuesByRefs: options.resolveIssuesByRefs,
    buildTaskBody: buildImportedTaskBody,
    buildIssuesMarkdown: buildIssueIssuesMarkdown,
    buildTaskTags: buildIssueTags,
    mapPriority: mapJiraPriority,
    assignTaskToAgent: ctx
      ? (repoId, taskId, agentId) => assignImportedTask(ctx, repoId, taskId, agentId)
      : undefined,
  });
};

const buildImportedTaskBody = (issue: JiraResolvedIssue): string => {
  const sourceText = buildJiraIssueSourceText(issue);
  return [
    "",
    "## Description",
    "",
    sourceText,
    "",
    "## Requirements",
    "",
    "- Review `issues.md`; it was derived from Jira.",
    "- Use `task.md` for source metadata and `issues.md` for the implementation plan.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] Complete the imported work described in `issues.md`.",
    "",
  ].join("\n");
};

const buildIssueIssuesMarkdown = (issue: JiraResolvedIssue): string => {
  const sourceText = buildJiraIssueSourceText(issue);
  return [
    `# ${issue.ref}: ${issue.title}`,
    "",
    "## Agent Brief",
    "",
    "### Current Behavior",
    "",
    sourceText || "Imported Jira issue did not include a description.",
    "",
    "### Desired Behavior",
    "",
    "- Complete the imported Jira issue.",
    "",
    "### Key Interfaces",
    "",
    `- Source issue: ${issue.ref} (${issue.url})`,
    "",
    "### Acceptance Criteria",
    "",
    "- [ ] Imported issue is resolved in the implementation.",
    "- [ ] Relevant verification is run and recorded.",
    "",
    "### Out of Scope",
    "",
    "- Publishing updates back to Jira unless explicitly requested.",
    "",
  ].join("\n");
};

const assignImportedTask = async (
  ctx: LocalServerContext,
  repoId: string,
  taskId: string,
  agentId: string,
): Promise<void> => {
  const result = await assignTaskWorker(ctx, repoId, taskId, agentId);
  if (!result.success) {
    throw new Error(`Failed to assign imported Jira task '${taskId}': ${result.error.code}`);
  }
};

const buildIssueTags = (issue: JiraResolvedIssue): string[] => {
  const tags = new Set<string>([JIRA_PROVIDER]);
  const projectKey = issue.project?.key.toLowerCase() ?? null;

  if (projectKey) {
    tags.add(projectKey);
  }

  if (issue.project?.name) {
    tags.add(toTag(issue.project.name));
    addTokenTags(tags, issue.project.name, projectKey);
  }

  if (issue.team?.name) {
    tags.add(toTag(issue.team.name));
    addTokenTags(tags, issue.team.name, projectKey);
  }

  addTokenTags(tags, `${issue.ref} ${issue.title}`, projectKey);

  return [...tags].filter((tag) => tag.length > 0);
};

const addTokenTags = (tags: Set<string>, value: string, projectKey: string | null): void => {
  for (const token of value.split(/[^A-Za-z0-9]+/)) {
    const normalized = toTag(token);
    if (isUsefulTokenTag(normalized, projectKey)) {
      tags.add(normalized);
    }
  }
};

const isUsefulTokenTag = (tag: string, projectKey: string | null): boolean => {
  if (tag.length < 3) {
    return false;
  }

  if (projectKey && tag.startsWith(`${projectKey}-`)) {
    return false;
  }

  return true;
};

const toTag = (value: string): string => toTaskSlug(value).trim().replaceAll(/^-|-$/g, "");

const mapJiraPriority = (issue: JiraResolvedIssue): string => {
  const priority = issue.priority?.name.toLowerCase() ?? "";

  if (priority.includes("highest") || priority.includes("urgent")) {
    return "urgent";
  }
  if (priority.includes("high")) {
    return "high";
  }
  if (priority.includes("low")) {
    return "low";
  }

  return "medium";
};
