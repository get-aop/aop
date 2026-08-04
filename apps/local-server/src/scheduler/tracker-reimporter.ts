import type { LocalServerContext } from "../context.ts";
import type { TaskSource } from "../db/schema.ts";
import { getJiraStatus, resolveJiraClientOptions } from "../integrations/jira/config.ts";
import { createJiraImporter } from "../integrations/jira/importer.ts";
import { createJiraIssueResolver } from "../integrations/jira/issue-resolver.ts";
import { createRuntimeJiraClient } from "../integrations/jira/runtime-client.ts";
import type { JiraResolvedIssue } from "../integrations/jira/types.ts";
import { getLinearAccessToken } from "../integrations/linear/access-token.ts";
import { createLinearImporter } from "../integrations/linear/importer.ts";
import { createLinearIssueResolver } from "../integrations/linear/issue-resolver.ts";
import { createRuntimeLinearClient } from "../integrations/linear/runtime-client.ts";
import type { LinearResolvedIssue } from "../integrations/linear/types.ts";
import type { TrackerReimporter, TrackerReimportFailure } from "./service.ts";

type TrackerProvider = "jira" | "linear";

interface CreateTrackerReimporterOptions {
  ctx: LocalServerContext;
  resolveJiraIssuesByRefs?: (refs: string[]) => Promise<JiraResolvedIssue[]>;
  resolveLinearIssuesByRefs?: (refs: string[]) => Promise<LinearResolvedIssue[]>;
}

interface ReimportGroup {
  provider: TrackerProvider;
  agentId: string;
  refs: string[];
}

interface ReimportGroupsResult {
  groups: ReimportGroup[];
  skipped: number;
}

export const createTrackerReimporter = (
  options: CreateTrackerReimporterOptions,
): TrackerReimporter => ({
  reimportRepo: async ({ repoId, allowedSources }) => {
    const { groups, skipped } = await buildReimportGroups(options, repoId, allowedSources);
    const result = await reimportGroups(options, repoId, groups);
    return { ...result, skipped };
  },
});

const buildReimportGroups = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  allowedSources: string[] | null,
): Promise<ReimportGroupsResult> => {
  const groups = new Map<string, ReimportGroup>();
  let skipped = 0;

  const sources = await options.ctx.externalIssueStore.listTaskSourcesByRepo(
    repoId,
    allowedSources ?? undefined,
  );

  for (const source of sources) {
    const sourceGroup = await resolveSourceGroup(options, source);
    if (!sourceGroup) {
      skipped++;
      continue;
    }

    const key = `${sourceGroup.provider}:${sourceGroup.agentId}`;
    const group = groups.get(key) ?? { ...sourceGroup, refs: [] };
    group.refs.push(source.external_ref);
    groups.set(key, group);
  }

  return { groups: [...groups.values()], skipped };
};

const resolveSourceGroup = async (
  options: CreateTrackerReimporterOptions,
  source: TaskSource,
): Promise<Omit<ReimportGroup, "refs"> | null> => {
  if (!isTrackerProvider(source.provider)) {
    return null;
  }

  const assignment = await options.ctx.taskAssignmentRepository.getCurrentByTaskId(source.task_id);
  if (!assignment?.agent_id) {
    return null;
  }

  return { provider: source.provider, agentId: assignment.agent_id };
};

const reimportGroups = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  groups: ReimportGroup[],
): Promise<{ imported: number; failures: TrackerReimportFailure[] }> => {
  let imported = 0;
  const failures: TrackerReimportFailure[] = [];

  for (const group of groups) {
    const result = await reimportGroupSafely(options, repoId, group);
    imported += result.imported.length;
    failures.push(...result.failures);
  }

  return { imported, failures };
};

const reimportGroupSafely = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  group: ReimportGroup,
): Promise<{ imported: unknown[]; failures: TrackerReimportFailure[] }> => {
  try {
    return await reimportGroup(options, repoId, group);
  } catch (error) {
    return {
      imported: [],
      failures: group.refs.map((ref) => ({
        provider: group.provider,
        ref,
        error: error instanceof Error ? error.message : "Tracker re-import failed",
      })),
    };
  }
};

const isTrackerProvider = (provider: string): provider is TrackerProvider =>
  provider === "linear" || provider === "jira";

const reimportGroup = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  group: ReimportGroup,
): Promise<{ imported: unknown[]; failures: TrackerReimportFailure[] }> => {
  if (group.provider === "linear") {
    return reimportLinearGroup(options, repoId, group);
  }
  return reimportJiraGroup(options, repoId, group);
};

const reimportLinearGroup = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  group: ReimportGroup,
) => {
  const resolveIssuesByRefs =
    options.resolveLinearIssuesByRefs ?? createDefaultLinearResolver(options.ctx);
  const importer = createLinearImporter({
    repoRepository: options.ctx.repoRepository,
    taskRepository: options.ctx.taskRepository,
    linearStore: options.ctx.linearStore,
    ctx: options.ctx,
    resolveIssuesByRefs,
  });
  const issues = await resolveIssuesByRefs(group.refs);
  const result = await importer.importIssues({ repoId, issues, agentId: group.agentId });
  return {
    imported: result.imported,
    failures: result.failures.map((failure) => ({
      provider: group.provider,
      ref: failure.ref,
      error: failure.error,
    })),
  };
};

const reimportJiraGroup = async (
  options: CreateTrackerReimporterOptions,
  repoId: string,
  group: ReimportGroup,
) => {
  const resolveIssuesByRefs =
    options.resolveJiraIssuesByRefs ?? createDefaultJiraResolver(options.ctx);
  const importer = createJiraImporter({
    repoRepository: options.ctx.repoRepository,
    taskRepository: options.ctx.taskRepository,
    externalIssueStore: options.ctx.externalIssueStore,
    ctx: options.ctx,
    resolveIssuesByRefs,
  });
  const issues = await resolveIssuesByRefs(group.refs);
  const result = await importer.importIssues({ repoId, issues, agentId: group.agentId });
  return {
    imported: result.imported,
    failures: result.failures.map((failure) => ({
      provider: group.provider,
      ref: failure.ref,
      error: failure.error,
    })),
  };
};

const createDefaultLinearResolver =
  (ctx: LocalServerContext) =>
  async (refs: string[]): Promise<LinearResolvedIssue[]> => {
    const client = createRuntimeLinearClient({
      apiKey: process.env.LINEAR_API_KEY,
      getAccessToken: async () => getLinearAccessToken(ctx),
    });
    return createLinearIssueResolver({ client }).resolve(refs.join(", "));
  };

const createDefaultJiraResolver =
  (ctx: LocalServerContext) =>
  async (refs: string[]): Promise<JiraResolvedIssue[]> => {
    const status = await getJiraStatus(ctx);
    if (!status.configured) {
      throw new Error("Jira is not configured");
    }
    const client = createRuntimeJiraClient(await resolveJiraClientOptions(ctx));
    return createJiraIssueResolver({ client }).resolve(refs.join(", "));
  };
