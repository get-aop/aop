import type { GithubAuth, SetupCheck } from "@aop/common";

/**
 * "GitHub": the host's own `gh` login, which every project's GitHub views and pull requests go
 * through (github/service.ts), so a paired device needs none of its own.
 */
export const githubCheck = (auth: GithubAuth, host: string): SetupCheck => {
  if (auth.authenticated) {
    return {
      id: "github",
      state: "ok",
      title: "GitHub",
      detail: `gh signed in as ${auth.login}`,
      actions: [],
    };
  }
  switch (auth.reason) {
    case "gh-missing":
      return notReady("error", "gh isn't installed.", [
        `Install the GitHub CLI on ${host} (https://cli.github.com), then sign in:`,
      ]);
    case "signed-out":
      return notReady("error", "gh isn't signed in.", [`On ${host}, sign in to GitHub:`]);
    case "unreachable":
      return notReady(
        "warning",
        `gh couldn't reach GitHub: ${firstLine(auth.message)}`,
        [`On ${host}, check that gh is signed in and can reach GitHub:`],
        "gh auth status",
      );
  }
};

const notReady = (
  state: "error" | "warning",
  detail: string,
  steps: string[],
  command = "gh auth login",
): SetupCheck => ({
  id: "github",
  state,
  title: "GitHub",
  detail,
  actions: [{ kind: "how-to", steps, command }],
});

const firstLine = (message: string): string => message.trim().split("\n")[0] ?? "";
