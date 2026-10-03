import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { aopPaths } from "@aop/infra";
import { z } from "zod";
import { type ConnectionStore, createConnectionStore } from "../../../issues/connection-store.ts";

/**
 * A connected Slack workspace: the person's two tokens and who they are there. One file per
 * workspace, `$AOP_HOME/connections/slack/<team id>.json`, owner-only like the Linear key. The
 * tokens never go into the database, to a client, or into a log.
 */
export const StoredSlackConnectionSchema = z.object({
  teamId: z.string().min(1),
  teamName: z.string(),
  teamUrl: z.string(),
  userId: z.string().min(1),
  userName: z.string(),
  userToken: z.string().min(1),
  appToken: z.string().min(1),
  scopes: z.array(z.string()),
  connectedAt: z.string(),
});
export type StoredSlackConnection = z.infer<typeof StoredSlackConnectionSchema>;

export interface SlackConnectionStore extends ConnectionStore<StoredSlackConnection> {
  list: () => Promise<StoredSlackConnection[]>;
}

export const slackConnectionsDir = (): string => join(aopPaths.home(), "connections", "slack");

export const createSlackConnectionStore = (
  dir: () => string = slackConnectionsDir,
): SlackConnectionStore => {
  const store = createConnectionStore(StoredSlackConnectionSchema, dir);
  return {
    ...store,
    list: async () => {
      const names = await readdir(dir()).catch(() => [] as string[]);
      const teams = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
      const read = await Promise.all(teams.map((team) => store.read(team)));
      return read.filter((connection) => connection !== null);
    },
  };
};

export const slackSourceId = (teamId: string): string => `slack:${teamId}`;
