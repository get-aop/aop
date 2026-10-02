import type {
  IssueLabel,
  IssuePerson,
  IssueStage,
  IssueStateFilter,
  LinearCatalog,
  LinearScope,
  ProjectIssue,
} from "@aop/common";

/**
 * Linear's GraphQL API, called with a personal API key. The key goes in the Authorization header
 * and nowhere else: never in a log line, an error message or anything a client receives.
 * `AOP_LINEAR_API_URL` points the host at another endpoint (verification runs use a fixture).
 */
export type LinearFetch = (url: string, init: RequestInit) => Promise<Response>;

export type LinearRead<T> =
  | { ok: true; value: T }
  | { ok: false; unauthorized: boolean; message: string };

export interface LinearApi {
  catalog: (apiKey: string) => Promise<LinearRead<LinearCatalog>>;
  issuePage: (
    apiKey: string,
    request: { scope: LinearScope; state: IssueStateFilter; first: number; after: string | null },
  ) => Promise<LinearRead<LinearIssuePage>>;
  issueBody: (
    apiKey: string,
    identifier: string,
  ) => Promise<LinearRead<{ title: string; url: string; body: string } | null>>;
}

export interface LinearIssuePage {
  issues: ProjectIssue[];
  hasNextPage: boolean;
  endCursor: string | null;
}

export const DEFAULT_LINEAR_API_URL = "https://api.linear.app/graphql";

export const createLinearApi = (options: { fetch?: LinearFetch; url?: string } = {}): LinearApi => {
  const doFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const url = options.url ?? process.env.AOP_LINEAR_API_URL ?? DEFAULT_LINEAR_API_URL;

  const query = async <T>(
    apiKey: string,
    text: string,
    variables: Record<string, unknown>,
  ): Promise<LinearRead<T>> => {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: apiKey },
        body: JSON.stringify({ query: text, variables }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return {
        ok: false,
        unauthorized: false,
        message: `Linear could not be reached (${errorName(error)})`,
      };
    }
    return readGraphqlResponse<T>(response);
  };

  return {
    catalog: async (apiKey) => {
      const read = await query<CatalogData>(apiKey, CATALOG_QUERY, {});
      return read.ok ? { ok: true, value: mapCatalog(read.value) } : read;
    },
    issuePage: async (apiKey, { scope, state, first, after }) => {
      const read = await query<IssuesData>(apiKey, ISSUES_QUERY, {
        filter: issueFilter(scope, state),
        first,
        after,
      });
      if (!read.ok) return read;
      const issues = read.value.issues;
      return {
        ok: true,
        value: {
          issues: (issues?.nodes ?? []).map((node) => mapLinearIssue(node, scope)),
          hasNextPage: issues?.pageInfo?.hasNextPage === true,
          endCursor: issues?.pageInfo?.endCursor ?? null,
        },
      };
    },
    issueBody: async (apiKey, identifier) => {
      const read = await query<{ issue?: BodyNode | null }>(apiKey, ISSUE_BODY_QUERY, {
        id: identifier,
      });
      if (!read.ok) return read;
      const issue = read.value.issue;
      return {
        ok: true,
        value: issue ? { title: issue.title, url: issue.url, body: issue.description ?? "" } : null,
      };
    },
  };
};

/** A Linear issue as the Issues tab shows it. */
export const mapLinearIssue = (node: LinearIssueNode, scope: LinearScope): ProjectIssue => {
  const stage = stageOf(node.state?.type);
  const comments = node.comments?.nodes?.length ?? null;
  return {
    key: `linear:${node.identifier}`,
    source: "linear",
    repoId: null,
    container: scope.name,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    state: stage === "completed" || stage === "canceled" ? "closed" : "open",
    stage,
    stateName: node.state?.name ?? "Unknown",
    stateColor: hexOf(node.state?.color),
    labels: (node.labels?.nodes ?? []).map(
      (label): IssueLabel => ({ name: label.name, color: hexOf(label.color) }),
    ),
    assignees: node.assignee ? [person(node.assignee)] : [],
    author: node.creator ? person(node.creator) : null,
    milestone: node.projectMilestone?.name ?? cycleName(node.cycle),
    commentCount: comments,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    linkedPullRequests: [],
  };
};

