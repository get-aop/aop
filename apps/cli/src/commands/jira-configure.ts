import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "jira-configure");

interface JiraConfigureOptions {
  siteUrl?: string;
  email?: string;
  apiToken?: string;
}

interface SettingEntry {
  key: string;
  value: string;
}

interface SetSettingsResponse {
  ok: boolean;
  settings: SettingEntry[];
}

export const jiraConfigureCommand = async (options: JiraConfigureOptions): Promise<void> => {
  await requireServer();

  const settings: SettingEntry[] = [];
  if (options.siteUrl !== undefined) {
    settings.push({ key: "jira_site_url", value: options.siteUrl });
  }
  if (options.email !== undefined) {
    settings.push({ key: "jira_email", value: options.email });
  }
  if (options.apiToken !== undefined) {
    settings.push({ key: "jira_api_token", value: options.apiToken });
  }

  if (settings.length === 0) {
    logger.error("Provide --site-url, --email, --api-token, or any combination.");
    process.exit(1);
  }

  const result = await fetchServer<SetSettingsResponse>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings }),
  });

  if (!result.ok) {
    logger.error("Failed to update Jira settings: {error}", { error: result.error.error });
    process.exit(1);
  }

  logger.info("Jira settings updated");
};
