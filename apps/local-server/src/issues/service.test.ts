import { describe, expect, test } from "bun:test";
import type { GithubAuth, GithubProjectRepo, Message } from "@aop/common";
import { makeUserMessage } from "@aop/common/test-utils";
import type { GithubService } from "../github/index.ts";
import { createGithubIssueLoader } from "./github-issues.ts";
import { createLinearIssueLoader } from "./linear-issues.ts";
import { createIssueService } from "./service.ts";
import {
  githubNode,
  linearConnection,
  linearNode,
  memoryLinearStore,
  repoRef,
  SIGNED_IN,
  scriptedGithub,
  scriptedLinear,
} from "./test-utils.ts";

/** An issue service over scripted GitHub and Linear, and a coordinator that keeps what it is sent. */
const setup = (
  options: {
    repos?: GithubProjectRepo[] | null;
    auth?: GithubAuth;
    githubIssues?: ReturnType<typeof githubNode>[];
    githubFail?: string | null;
    linear?: Record<string, ReturnType<typeof linearConnection>>;
  } = {},
) => {
  const scripted = scriptedGithub({
    issues: options.githubIssues ?? [githubNode()],
    fail: options.githubFail ?? null,
  });
  const repos = options.repos === undefined ? [repoRef()] : options.repos;
  const github = {
    ...scripted.github,
    authStatus: async () => options.auth ?? SIGNED_IN,
    resolveProjectRepos: async (projectId: string) =>
      projectId === "proj_1" && repos ? repos.map((repo) => ({ ...repo, path: "/x" })) : null,
  } as Pick<GithubService, "authStatus" | "resolveProjectRepos" | "graphql" | "restGet">;
  const linear = scriptedLinear([linearNode()]);
  const store = memoryLinearStore(options.linear ?? {});
  const sent: string[] = [];
  const service = createIssueService({
    github,
    githubIssues: createGithubIssueLoader(github),
    linear: linear.api,
    linearIssues: createLinearIssueLoader(linear.api),
    linearStore: store.store,
    sendToCoordinator: async (_projectId, text) => {
      sent.push(text);
      return { success: true, message: makeUserMessage({ text }) as Message };
    },
  });
  return { service, sent, store, calls: scripted.calls, linearKeys: linear.keys };
};

const query = { state: "open" as const, limit: 100, refresh: false };

describe("listing a project's issues", () => {
  test("joins GitHub and Linear, newest update first, with each source's status", async () => {
    const { service } = setup({ linear: { proj_1: linearConnection() } });
    const result = await service.list("proj_1", query);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.list.issues.map((issue) => issue.key)).toEqual([
      "linear:ENG-7",
      "github:acme/app#12",
    ]);
    expect(
      result.list.sources.map(({ source, name, status }) => ({ source, name, status })),
    ).toEqual([
      { source: "github", name: "acme/app", status: "ok" },
      { source: "linear", name: "Engineering", status: "ok" },
    ]);
  });

  test("an unknown project is not found", async () => {
    const { service } = setup();
    expect(await service.list("nope", query)).toEqual({
      success: false,
      error: { code: "PROJECT_NOT_FOUND" },
    });
  });

  test("a repository off GitHub and Linear not connected are told, without a GitHub call for them", async () => {
    const { service, calls } = setup({ repos: [repoRef({ nameWithOwner: null, name: "notes" })] });
    const result = await service.list("proj_1", query);

    if (!result.success) throw new Error("expected a list");
    expect(result.list.sources.map(({ name, status }) => ({ name, status }))).toEqual([
      { name: "notes", status: "no-github-remote" },
      { name: "Linear", status: "not-configured" },
    ]);
    expect(calls).toEqual([]);
  });

  test("gh signed out, and gh missing, are their own statuses", async () => {
    const signedOut = setup({
      auth: { authenticated: false, reason: "signed-out", message: "run gh auth login" },
    });
    const missing = setup({
      auth: { authenticated: false, reason: "gh-missing", message: "spawn gh ENOENT" },
    });

    const a = await signedOut.service.list("proj_1", query);
    const b = await missing.service.list("proj_1", query);

    expect(a.success && a.list.sources[0]).toMatchObject({
      status: "not-authenticated",
      message: "run gh auth login",
    });
    expect(b.success && b.list.sources[0]).toMatchObject({ status: "gh-missing" });
    expect(signedOut.calls).toEqual([]);
  });

  test("a GitHub failure is an error status; one that asks for a login is not-authenticated", async () => {
    const outage = setup({ githubFail: "HTTP 502: Server Error" });
    const login = setup({ githubFail: "HTTP 401: Bad credentials" });

    const a = await outage.service.list("proj_1", query);
    const b = await login.service.list("proj_1", query);

    expect(a.success && a.list.sources[0]).toMatchObject({
      status: "error",
      message: "HTTP 502: Server Error",
      stale: false,
    });
    expect(b.success && b.list.sources[0]).toMatchObject({ status: "not-authenticated" });
  });

  test("a refused Linear key is unauthorized", async () => {
    const { service } = setup({ linear: { proj_1: linearConnection({ apiKey: "revoked" }) } });
    const result = await service.list("proj_1", query);
    expect(result.success && result.list.sources[1]).toMatchObject({
      status: "unauthorized",
      message: "Linear refused the API key",
    });
  });

  test("no answer carries the Linear key", async () => {
    const { service } = setup({ linear: { proj_1: linearConnection() } });
    const answers = [
      await service.list("proj_1", query),
      await service.linearConnection("proj_1"),
      await service.connectLinear("proj_1", { scope: linearConnection().scope }),
    ];
    for (const answer of answers) expect(JSON.stringify(answer)).not.toContain("lin_api_secret");
  });
});

