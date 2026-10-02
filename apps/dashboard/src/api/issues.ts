import {
  type IssueList,
  IssueListSchema,
  type IssueStateFilter,
  type LinearCatalog,
  LinearCatalogSchema,
  type LinearConnection,
  LinearConnectionSchema,
  type LinearScope,
  type Message,
} from "@aop/common";
import { request } from "./request";

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}`;

/** Every source's issues; `refresh` asks the host to look past its short reuse window. */
export const listIssues = async (
  projectId: string,
  options: { state: IssueStateFilter; limit: number; refresh?: boolean },
): Promise<IssueList> => {
  const query = new URLSearchParams({
    state: options.state,
    limit: String(options.limit),
    refresh: options.refresh ? "1" : "0",
  });
  return IssueListSchema.parse(await request<unknown>(`${base(projectId)}/issues?${query}`));
};

/** Asks the coordinator to start a thread for the issue; answers with the message it was sent. */
export const startThreadFromIssue = async (projectId: string, key: string): Promise<Message> =>
  (
    await request<{ message: Message }>(`${base(projectId)}/issues/start-thread`, {
      method: "POST",
      body: JSON.stringify({ key }),
    })
  ).message;

export const getLinearConnection = async (projectId: string): Promise<LinearConnection> =>
  LinearConnectionSchema.parse(
    (await request<{ connection: unknown }>(`${base(projectId)}/linear`)).connection,
  );

/** Host owner only. Without `apiKey` the stored key stays and only the mapping changes. */
export const connectLinear = async (
  projectId: string,
  input: { apiKey?: string; scope: LinearScope },
): Promise<LinearConnection> =>
  LinearConnectionSchema.parse(
    (
      await request<{ connection: unknown }>(`${base(projectId)}/linear`, {
        method: "PUT",
        body: JSON.stringify(input),
      })
    ).connection,
  );

/** Host owner only. */
export const disconnectLinear = async (projectId: string): Promise<void> => {
  await request<unknown>(`${base(projectId)}/linear`, { method: "DELETE" });
};

/** Host owner only: the teams and projects a key (or the stored one) can see. */
export const getLinearCatalog = async (
  projectId: string,
  apiKey?: string,
): Promise<LinearCatalog> =>
  LinearCatalogSchema.parse(
    (
      await request<{ catalog: unknown }>(`${base(projectId)}/linear/catalog`, {
        method: "POST",
        body: JSON.stringify(apiKey ? { apiKey } : {}),
      })
    ).catalog,
  );
