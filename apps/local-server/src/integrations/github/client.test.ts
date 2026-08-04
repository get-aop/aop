import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { createGitHubClient } from "./client.ts";

const createMockGitHubFetch = (): typeof fetch => {
  const fetchImpl = (async (input: string | Request | URL) => {
    const url = String(input);
    if (url.endsWith("/app/installations/987/access_tokens")) {
      return Response.json({ token: "installation-token" });
    }

    if (url.startsWith("https://api.github.com/search/issues?")) {
      return Response.json({
        items: [
          {
            id: 123,
            number: 45,
            title: "Review assigned PR",
            state: "open",
            html_url: "https://github.com/get-aop/aop-mono/pull/45",
            repository_url: "https://api.github.com/repos/get-aop/aop-mono",
            user: { login: "octocat" },
            updated_at: "2026-05-15T12:00:00.000Z",
          },
        ],
      });
    }

    return Response.json({ message: `unexpected ${url}` }, { status: 500 });
  }) as typeof fetch;

  return fetchImpl;
};

describe("GitHub App client", () => {
  test("accepts private keys saved with escaped newlines and maps assigned PRs", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const escapedPrivateKey = privateKey
      .export({ type: "pkcs1", format: "pem" })
      .toString()
      .replaceAll("\n", "\\n");

    const client = createGitHubClient({
      appId: "12345",
      privateKey: escapedPrivateKey,
      installationId: "987",
      fetchImpl: createMockGitHubFetch(),
    });

    await expect(client.listAssignedPullRequests({ userLogin: "get-aop-user" })).resolves.toEqual([
      {
        id: "github-pr-123",
        repo: "get-aop/aop-mono",
        number: 45,
        title: "Review assigned PR",
        state: "open",
        url: "https://github.com/get-aop/aop-mono/pull/45",
        author: "octocat",
        reviewContext: "Assigned to get-aop-user",
        updatedAt: "2026-05-15T12:00:00.000Z",
      },
    ]);
  });
});
