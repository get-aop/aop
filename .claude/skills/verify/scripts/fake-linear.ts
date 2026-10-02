#!/usr/bin/env bun
/**
 * A fake Linear GraphQL API for verifying the Issues tab's Linear source: point the host at it
 * with `AOP_LINEAR_API_URL=http://127.0.0.1:<port>/graphql`. It answers the three reads the host
 * makes (the catalog of teams and projects, a page of issues, one issue's description) from
 * issue-fixtures.ts. Only the key `lin_api_fixture` is accepted; any other is refused the way
 * Linear refuses one. Requests are logged to stdout without the key.
 *
 *   bun .claude/skills/verify/scripts/fake-linear.ts --port 25490
 */
import { LINEAR_CATALOG, linearIssueNodes } from "./issue-fixtures.ts";

export const FIXTURE_KEY = "lin_api_fixture";
const portFlag = process.argv.indexOf("--port");
const port = portFlag === -1 ? 25490 : Number(process.argv[portFlag + 1]);

const refused = () =>
  Response.json(
    {
      errors: [
        {
          message: "Authentication required, not authenticated",
          extensions: { type: "authentication error" },
        },
      ],
    },
    { status: 400 },
  );

Bun.serve({
  port,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    const { query = "", variables = {} } = (await request.json().catch(() => ({}))) as {
      query?: string;
      variables?: Record<string, unknown>;
    };
    const authorized = request.headers.get("authorization") === FIXTURE_KEY;
    const kind = query.includes("organization")
      ? "catalog"
      : query.includes("issues(")
        ? "issues"
        : "issue";
    console.log(
      `${new Date().toISOString()} ${kind} authorized=${authorized} ${JSON.stringify(variables)}`,
    );
    if (!authorized) return refused();
    if (kind === "catalog") return Response.json({ data: LINEAR_CATALOG });
    const all = linearIssueNodes();
    if (kind === "issue") {
      const issue = all.find((item) => item.identifier === variables.id);
      return Response.json({
        data: {
          issue: issue
            ? { title: issue.title, url: issue.url, description: issue.description }
            : null,
        },
      });
    }
    const filter = (variables.filter ?? {}) as {
      state?: { type?: { in?: string[]; nin?: string[] } };
    };
    const types = filter.state?.type;
    const nodes = all.filter((issue) => {
      if (types?.in) return types.in.includes(issue.state.type);
      if (types?.nin) return !types.nin.includes(issue.state.type);
      return true;
    });
    return Response.json({
      data: { issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } },
    });
  },
});
console.log(`fake Linear on http://127.0.0.1:${port}/graphql`);
