import { generateTypeId } from "@aop/infra";
import type { Kysely } from "kysely";
import { normalizeAgentRoleLane } from "../agent/roles.ts";
import type { Database, NewTaskAssignment, StatusColumn, TaskAssignment } from "../db/schema.ts";
import type { TaskAssignmentProjection } from "../status/handlers.ts";

export interface TaskAssignmentRepository {
  getCurrentByTaskId: (taskId: string) => Promise<TaskAssignment | null>;
  getCurrentWithAgentNameByTaskIds: (
    taskIds: string[],
  ) => Promise<Map<string, TaskAssignmentProjection>>;
  clearCurrentByTaskId: (taskId: string) => Promise<void>;
  upsertCurrent: (input: {
    taskId: string;
    agentId: string;
    repoId: string;
    statusColumn: StatusColumn;
  }) => Promise<TaskAssignment>;
}

export const createTaskAssignmentRepository = (db: Kysely<Database>): TaskAssignmentRepository => {
  const getCurrentByTaskId = async (taskId: string): Promise<TaskAssignment | null> => {
    return (
      (await db
        .selectFrom("task_assignments")
        .selectAll()
        .where("task_id", "=", taskId)
        .where("is_current", "=", true)
        .executeTakeFirst()) ?? null
    );
  };

  return {
    getCurrentByTaskId,

    getCurrentWithAgentNameByTaskIds: async (
      taskIds: string[],
    ): Promise<Map<string, TaskAssignmentProjection>> => {
      if (taskIds.length === 0) return new Map();

      const rows = await db
        .selectFrom("task_assignments")
        .leftJoin("agents", "agents.id", "task_assignments.agent_id")
        .leftJoin("workflows", "workflows.id", "agents.workflow_id")
        .select([
          "task_assignments.task_id as taskId",
          "task_assignments.agent_id as agentId",
          "task_assignments.status_column as statusColumn",
          "agents.name as agentName",
          "agents.role as agentRole",
          "agents.workflow_id as agentWorkflowId",
          "workflows.name as agentWorkflowName",
        ])
        .where("task_assignments.task_id", "in", taskIds)
        .where("task_assignments.is_current", "=", true)
        .execute();

      return new Map(
        rows.map((row) => [
          row.taskId,
          {
            agentId: row.agentId,
            agentName: row.agentName ?? null,
            agentRole: normalizeAgentRoleLane(row.agentRole),
            agentWorkflowId: row.agentWorkflowId ?? null,
            agentWorkflow: row.agentWorkflowName ?? row.agentWorkflowId ?? null,
            statusColumn: row.statusColumn,
          },
        ]),
      );
    },

    clearCurrentByTaskId: async (taskId: string): Promise<void> => {
      await db
        .updateTable("task_assignments")
        .set({ is_current: false, updated_at: new Date().toISOString() })
        .where("task_id", "=", taskId)
        .where("is_current", "=", true)
        .execute();
    },

    upsertCurrent: async ({ taskId, agentId, repoId, statusColumn }): Promise<TaskAssignment> => {
      const now = new Date().toISOString();
      const existing = await getCurrentByTaskId(taskId);

      if (existing && existing.agent_id === agentId && existing.repo_id === repoId) {
        await db
          .updateTable("task_assignments")
          .set({ status_column: statusColumn, updated_at: now })
          .where("id", "=", existing.id)
          .execute();

        return db
          .selectFrom("task_assignments")
          .selectAll()
          .where("id", "=", existing.id)
          .executeTakeFirstOrThrow();
      }

      await db
        .updateTable("task_assignments")
        .set({ is_current: false, updated_at: now })
        .where("task_id", "=", taskId)
        .where("is_current", "=", true)
        .execute();

      const assignment: NewTaskAssignment = {
        id: generateTypeId("asgn"),
        task_id: taskId,
        agent_id: agentId,
        repo_id: repoId,
        status_column: statusColumn,
        is_current: true,
        created_at: now,
        updated_at: now,
      };

      await db.insertInto("task_assignments").values(assignment).execute();

      return db
        .selectFrom("task_assignments")
        .selectAll()
        .where("id", "=", assignment.id)
        .executeTakeFirstOrThrow();
    },
  };
};
