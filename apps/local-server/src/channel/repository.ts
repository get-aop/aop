import type { Kysely } from "kysely";
import type {
  Channel,
  ChannelMembership,
  ChannelMessage,
  Database,
  NewChannel,
  NewChannelMembership,
  NewChannelMessage,
} from "../db/schema.ts";

export interface ChannelRepository {
  create: (channel: NewChannel) => Promise<Channel>;
  getById: (id: string) => Promise<Channel | null>;
  getPrivateByAgentId: (agentId: string) => Promise<Channel | null>;
  createMembership: (membership: NewChannelMembership) => Promise<void>;
  listMemberships: (channelId: string) => Promise<ChannelMembership[]>;
  updateName: (channelId: string, name: string, updatedAt: string) => Promise<void>;
  listMessages: (channelId: string) => Promise<ChannelMessage[]>;
  createMessage: (message: NewChannelMessage) => Promise<ChannelMessage>;
}

export const createChannelRepository = (db: Kysely<Database>): ChannelRepository => {
  return {
    create: async (channel: NewChannel): Promise<Channel> => {
      await db.insertInto("channels").values(channel).execute();

      return db
        .selectFrom("channels")
        .selectAll()
        .where("id", "=", channel.id)
        .executeTakeFirstOrThrow();
    },

    getById: async (id: string): Promise<Channel | null> => {
      const channel = await db
        .selectFrom("channels")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      return channel ?? null;
    },

    getPrivateByAgentId: async (agentId: string): Promise<Channel | null> => {
      const channel = await db
        .selectFrom("channels")
        .selectAll()
        .where("owner_agent_id", "=", agentId)
        .where("kind", "=", "private")
        .executeTakeFirst();

      return channel ?? null;
    },

    createMembership: async (membership: NewChannelMembership): Promise<void> => {
      await db
        .insertInto("channel_memberships")
        .values(membership)
        .onConflict((oc) => oc.columns(["channel_id", "agent_id"]).doNothing())
        .execute();
    },

    listMemberships: async (channelId: string): Promise<ChannelMembership[]> => {
      return db
        .selectFrom("channel_memberships")
        .selectAll()
        .where("channel_id", "=", channelId)
        .orderBy("created_at")
        .execute();
    },

    updateName: async (channelId: string, name: string, updatedAt: string): Promise<void> => {
      await db
        .updateTable("channels")
        .set({
          name,
          updated_at: updatedAt,
        })
        .where("id", "=", channelId)
        .execute();
    },

    listMessages: async (channelId: string): Promise<ChannelMessage[]> => {
      return db
        .selectFrom("channel_messages")
        .selectAll()
        .where("channel_id", "=", channelId)
        .orderBy("created_at")
        .execute();
    },

    createMessage: async (message: NewChannelMessage): Promise<ChannelMessage> => {
      await db.insertInto("channel_messages").values(message).execute();

      return db
        .selectFrom("channel_messages")
        .selectAll()
        .where("id", "=", message.id)
        .executeTakeFirstOrThrow();
    },
  };
};
