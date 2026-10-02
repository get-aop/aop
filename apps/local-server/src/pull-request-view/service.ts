import { homedir } from "node:os";
import type {
  AuthPrincipal,
  PullRequestCommentBody,
  PullRequestMergeBody,
  PullRequestReviewBody,
  PullRequestUpdateBody,
  PullRequestViewChecksResponse,
  PullRequestViewDetail,
  PullRequestViewFilesResponse,
  PullRequestViewViewer,
} from "@aop/common";
import { defaultGhRunner } from "../command-runner.ts";
import type { GithubService } from "../github/index.ts";
import type { GhRead } from "../github-cli/read.ts";
import type { RunGh } from "../github-cli/run-gh.ts";
import { checksPartOf, detailOf } from "./detail.ts";
import { createEtagReads } from "./etag-reads.ts";
import { readPullRequestFiles } from "./files.ts";
import {
  CHECKS_QUERY,
  ChecksDataSchema,
  DETAIL_QUERY,
  DetailDataSchema,
  type RawRepo,
} from "./queries.ts";
import { type BranchRules, NO_RULES, parseBranchRules } from "./rules.ts";
import { commentOn, merge, type PullRequestTarget, review, update } from "./writes.ts";

/** Which pull request a request is about, as the route names it. */
export interface PullRequestAddress {
  projectId: string;
  repoId: string;
  number: number;
}

export type PullRequestViewError =
  | { code: "PROJECT_NOT_FOUND" }
  | { code: "REPO_NOT_IN_PROJECT"; repoId: string }
  | { code: "NO_GITHUB_REMOTE"; name: string }
  | { code: "GITHUB_NOT_CONNECTED"; reason: string; message: string }
  | { code: "PULL_REQUEST_NOT_FOUND"; nameWithOwner: string; number: number }
  | { code: "GITHUB_RATE_LIMITED"; message: string }
  | { code: "GITHUB_FAILED"; message: string }
  /** GitHub said no to a write (a ruleset, a moved head, a permission), in its own words. */
  | { code: "GITHUB_REFUSED"; message: string }
  | { code: "READ_ONLY"; message: string };

export type PullRequestViewResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: PullRequestViewError };

export interface PullRequestViewService {
  detail: (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    options?: { refresh?: boolean },
  ) => Promise<PullRequestViewResult<PullRequestViewDetail>>;
  checks: (
    address: PullRequestAddress,
  ) => Promise<PullRequestViewResult<PullRequestViewChecksResponse>>;
  files: (
    address: PullRequestAddress,
  ) => Promise<PullRequestViewResult<PullRequestViewFilesResponse>>;
  comment: (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    body: PullRequestCommentBody,
  ) => Promise<PullRequestViewResult<null>>;
  review: (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    body: PullRequestReviewBody,
  ) => Promise<PullRequestViewResult<null>>;
  merge: (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    body: PullRequestMergeBody,
  ) => Promise<PullRequestViewResult<null>>;
  update: (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    body: PullRequestUpdateBody,
  ) => Promise<PullRequestViewResult<null>>;
}

export interface PullRequestViewDeps {
  github: GithubService;
  runGh?: RunGh;
  now?: () => number;
}

// Short: the page has a Refresh button, and a write marks its pull request stale at once.
const DETAIL_TTL_MS = 10_000;
const CHECKS_TTL_MS = 5_000;
const WRITE_PERMISSIONS = new Set(["WRITE", "MAINTAIN", "ADMIN"]);
const NOT_FOUND = /Could not resolve to a (PullRequest|Repository)/i;

/**
 * A pull request's page in AOP, read and acted on through the host's `gh`. Reads are one GraphQL
 * call (cached a few seconds, shared by every device asking) plus REST reads conditional on their
 * last ETag; writes are refused for anyone but the host owner and mark the page stale.
 */
