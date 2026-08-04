import { readFile } from "node:fs/promises";
import type { GitHubAssignedPullRequest, GitHubPullRequestClient } from "./types.ts";

interface GitHubFixtureClientOptions {
  fixturesPath: string;
}

interface GitHubFixturePullRequest extends GitHubAssignedPullRequest {
  assignees?: string[];
}

interface GitHubFixtureData {
  assignedPullRequests?: GitHubFixturePullRequest[];
}

export const createGitHubFixtureClient = (
  options: GitHubFixtureClientOptions,
): GitHubPullRequestClient => ({
  listAssignedPullRequests: async ({ userLogin }) => {
    const fixtures = await loadFixtures(options.fixturesPath);
    const normalizedLogin = userLogin.trim().toLowerCase();

    return (fixtures.assignedPullRequests ?? [])
      .filter((pullRequest) =>
        (pullRequest.assignees ?? [pullRequest.author ?? ""]).some(
          (assignee) => assignee.trim().toLowerCase() === normalizedLogin,
        ),
      )
      .map(({ assignees: _assignees, ...pullRequest }) => pullRequest);
  },
});

const loadFixtures = async (fixturesPath: string): Promise<GitHubFixtureData> => {
  const content = await readFile(fixturesPath, "utf-8");
  const parsed = JSON.parse(content) as GitHubFixtureData;

  return {
    assignedPullRequests: parsed.assignedPullRequests ?? [],
  };
};
