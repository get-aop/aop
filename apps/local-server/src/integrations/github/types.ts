export interface GitHubAppStatus {
  configured: boolean;
  connected: boolean;
  installationId?: string;
  accountLogin?: string;
  userLogin?: string;
}

export interface GitHubAssignedPullRequest {
  id: string;
  repo: string;
  number: number;
  title: string;
  state: string;
  url: string;
  author: string | null;
  reviewContext: string;
  updatedAt: string;
}

export interface GitHubAppCallbackParams {
  installationId?: string | null;
  setupAction?: string | null;
  accountLogin?: string | null;
  userLogin?: string | null;
}

export interface GitHubPullRequestClient {
  listAssignedPullRequests(params: { userLogin: string }): Promise<GitHubAssignedPullRequest[]>;
}
