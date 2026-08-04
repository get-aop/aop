import type { LocalServerContext } from "../../context.ts";
import { SettingKey } from "../../settings/types.ts";
import { createGitHubClient } from "./client.ts";
import { createGitHubFixtureClient } from "./fixture-client.ts";
import type {
  GitHubAppCallbackParams,
  GitHubAppStatus,
  GitHubAssignedPullRequest,
  GitHubPullRequestClient,
} from "./types.ts";

export const getGitHubStatus = async (ctx: LocalServerContext): Promise<GitHubAppStatus> => {
  const [appId, privateKey, installationId, accountLogin, userLogin] = await Promise.all([
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_ID),
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_PRIVATE_KEY),
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_INSTALLATION_ID),
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_ACCOUNT_LOGIN),
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_USER_LOGIN),
  ]);

  return {
    configured: Boolean(appId.trim() && privateKey.trim()),
    connected: Boolean(installationId.trim()),
    ...(installationId.trim() ? { installationId: installationId.trim() } : {}),
    ...(accountLogin.trim() ? { accountLogin: accountLogin.trim() } : {}),
    ...(userLogin.trim() ? { userLogin: userLogin.trim() } : {}),
  };
};

export const handleGitHubAppCallback = async (
  ctx: LocalServerContext,
  params: GitHubAppCallbackParams,
): Promise<GitHubAppStatus> => {
  const installationId = params.installationId?.trim();
  if (!installationId) {
    throw new Error("Missing GitHub installation id");
  }

  await ctx.settingsRepository.set(SettingKey.GITHUB_APP_INSTALLATION_ID, installationId);
  if (params.accountLogin?.trim()) {
    await ctx.settingsRepository.set(
      SettingKey.GITHUB_APP_ACCOUNT_LOGIN,
      params.accountLogin.trim(),
    );
  }
  if (params.userLogin?.trim()) {
    await ctx.settingsRepository.set(SettingKey.GITHUB_APP_USER_LOGIN, params.userLogin.trim());
  }

  return getGitHubStatus(ctx);
};

export const syncAssignedPullRequests = async (
  ctx: LocalServerContext,
  params: { userLogin?: string },
): Promise<GitHubAssignedPullRequest[]> => {
  const status = await getGitHubStatus(ctx);
  const userLogin = params.userLogin?.trim() || status.userLogin;
  if (!userLogin) {
    throw new Error("GitHub user login is required before syncing assigned PRs");
  }

  const client = await createRuntimeGitHubClient(ctx, status);
  return client.listAssignedPullRequests({ userLogin });
};

const createRuntimeGitHubClient = async (
  ctx: LocalServerContext,
  status: GitHubAppStatus,
): Promise<GitHubPullRequestClient> => {
  const fixturesPath = process.env.AOP_TEST_GITHUB_FIXTURES_PATH?.trim();
  if (process.env.AOP_TEST_MODE === "true" && fixturesPath) {
    return createGitHubFixtureClient({ fixturesPath });
  }

  if (!status.configured) {
    throw new Error("GitHub App credentials are not configured");
  }
  if (!status.installationId) {
    throw new Error("GitHub App installation is not connected");
  }

  const [appId, privateKey] = await Promise.all([
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_ID),
    ctx.settingsRepository.get(SettingKey.GITHUB_APP_PRIVATE_KEY),
  ]);

  return createGitHubClient({
    appId,
    privateKey,
    installationId: status.installationId,
  });
};