/** Linear's filter for a scope and a state: closed is completed or canceled. */
export const issueFilter = (
  scope: LinearScope,
  state: IssueStateFilter,
): Record<string, unknown> => {
  const filter: Record<string, unknown> = { [scope.kind]: { id: { eq: scope.id } } };
  if (state !== "all") {
    filter.state = { type: { [state === "closed" ? "in" : "nin"]: ["completed", "canceled"] } };
  }
  return filter;
};

const readGraphqlResponse = async <T>(response: Response): Promise<LinearRead<T>> => {
  const payload = (await response.json().catch(() => null)) as GraphqlPayload<T> | null;
  const errors = payload?.errors ?? [];
  const unauthorized =
    response.status === 401 ||
    errors.some((error) =>
      /authenticat|api key/i.test(`${error.message} ${error.extensions?.type ?? ""}`),
    );
  if (unauthorized) {
    return { ok: false, unauthorized: true, message: "Linear refused the API key" };
  }
  if (!response.ok || errors.length > 0 || !payload?.data) {
    const detail = errors[0]?.message ?? `HTTP ${response.status}`;
    return { ok: false, unauthorized: false, message: `Linear answered with an error: ${detail}` };
  }
  return { ok: true, value: payload.data };
};

const STAGES: readonly IssueStage[] = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

const stageOf = (type: string | undefined): IssueStage =>
  STAGES.find((stage) => stage === type) ?? "unstarted";

const hexOf = (color: string | null | undefined): string | null => {
  const hex = color?.replace(/^#/, "") ?? "";
  return /^[0-9a-fA-F]{6}$/.test(hex) ? hex : null;
};

const person = (user: LinearUser): IssuePerson => ({
  login: user.displayName || user.name,
  name: user.name || null,
  avatarUrl: user.avatarUrl?.startsWith("http") ? user.avatarUrl : null,
});

const cycleName = (cycle: LinearIssueNode["cycle"]): string | null =>
  cycle ? cycle.name || `Cycle ${cycle.number}` : null;

const mapCatalog = (data: CatalogData): LinearCatalog => ({
  workspace: data.organization?.name ?? "",
  viewer: data.viewer?.displayName || data.viewer?.name || "",
  teams: (data.teams?.nodes ?? []).map(({ id, key, name }) => ({ id, key, name })),
  projects: (data.projects?.nodes ?? []).map((project) => ({
    id: project.id,
    name: project.name,
    teams: (project.teams?.nodes ?? []).map((team) => team.key),
  })),
});

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "network error";

const CATALOG_QUERY = `query {
  viewer { name displayName }
  organization { name }
  teams(first: 100) { nodes { id key name } }
  projects(first: 100) { nodes { id name teams { nodes { key } } } }
}`;

const ISSUES_QUERY = `query($filter: IssueFilter, $first: Int!, $after: String) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    pageInfo { hasNextPage endCursor }
    nodes {
      identifier title url createdAt updatedAt
      state { name type color }
      labels(first: 10) { nodes { name color } }
      assignee { name displayName avatarUrl }
      creator { name displayName avatarUrl }
      cycle { name number }
      projectMilestone { name }
      comments(first: 50) { nodes { id } }
    }
  }
}`;

const ISSUE_BODY_QUERY = `query($id: String!) { issue(id: $id) { title url description } }`;

interface GraphqlPayload<T> {
  data?: T;
  errors?: { message: string; extensions?: { type?: string } }[];
}

interface LinearUser {
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface LinearIssueNode {
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  state?: { name: string; type: string; color?: string | null } | null;
  labels?: { nodes?: { name: string; color?: string | null }[] };
  assignee?: LinearUser | null;
  creator?: LinearUser | null;
  cycle?: { name?: string | null; number: number } | null;
  projectMilestone?: { name: string } | null;
  comments?: { nodes?: { id: string }[] };
}

interface IssuesData {
  issues?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: LinearIssueNode[];
  };
}

interface BodyNode {
  title: string;
  url: string;
  description?: string | null;
}

interface CatalogData {
  viewer?: { name: string; displayName?: string | null };
  organization?: { name: string };
  teams?: { nodes?: { id: string; key: string; name: string }[] };
  projects?: { nodes?: { id: string; name: string; teams?: { nodes?: { key: string }[] } }[] };
}
