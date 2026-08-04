import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { TaskStatus } from "@aop/common";
import { generateTypeId } from "@aop/infra";
import type { LocalServerContext } from "../context.ts";
import type { Task } from "../db/schema.ts";
import { getCanonicalTaskDir, toLegacyTaskChangePath } from "../task-docs/paths.ts";
import { toTaskSlug } from "../task-docs/scaffold.ts";
import { TASK_IMPLEMENTATION_ACCEPTANCE_CRITERION, writeTaskDoc } from "../task-docs/task.ts";

export interface CreateTaskPackageInput {
  repoId: string;
  title: string;
  description: string;
  planMarkdown: string;
  preferredWorkflow?: string | null;
  originChatSessionId?: string | null;
}

export const createTaskPackage = async (
  ctx: LocalServerContext,
  input: CreateTaskPackageInput,
): Promise<Task> => {
  const title = requireText(input.title, "title");
  const description = requireText(input.description, "description");
  const planMarkdown = requireText(input.planMarkdown, "plan.md");
  const repo = await ctx.repoRepository.getById(input.repoId);
  if (!repo) throw new Error(`Repo not found: ${input.repoId}`);

  const id = generateTypeId("task");
  const slug = `${toTaskSlug(title) || "task"}-${id.slice(-8)}`;
  const changePath = toLegacyTaskChangePath(slug);
  const taskDir = getCanonicalTaskDir(input.repoId, changePath);
  const createdAt = new Date().toISOString();
  await mkdir(taskDir, { recursive: true });

  await Promise.all([
    writeTaskDoc(
      join(taskDir, "task.md"),
      {
        id,
        title,
        status: TaskStatus.DRAFT,
        created: createdAt,
        changePath,
      },
      buildTaskBody(description),
    ),
    Bun.write(join(taskDir, "plan.md"), `${planMarkdown}\n`),
  ]);

  const task = await ctx.taskRepository.createIdempotentRecordOnly({
    id,
    repo_id: input.repoId,
    change_path: changePath,
    worktree_path: null,
    status: TaskStatus.DRAFT,
    ready_at: null,
    preferred_workflow: input.preferredWorkflow ?? null,
    base_branch: null,
    preferred_provider: null,
    retry_from_step: null,
    resume_input: null,
    origin_chat_session_id: input.originChatSessionId ?? null,
    created_at: createdAt,
    updated_at: createdAt,
  });
  if (!task) throw new Error(`Failed to create task package: ${title}`);
  if (!input.preferredWorkflow) return task;
  return (
    (await ctx.taskRepository.update(task.id, {
      preferred_workflow: input.preferredWorkflow,
    })) ?? task
  );
};

const requireText = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const buildTaskBody = (description: string): string =>
  [
    "",
    "## Description",
    description,
    "",
    "## Requirements",
    "- Follow `plan.md`.",
    "",
    "## Acceptance Criteria",
    `- [ ] ${TASK_IMPLEMENTATION_ACCEPTANCE_CRITERION}`,
    "",
  ].join("\n");