export const createPullRequestViewService = ({
  github,
  runGh = defaultGhRunner,
  now = Date.now,
}: PullRequestViewDeps): PullRequestViewService => {
  const reads = createEtagReads(github);
  const stale = new Set<string>();
  const cwd = homedir();

  /** True once per write: the next read of `key` skips the cache. */
  const takeStale = (key: string): boolean => stale.delete(key);

  const target = async (
    address: PullRequestAddress,
  ): Promise<PullRequestViewResult<{ nameWithOwner: string; owner: string; name: string }>> => {
    const repos = await github.resolveProjectRepos(address.projectId);
    if (!repos) return fail({ code: "PROJECT_NOT_FOUND" });
    const repo = repos.find((candidate) => candidate.repoId === address.repoId);
    if (!repo) return fail({ code: "REPO_NOT_IN_PROJECT", repoId: address.repoId });
    if (!repo.nameWithOwner) return fail({ code: "NO_GITHUB_REMOTE", name: repo.name });
    const auth = await github.authStatus();
    if (!auth.authenticated) {
      return fail({ code: "GITHUB_NOT_CONNECTED", reason: auth.reason, message: auth.message });
    }
    const [owner = "", name = ""] = repo.nameWithOwner.split("/");
    return { ok: true, value: { nameWithOwner: repo.nameWithOwner, owner, name } };
  };

  const rulesFor = async (nameWithOwner: string, base: string): Promise<BranchRules> => {
    const read = await reads.get(
      `repos/${nameWithOwner}/rules/branches/${encodeURIComponent(base)}`,
    );
    // Rules only add reasons; a page whose rules could not be read still shows GitHub's own.
    return read.ok ? parseBranchRules(read.value) : NO_RULES;
  };

  const readDetail = async (address: PullRequestAddress, force: boolean) => {
    const resolved = await target(address);
    if (!resolved.ok) return resolved;
    const { nameWithOwner, owner, name } = resolved.value;
    const key = `pr-view:${nameWithOwner}#${address.number}`;
    const read = await github.graphql(
      DETAIL_QUERY,
      { owner, name, number: address.number },
      DetailDataSchema,
      { key, ttlMs: DETAIL_TTL_MS, force: takeStale(key) || force },
    );
    if (!read.ok) return fail(readError(read, nameWithOwner, address.number));
    const pr = read.value.repository?.pullRequest;
    if (!read.value.repository || !pr) {
      return fail({ code: "PULL_REQUEST_NOT_FOUND", nameWithOwner, number: address.number });
    }
    return {
      ok: true as const,
      value: { nameWithOwner, repo: read.value.repository, pr },
    };
  };

  // When the host answered; the routes leave it out of their ETag, so it never makes a 200 of a 304.
  const fetchedAt = (): string => new Date(now()).toISOString();

  const write = async (
    address: PullRequestAddress,
    principal: AuthPrincipal,
    act: (target: PullRequestTarget) => Promise<GhRead<string>>,
  ): Promise<PullRequestViewResult<null>> => {
    if (principal.kind !== "owner") return fail({ code: "READ_ONLY", message: DEVICE_READ_ONLY });
    const resolved = await target(address);
    if (!resolved.ok) return resolved;
    const { nameWithOwner } = resolved.value;
    const done = await act({ nameWithOwner, number: address.number, cwd });
    // Whatever GitHub answered, the page may be out of date now.
    stale.add(`pr-view:${nameWithOwner}#${address.number}`);
    stale.add(`pr-view-checks:${nameWithOwner}#${address.number}`);
    if (done.ok) return { ok: true, value: null };
    return fail(
      done.rateLimited
        ? { code: "GITHUB_RATE_LIMITED", message: done.message }
        : { code: "GITHUB_REFUSED", message: refusalOf(done.message) },
    );
  };

  return {
    detail: async (address, principal, { refresh = false } = {}) => {
      const read = await readDetail(address, refresh);
      if (!read.ok) return read;
      const { nameWithOwner, repo, pr } = read.value;
      const auth = await github.authStatus();
      return {
        ok: true,
        value: detailOf(pr, {
          repoId: address.repoId,
          nameWithOwner,
          repo,
          rules: await rulesFor(nameWithOwner, pr.baseRefName),
          viewer: viewerOf(principal, repo, auth.authenticated ? auth.login : null, nameWithOwner),
          fetchedAt: fetchedAt(),
        }),
      };
    },

    checks: async (address) => {
      const resolved = await target(address);
      if (!resolved.ok) return resolved;
      const { nameWithOwner, owner, name } = resolved.value;
      const key = `pr-view-checks:${nameWithOwner}#${address.number}`;
      const read = await github.graphql(
        CHECKS_QUERY,
        { owner, name, number: address.number },
        ChecksDataSchema,
        { key, ttlMs: CHECKS_TTL_MS, force: takeStale(key) },
      );
      if (!read.ok) return fail(readError(read, nameWithOwner, address.number));
      const head = read.value.repository?.pullRequest;
      if (!read.value.repository || !head) {
        return fail({ code: "PULL_REQUEST_NOT_FOUND", nameWithOwner, number: address.number });
      }
      return {
        ok: true,
        value: checksPartOf(head, {
          repo: read.value.repository,
          rules: await rulesFor(nameWithOwner, head.baseRefName),
          fetchedAt: fetchedAt(),
        }),
      };
    },

    files: async (address) => {
      const read = await readDetail(address, false);
      if (!read.ok) return read;
      const { nameWithOwner, pr } = read.value;
      const files = await readPullRequestFiles(
        reads,
        nameWithOwner,
        address.number,
        pr.changedFiles,
      );
      return files.ok ? files : fail(readError(files, nameWithOwner, address.number));
    },

    comment: (address, principal, body) =>
      write(address, principal, (pr) => commentOn(runGh, pr, body)),
    review: (address, principal, body) =>
      write(address, principal, (pr) => review(runGh, pr, body)),
    merge: (address, principal, body) => write(address, principal, (pr) => merge(runGh, pr, body)),
    update: (address, principal, body) =>
      write(address, principal, (pr) => update(runGh, pr, body)),
  };
};

const DEVICE_READ_ONLY =
  "This device can read pull requests; only the host machine's owner can act on them.";

const viewerOf = (
  principal: AuthPrincipal,
  repo: RawRepo,
  login: string | null,
  nameWithOwner: string,
): PullRequestViewViewer => {
  if (principal.kind !== "owner")
    return { canWrite: false, readOnlyReason: DEVICE_READ_ONLY, login };
  if (!WRITE_PERMISSIONS.has(repo.viewerPermission ?? "")) {
    return {
      canWrite: false,
      readOnlyReason: `${login ?? "The host's GitHub account"} cannot write to ${nameWithOwner}.`,
      login,
    };
  }
  return { canWrite: true, readOnlyReason: null, login };
};

const readError = (
  read: { message: string; rateLimited: boolean },
  nameWithOwner: string,
  number: number,
): PullRequestViewError => {
  if (read.rateLimited) return { code: "GITHUB_RATE_LIMITED", message: read.message };
  if (NOT_FOUND.test(read.message))
    return { code: "PULL_REQUEST_NOT_FOUND", nameWithOwner, number };
  return { code: "GITHUB_FAILED", message: read.message };
};

/** `gh api` prints "gh: <GitHub's message> (HTTP 405)"; the person needs only the message. */
const refusalOf = (message: string): string =>
  message.replace(/^gh:\s*/, "").replace(/\s*\(HTTP \d{3}\)\s*$/, "") || message;

const fail = (error: PullRequestViewError): { ok: false; error: PullRequestViewError } => ({
  ok: false,
  error,
});
