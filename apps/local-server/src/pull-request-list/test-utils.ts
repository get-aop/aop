import type { CommandResult } from "../command-runner.ts";
import { fail, httpAnswer, ok } from "../github/test-utils.ts";

/** A GraphQL pull request node as GitHub returns it; tests override what they look at. */
export const makeNode = (overrides: Record<string, unknown> = {}) => ({
  number: 1,
  title: "Add checkout",
  url: "https://github.com/acme/shop/pull/1",
  state: "OPEN",
  isDraft: false,
  createdAt: "2026-09-01T10:00:00Z",
  updatedAt: "2026-09-02T10:00:00Z",
  headRefName: "feature/checkout",
  baseRefName: "main",
  author: { login: "ada", avatarUrl: "https://avatars.example/ada" },
  labels: { nodes: [] },
  assignees: { nodes: [] },
  reviewDecision: null,
  reviewRequests: { nodes: [] },
  latestOpinionatedReviews: { nodes: [] },
  comments: { totalCount: 0 },
  commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  ...overrides,
});

type Node = ReturnType<typeof makeNode>;

/**
 * A fake GitHub behind `gh`: pull requests per `owner/name`, served in pages by GraphQL, and
 * the REST probe answering 304 to the ETag it last gave while nothing changed. `version` bumps
 * the ETag, as an edit on GitHub would. Every call is kept.
 */
export const createFakeGithub = (options: { login?: string; pageSize?: number } = {}) => {
  const repos = new Map<string, Node[]>();
  const state = { version: 1, failing: null as string | null, signedOut: false };
  const calls: string[][] = [];

  const etag = () => `W/"v${state.version}"`;

  const graphql = (args: string[]): CommandResult => {
    if (state.failing) return fail(state.failing);
    const variable = (name: string) =>
      args.flatMap((arg) => (arg.startsWith(`${name}=`) ? [arg.slice(name.length + 1)] : []));
    const nodes = repos.get(`${variable("owner")[0]}/${variable("name")[0]}`);
    if (!nodes) return ok(JSON.stringify({ data: { viewer: { login: "ada" }, repository: null } }));
    const states = variable("states[]");
    const matching = nodes.filter((node) => states.includes(node.state));
    const size = options.pageSize ?? Number(variable("first")[0]);
    const start = Number(variable("after")[0] ?? 0);
    const page = matching.slice(start, start + size);
    const hasNextPage = start + size < matching.length;
    return ok(
      JSON.stringify({
        data: {
          viewer: { login: options.login ?? "ada" },
          repository: {
            pullRequests: {
              pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + size) : null },
              nodes: page,
            },
          },
        },
      }),
    );
  };

  const rest = (args: string[]): CommandResult => {
    const sent = args[args.indexOf("-H") + 1];
    if (args.includes("-H") && sent === `If-None-Match: ${etag()}`) {
      return httpAnswer(304, undefined, { ETag: etag() });
    }
    return httpAnswer(200, [], { ETag: etag() });
  };

  const run = async (args: string[]): Promise<CommandResult> => {
    calls.push(args);
    if (state.signedOut) return fail("To get started with GitHub CLI, please run:  gh auth login");
    if (args[1] === "user") return ok(`${options.login ?? "ada"}\n`);
    if (args[1] === "graphql") return graphql(args);
    return rest(args);
  };

  return {
    run,
    calls,
    state,
    setPulls: (nameWithOwner: string, nodes: Node[]) => {
      repos.set(nameWithOwner, nodes);
      state.version += 1;
    },
    graphqlCalls: () => calls.filter((args) => args[1] === "graphql").length,
    probes: () => calls.filter((args) => args[1] === "-i").length,
  };
};
