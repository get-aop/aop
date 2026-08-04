import type { Kysely } from "kysely";
import type {
  Agent,
  AgentRepoMembership,
  AgentStatus,
  AgentUpdate,
  Database,
  NewAgent,
  NewAgentRepoMembership,
} from "../db/schema.ts";

export interface AgentRepository {
  create: (agent: NewAgent) => Promise<Agent>;
  getById: (id: string) => Promise<Agent | null>;
  getByName: (name: string) => Promise<Agent | null>;
  findByName: (name: string) => Promise<Agent | null>;
  findAnyByName: (name: string) => Promise<Agent | null>;
  list: (status?: AgentStatus) => Promise<Agent[]>;
  listActive: () => Promise<Agent[]>;
  update: (id: string, updates: AgentUpdate) => Promise<Agent | null>;
  countActive: () => Promise<number>;
  listRepoMemberships: (agentId: string) => Promise<AgentRepoMembership[]>;
  replaceRepoMemberships: (agentId: string, memberships: NewAgentRepoMembership[]) => Promise<void>;
}

export const createAgentRepository = (db: Kysely<Database>): AgentRepository => {
  return {
    create: async (agent: NewAgent): Promise<Agent> => {
      await db.insertInto("agents").values(agent).execute();

      return db
        .selectFrom("agents")
        .selectAll()
        .where("id", "=", agent.id)
        .executeTakeFirstOrThrow();
    },

    getById: async (id: string): Promise<Agent | null> => {
      const agent = await db
        .selectFrom("agents")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();
      return agent ?? null;
    },

    getByName: async (name: string): Promise<Agent | null> => {
      const agent = await db
        .selectFrom("agents")
        .selectAll()
        .where("name", "=", name)
        .where("status", "=", "active")
        .executeTakeFirst();
      return agent ?? null;
    },

    findByName: async (name: string): Promise<Agent | null> => {
      const agent = await db
        .selectFrom("agents")
        .selectAll()
        .where("name", "=", name)
        .where("status", "=", "active")
        .executeTakeFirst();
      return agent ?? null;
    },

    findAnyByName: async (name: string): Promise<Agent | null> => {
      const agent = await db
        .selectFrom("agents")
        .selectAll()
        .where("name", "=", name)
        .executeTakeFirst();
      return agent ?? null;
    },

    list: async (status?: AgentStatus): Promise<Agent[]> => {
      let query = db.selectFrom("agents").selectAll();

      if (status) {
        query = query.where("status", "=", status);
      }

      return query.orderBy("created_at").execute();
    },

    listActive: async (): Promise<Agent[]> => {
      return db
        .selectFrom("agents")
        .selectAll()
        .where("status", "=", "active")
        .orderBy("created_at")
        .execute();
    },

    update: async (id: string, updates: AgentUpdate): Promise<Agent | null> => {
      const existing = await db
        .selectFrom("agents")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) {
        return null;
      }

      await db.updateTable("agents").set(updates).where("id", "=", id).execute();

      return db.selectFrom("agents").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
    },

    countActive: async (): Promise<number> => {
      const row = await db
        .selectFrom("agents")
        .select((eb) => eb.fn.count("id").as("count"))
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();

      return Number(row.count);
    },

    listRepoMemberships: async (agentId: string): Promise<AgentRepoMembership[]> => {
      return db
        .selectFrom("agent_repo_memberships")
        .selectAll()
        .where("agent_id", "=", agentId)
        .orderBy("created_at")
        .execute();
    },

    replaceRepoMemberships: async (
      agentId: string,
      memberships: NewAgentRepoMembership[],
    ): Promise<void> => {
      await db.deleteFrom("agent_repo_memberships").where("agent_id", "=", agentId).execute();

      if (memberships.length === 0) {
        return;
      }

      await db.insertInto("agent_repo_memberships").values(memberships).execute();
    },
  };
};
