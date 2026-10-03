import {
  type JiraCredentials,
  JiraCredentialsSchema,
  type JiraFilter,
  JiraFilterSchema,
} from "@aop/common";
import { z } from "zod";
import {
  type ConnectionStore,
  connectionsDir,
  createConnectionStore,
} from "../connection-store.ts";

/**
 * A project's Jira connection, kept on the host only (connection-store.ts): the credentials it
 * signs in with, the account they sign in as, and which issues it shows.
 */
export interface StoredJiraConnection {
  credentials: JiraCredentials;
  account: string;
  filter: JiraFilter;
  linkPullRequests: boolean;
}

export type JiraConnectionStore = ConnectionStore<StoredJiraConnection>;

const StoredSchema = z.object({
  credentials: JiraCredentialsSchema,
  account: z.string(),
  filter: JiraFilterSchema,
  linkPullRequests: z.boolean(),
});

export const createJiraConnectionStore = (
  dir: () => string = () => connectionsDir("jira"),
): JiraConnectionStore => createConnectionStore(StoredSchema, dir);
