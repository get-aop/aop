import type { LocalServerContext } from "../../context.ts";
import type { RepoRepository } from "../../repo/repository.ts";
import { assignTaskWorker } from "../../task/handlers.ts";
import type { TaskRepository } from "../../task/repository.ts";
import {
  createExternalIssueImporter,
  type ExternalIssueImportFailure,
  type ExternalIssueImportRecord,
  type ExternalIssueImportResult,
} from "../external-issues/importer.ts";
import { buildLinearIssueSourceText } from "../external-issues/source-text.ts";
import type { LinearStore } from "./store.ts";
import type { LinearResolvedIssue } from "./types.ts";

const LINEAR_PROVIDER = "linear";

export type LinearImportRecord = ExternalIssueImportRecord;
export type LinearImportFailure = ExternalIssueImportFailure;
export type LinearImportResult = ExternalIssueImportResult;

interface CreateLinearImporterOptions {
  repoRepository: RepoRepository;
  taskRepository: TaskRepository;
  linearStore: LinearStore;
  ctx?: LocalServerContext;
  resolveIssuesByRefs(refs: string[]): Promise<LinearResolvedIssue[]>;
}

export const createLinearImporter = (options: CreateLinearImporterOptions) => {
  const ctx = options.ctx;
  return createExternalIssueImporter<LinearResolvedIssue>({
    provider: LINEAR_PROVIDER,
    missingBlockersLabel: "Linear blockers",
    repoRepository: options.repoRepository,
    taskRepository: options.taskRepository,
    issueStore: options.linearStore,
    resolveIssuesByRefs: options.resolveIssuesByRefs,
    buildTaskBody: buildImportedTaskBody,
    buildIssuesMarkdown: buildIssueIssuesMarkdown,
    buildTaskTags: buildIssueTags,
    mapPriority: mapLinearPriority,
    assignTaskToAgent: ctx
      ? (repoId, taskId, agentId) => assignImportedTask(ctx, repoId, taskId, agentId)
      : undefined,
  });
};

const buildImportedTaskBody = (issue: LinearResolvedIssue): string => {
  const sourceText = buildLinearIssueSourceText(issue);
  return [
    "",
    "## Description",
    "",
    sourceText,
    "",
    "## Requirements",
    "",
    "- Review `issues.md`; it was derived from Linear.",
    "- Use `task.md` for source metadata and `issues.md` for the implementation plan.",
    "",
    "## Acceptance Criteria",
    "",
    "- [ ] Complete the imported work described in `issues.md`.",
    "",
  ].join("\n");
};

const buildIssueIssuesMarkdown = (issue: LinearResolvedIssue): string => {
  const sourceText = buildLinearIssueSourceText(issue);
  return [
    `# ${issue.ref}: ${issue.title}`,
    "",
    "## Agent Brief",
    "",
    "### Current Behavior",
    "",
    sourceText || "Imported Linear issue did not include a description.",
    "",
    "### Desired Behavior",
    "",
    "- Complete the imported Linear issue.",
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
    "- Publishing updates back to Linear unless explicitly requested.",
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
    throw new Error(`Failed to assign imported Linear task '${taskId}': ${result.error.code}`);
  }
};

const buildIssueTags = (issue: LinearResolvedIssue): string[] => {
  const tags = new Set<string>([LINEAR_PROVIDER]);

  if (issue.team?.key) {
    tags.add(issue.team.key.toLowerCase());
  }

  if (issue.project?.name) {
    tags.add(toTag(issue.project.name));
  }

  for (const token of `${issue.ref} ${issue.title}`.split(/[^A-Za-z0-9]+/)) {
    const normalized = toTag(token);
    if (normalized.length >= 3 && !normalized.startsWith("get-")) {
      tags.add(normalized);
    }
  }

  return [...tags];
};

const toTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-");

const mapLinearPriority = (issue: LinearResolvedIssue): string => {
  switch (issue.priority) {
    case 1:
      return "urgent";
    case 2:
      return "high";
    case 3:
      return "medium";
    case 4:
      return "low";
    default:
      return "medium";
  }
};
