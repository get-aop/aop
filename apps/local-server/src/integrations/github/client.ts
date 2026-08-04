import { createSign } from "node:crypto";
import type { GitHubAssignedPullRequest, GitHubPullRequestClient } from "./types.ts";

interface GitHubClientOptions {
  appId: string;
  privateKey: string;
  installationId: string;
  fetchImpl?: typeof fetch;
}

interface AccessTokenResponse {
  token?: string;
  message?: string;
}

interface GitHubSearchIssueItem {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  repository_url?: string;
  user?: { login?: string | null } | null;
  updated_at: string;
}

interface GitHubSearchResponse {
  items?: GitHubSearchIssueItem[];
  message?: string;
}

export const createGitHubClient = (options: GitHubClientOptions): GitHubPullRequestClient => ({
  listAssignedPullRequests: async ({ userLogin }) => {
    const token = await createInstallationToken(options);
    const query = new URLSearchParams({
      q: `is:pr is:open archived:false assignee:${userLogin}`,
      per_page: "20",
      sort: "updated",
      order: "desc",
    });
    const response = await requestGitHub<GitHubSearchResponse>(
      `https://api.github.com/search/issues?${query}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
      options.fetchImpl,
    );

    return (response.items ?? []).map(
      (item): GitHubAssignedPullRequest => ({
        id: `github-pr-${item.id}`,
        repo: repoFromApiUrl(item.repository_url),
        number: item.number,
        title: item.title,
        state: item.state,
        url: item.html_url,
        author: item.user?.login ?? null,
        reviewContext: `Assigned to ${userLogin}`,
        updatedAt: item.updated_at,
      }),
    );
  },
});

const createInstallationToken = async (options: GitHubClientOptions): Promise<string> => {
  const jwt = createAppJwt(options.appId, options.privateKey);
  const response = await requestGitHub<AccessTokenResponse>(
    `https://api.github.com/app/installations/${options.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${jwt}`,
      },
    },
    options.fetchImpl,
  );

  if (!response.token) {
    throw new Error("GitHub App token response did not include a token");
  }

  return response.token;
};

const createAppJwt = (appId: string, privateKey: string): string => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({ iat: now - 60, exp: now + 9 * 60, iss: appId });
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  return `${signingInput}.${signer.sign(normalizePrivateKey(privateKey)).toString("base64url")}`;
};

const normalizePrivateKey = (privateKey: string): string => privateKey.replaceAll("\\n", "\n");

const base64UrlJson = (value: Record<string, string | number>): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const requestGitHub = async <T>(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<T> => {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...init.headers,
    },
  });
  const data = (await response.json()) as T & { message?: string };

  if (!response.ok) {
    throw new Error(data.message ?? `GitHub request failed with status ${response.status}`);
  }

  return data;
};

const repoFromApiUrl = (repositoryUrl?: string): string => {
  if (!repositoryUrl) return "unknown/repository";
  const parts = repositoryUrl.split("/").filter(Boolean);
  const owner = parts.at(-2);
  const repo = parts.at(-1);
  return owner && repo ? `${owner}/${repo}` : "unknown/repository";
};
