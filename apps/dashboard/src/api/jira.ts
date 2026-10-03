import {
  type JiraConnectInput,
  type JiraConnection,
  JiraConnectionSchema,
  type JiraCredentials,
  type JiraTestResult,
  JiraTestResultSchema,
} from "@aop/common";
import { request } from "./request";

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/jira`;

/** Whether the project is connected to Jira and what it shows; never the token. */
export const getJiraConnection = async (projectId: string): Promise<JiraConnection> =>
  JiraConnectionSchema.parse((await request<{ connection: unknown }>(base(projectId))).connection);

/**
 * Host owner only: who the credentials (or the stored ones, without any) sign in as, and the
 * projects they see.
 */
export const testJiraConnection = async (
  projectId: string,
  credentials?: JiraCredentials,
): Promise<JiraTestResult> =>
  JiraTestResultSchema.parse(
    (
      await request<{ result: unknown }>(`${base(projectId)}/test`, {
        method: "POST",
        body: JSON.stringify(credentials ? { credentials } : {}),
      })
    ).result,
  );

/** Host owner only. Without `credentials` the stored ones stay and only the filter changes. */
export const connectJira = async (
  projectId: string,
  input: Omit<JiraConnectInput, "linkPullRequests"> & { linkPullRequests: boolean },
): Promise<JiraConnection> =>
  JiraConnectionSchema.parse(
    (
      await request<{ connection: unknown }>(base(projectId), {
        method: "PUT",
        body: JSON.stringify(input),
      })
    ).connection,
  );

/** Host owner only. */
export const disconnectJira = async (projectId: string): Promise<void> => {
  await request<unknown>(base(projectId), { method: "DELETE" });
};
