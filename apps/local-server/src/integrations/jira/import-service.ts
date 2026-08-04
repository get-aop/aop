import type { LocalServerContext } from "../../context.ts";
import { initRepo } from "../../repo/handlers.ts";
import { assertImportAgent } from "../external-issues/import-agent.ts";
import type { CreateJiraClientOptions } from "./client.ts";
import { createJiraImporter } from "./importer.ts";
import { createJiraIssueResolver } from "./issue-resolver.ts";
import { createRuntimeJiraClient } from "./runtime-client.ts";
import type { JiraIssueClient } from "./types.ts";

interface CreateJiraImportServiceOptions {
  ctx: LocalServerContext;
  siteUrl?: string;
  email?: string;
  apiToken?: string;
  getConfig?: () => Promise<CreateJiraClientOptions> | CreateJiraClientOptions;
  createClient?: (options: CreateJiraClientOptions) => JiraIssueClient;
}

export const createJiraImportService = (options: CreateJiraImportServiceOptions) => ({
  importFromInput: async (params: { cwd: string; input: string; agentId: string }) => {
    const repo = await initRepo(options.ctx, params.cwd);
    if (!repo.success) {
      throw new Error(`Not a git repository: ${params.cwd}`);
    }
    await assertImportAgent(options.ctx, repo.repoId, params.agentId);

    const clientFactory = options.createClient ?? createRuntimeJiraClient;
    const config = (await options.getConfig?.()) ?? {};
    const client = clientFactory({
      ...config,
      siteUrl: options.siteUrl ?? config.siteUrl,
      email: options.email ?? config.email,
      apiToken: options.apiToken ?? config.apiToken,
    });
    const resolver = createJiraIssueResolver({ client });
    const importer = createJiraImporter({
      repoRepository: options.ctx.repoRepository,
      taskRepository: options.ctx.taskRepository,
      externalIssueStore: options.ctx.externalIssueStore,
      ctx: options.ctx,
      resolveIssuesByRefs: (refs) => resolver.resolve(refs.join(", ")),
    });
    const issues = await resolver.resolve(params.input);
    const result = await importer.importIssues({
      repoId: repo.repoId,
      issues,
      agentId: params.agentId,
    });

    return {
      repoId: repo.repoId,
      alreadyExists: repo.alreadyExists,
      ...result,
    };
  },
});

export type { CreateJiraClientOptions } from "./client.ts";
