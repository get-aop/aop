import type { GithubProjectRepo, GithubStatusResponse } from "@aop/common";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { request } from "../../api/request";
import { openPullRequestView, type PullRequestViewTarget } from "./open-pull-request-view";

/** What a pull request link in this project opens: the PR View, when the pull request is one of its repositories'. */
export interface PullRequestLinks {
  /** The PR View target of a link, or null for a link the view cannot show (another repository, not a pull request). */
  targetOf: (url: string | undefined, repoId?: string | null) => PullRequestViewTarget | null;
}

const PullRequestLinksContext = createContext<PullRequestLinks | null>(null);

/**
 * Makes every pull request link and chip inside it (chat, threads panel, the view itself) open
 * the PR View instead of GitHub when the pull request belongs to one of the project's
 * repositories. It asks the host once which `owner/name` each repository has on GitHub.
 */
export const PullRequestLinksProvider = ({
  projectId,
  repoIds,
  children,
}: {
  projectId: string;
  repoIds: readonly string[];
  children: ReactNode;
}) => {
  const repos = useGithubRepos(projectId, repoIds.join(","));
  const value = useMemo<PullRequestLinks>(
    () => ({ targetOf: (url, repoId) => targetOf(projectId, repos, url, repoId) }),
    [projectId, repos],
  );
  return (
    <PullRequestLinksContext.Provider value={value}>{children}</PullRequestLinksContext.Provider>
  );
};

export const usePullRequestLinks = (): PullRequestLinks | null =>
  useContext(PullRequestLinksContext);

/**
 * A click handler for a link to `target`: a plain click shows the pull request here; a modified
 * click (new tab, new window) is left to the browser, which opens GitHub.
 */
export const openInView =
  (target: PullRequestViewTarget | null) =>
  (event: MouseEvent<HTMLAnchorElement>): void => {
    if (!target || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    openPullRequestView(target);
  };

const PULL_URL = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#].*)?$/i;

/** `owner/name` and number of a GitHub pull request URL, or null for any other URL. */
export const parsePullRequestUrl = (
  url: string | undefined,
): { nameWithOwner: string; number: number } | null => {
  const match = url ? PULL_URL.exec(url) : null;
  return match?.[1] && match[2] ? { nameWithOwner: match[1], number: Number(match[2]) } : null;
};

export const targetOf = (
  projectId: string,
  repos: readonly GithubProjectRepo[],
  url: string | undefined,
  repoId?: string | null,
): PullRequestViewTarget | null => {
  const parsed = parsePullRequestUrl(url);
  if (!parsed) return null;
  // The thread's own repository is known; a bare link is matched by where it lives on GitHub.
  const repo = repoId
    ? { repoId }
    : repos.find(
        (candidate) =>
          candidate.nameWithOwner?.toLowerCase() === parsed.nameWithOwner.toLowerCase(),
      );
  return repo ? { projectId, repoId: repo.repoId, number: parsed.number } : null;
};

const useGithubRepos = (projectId: string, repoKey: string): GithubProjectRepo[] => {
  const [repos, setRepos] = useState<GithubProjectRepo[]>([]);
  useEffect(() => {
    void repoKey;
    let current = true;
    request<GithubStatusResponse>(`/projects/${encodeURIComponent(projectId)}/github/status`).then(
      (status) => current && setRepos(status.repos),
      // Without it, bare links open GitHub as before; chips that know their repository still work.
      () => current && setRepos([]),
    );
    return () => {
      current = false;
    };
  }, [projectId, repoKey]);
  return repos;
};
