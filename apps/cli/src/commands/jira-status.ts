import { getLogger } from "@aop/infra";
import { fetchServer, requireServer } from "./client.ts";

const logger = getLogger("cli", "jira-status");

interface JiraStatusResponse {
  configured: boolean;
  siteUrl: string | null;
  email: string | null;
}

interface JiraConnectionInfo {
  ok: boolean;
  siteUrl: string;
  accountId: string;
  accountDisplayName: string;
  accountEmail: string;
}

export const jiraStatusCommand = async (): Promise<void> => {
  await requireServer();

  const statusResult = await fetchServer<JiraStatusResponse>("/api/jira/status");
  if (!statusResult.ok) {
    logger.error("Failed to load Jira status: {error}", { error: statusResult.error.error });
    process.exit(1);
  }

  if (!statusResult.data.configured) {
    logger.info("Jira: not configured");
    return;
  }

  const infoResult = await fetchServer<JiraConnectionInfo>("/api/jira/test-connection", {
    method: "POST",
  });
  if (!infoResult.ok) {
    logger.error("Failed to test Jira connection: {error}", { error: infoResult.error.error });
    process.exit(1);
  }

  logger.info("Jira: configured");
  logger.info("Site: {siteUrl}", { siteUrl: infoResult.data.siteUrl });
  logger.info("Account: {accountDisplayName}", {
    accountDisplayName: infoResult.data.accountDisplayName,
  });
  logger.info("Email: {accountEmail}", { accountEmail: infoResult.data.accountEmail });
};