describe("starting a thread from an issue", () => {
  test("sends the coordinator the issue's title, link and body, read fresh from GitHub", async () => {
    const { service, sent, calls } = setup({
      githubIssues: [githubNode({ number: 12, title: "Fix the flaky test" })],
    });

    const result = await service.startThread("proj_1", "github:acme/app#12");

    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("acme/app#12: Fix the flaky test");
    expect(sent[0]).toContain("https://github.com/acme/app/issues/12");
    expect(sent[0]).toContain("Steps to reproduce.");
    expect(calls).toEqual(["graphql issue #12"]);
  });

  test("starts from a Linear issue with the project's key", async () => {
    const { service, sent, linearKeys } = setup({ linear: { proj_1: linearConnection() } });
    const result = await service.startThread("proj_1", "linear:ENG-7");
    expect(result.success).toBe(true);
    expect(sent[0]).toContain("ENG-7: Ship the onboarding");
    expect(sent[0]).toContain("From Linear.");
    expect(linearKeys).toEqual(["lin_api_secret"]);
  });

  test("an issue of a repository the project does not hold, or a malformed or unknown key, is not found", async () => {
    const { service, sent } = setup();
    for (const key of [
      "github:other/repo#1",
      "github:acme/app#x",
      "jira:ABC-1",
      "github:acme/app#99",
    ]) {
      expect(await service.startThread("proj_1", key)).toEqual({
        success: false,
        error: { code: "ISSUE_NOT_FOUND", key },
      });
    }
    expect(sent).toEqual([]);
  });

  test("a Linear issue without a connection says Linear is not connected", async () => {
    const { service } = setup();
    expect(await service.startThread("proj_1", "linear:ENG-7")).toEqual({
      success: false,
      error: { code: "LINEAR_NOT_CONFIGURED" },
    });
  });
});

describe("the Linear connection", () => {
  test("connecting checks the key with Linear, keeps it on the host, and answers without it", async () => {
    const { service, store } = setup();
    const result = await service.connectLinear("proj_1", {
      apiKey: "lin_api_secret",
      scope: { kind: "team", id: "team-1", name: "Engineering" },
    });

    expect(result).toEqual({
      success: true,
      connection: {
        configured: true,
        scope: { kind: "team", id: "team-1", name: "Engineering" },
        workspace: "Acme",
        viewer: "sam",
      },
    });
    expect(store.held.get("proj_1")?.apiKey).toBe("lin_api_secret");
  });

  test("a refused key is not kept", async () => {
    const { service, store } = setup();
    const result = await service.connectLinear("proj_1", {
      apiKey: "wrong",
      scope: { kind: "team", id: "team-1", name: "Engineering" },
    });
    expect(result).toEqual({ success: false, error: { code: "LINEAR_UNAUTHORIZED" } });
    expect(store.held.size).toBe(0);
  });

  test("a new mapping without a key keeps the stored one; with none stored it is refused", async () => {
    const connected = setup({ linear: { proj_1: linearConnection() } });
    const empty = setup();
    const scope = { kind: "project" as const, id: "p2", name: "Beta" };

    expect((await connected.service.connectLinear("proj_1", { scope })).success).toBe(true);
    expect(connected.store.held.get("proj_1")).toMatchObject({ apiKey: "lin_api_secret", scope });
    expect(await empty.service.connectLinear("proj_1", { scope })).toEqual({
      success: false,
      error: { code: "LINEAR_NOT_CONFIGURED" },
    });
  });

  test("disconnecting removes the key; the catalog lists what a key sees", async () => {
    const { service, store } = setup({ linear: { proj_1: linearConnection() } });

    const catalog = await service.linearCatalog("proj_1", {});
    expect(catalog.success && catalog.catalog.teams).toEqual([
      { id: "team-1", key: "ENG", name: "Engineering" },
    ]);
    expect(await service.disconnectLinear("proj_1")).toEqual({ success: true });
    expect(store.held.size).toBe(0);
    expect(await service.linearConnection("proj_1")).toEqual({
      success: true,
      connection: { configured: false, scope: null, workspace: null, viewer: null },
    });
  });

  test("every Linear call on an unknown project is not found", async () => {
    const { service } = setup();
    const notFound = { success: false as const, error: { code: "PROJECT_NOT_FOUND" as const } };
    expect(await service.linearConnection("nope")).toEqual(notFound);
    expect(await service.disconnectLinear("nope")).toEqual(notFound);
    expect(await service.linearCatalog("nope", {})).toEqual(notFound);
  });
});
