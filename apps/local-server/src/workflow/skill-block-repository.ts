import type { Kysely } from "kysely";
import type { Database, NewWorkflowSkillBlock, WorkflowSkillBlock } from "../db/schema.ts";

export interface WorkflowSkillBlockRepository {
  delete: (id: string) => Promise<boolean>;
  findById: (id: string) => Promise<WorkflowSkillBlock | null>;
  list: () => Promise<WorkflowSkillBlock[]>;
  upsert: (skillBlock: NewWorkflowSkillBlock) => Promise<WorkflowSkillBlock>;
}

export const createWorkflowSkillBlockRepository = (
  db: Kysely<Database>,
): WorkflowSkillBlockRepository => {
  return {
    findById: async (id: string): Promise<WorkflowSkillBlock | null> => {
      return (
        (await db
          .selectFrom("workflow_skill_blocks")
          .selectAll()
          .where("id", "=", id)
          .executeTakeFirst()) ?? null
      );
    },

    list: async (): Promise<WorkflowSkillBlock[]> => {
      return db
        .selectFrom("workflow_skill_blocks")
        .selectAll()
        .orderBy("category")
        .orderBy("id")
        .execute();
    },

    delete: async (id: string): Promise<boolean> => {
      const existing = await db
        .selectFrom("workflow_skill_blocks")
        .select("id")
        .where("id", "=", id)
        .executeTakeFirst();
      if (!existing) {
        return false;
      }

      await db.deleteFrom("workflow_skill_blocks").where("id", "=", id).execute();
      return true;
    },

    upsert: async (skillBlock: NewWorkflowSkillBlock): Promise<WorkflowSkillBlock> => {
      const existing = await db
        .selectFrom("workflow_skill_blocks")
        .select("id")
        .where("id", "=", skillBlock.id)
        .executeTakeFirst();

      if (existing) {
        return db
          .updateTable("workflow_skill_blocks")
          .set({
            type: skillBlock.type,
            category: skillBlock.category,
            description: skillBlock.description,
            signals: skillBlock.signals,
            prompt_template: skillBlock.prompt_template,
            defaults: skillBlock.defaults,
            agent: skillBlock.agent ?? null,
            updated_at: new Date().toISOString(),
          })
          .where("id", "=", skillBlock.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }

      return db
        .insertInto("workflow_skill_blocks")
        .values(skillBlock)
        .returningAll()
        .executeTakeFirstOrThrow();
    },
  };
};
