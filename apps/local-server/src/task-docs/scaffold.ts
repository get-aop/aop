import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import type { BrainstormingResult } from "@aop/common";
import { TaskStatus } from "@aop/common";
import { aopPaths } from "@aop/infra";
import { planExecutionChunks } from "../create-task/execution-chunk-planner.ts";
import { serializeFrontmatter } from "./frontmatter.ts";
import { getCanonicalTaskDir, getLegacyTaskDir, toLegacyTaskChangePath } from "./paths.ts";
import type { TaskDocFrontmatter } from "./types.ts";

interface PlanStep {
  title: string;
  description: string;
  dependencies: number[];
}

export interface ScaffoldTaskResult {
  taskName: string;
  taskPath: string;
  createdFiles: string[];
}

const DEFAULT_PRIORITY = "medium";

export const toTaskSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50);

export const getTaskDocsRoot = (repoId: string): string => aopPaths.repoTasks(repoId);

export const getTaskDir = (repoId: string, taskName: string): string =>
  getCanonicalTaskDir(repoId, taskName);

export const scaffoldTaskFromBrainstorm = async (
  repoId: string | null,
  repoRoot: string,
  taskName: string,
  requirements: BrainstormingResult,
): Promise<ScaffoldTaskResult> => {
  const taskSlug = toTaskSlug(taskName) || "task";
  const taskDir = repoId ? getTaskDir(repoId, taskSlug) : getLegacyTaskDir(repoRoot, taskSlug);
  const createdAt = new Date().toISOString();

  await mkdir(taskDir, { recursive: true });

  const planSteps = planExecutionChunks(requirements).map((chunk) => ({
    title: chunk.title,
    description: chunk.description,
    dependencies: chunk.dependencies,
  }));
  const createdFiles = [
    await writeTaskFile(taskDir, requirements, createdAt),
    await writePlanFile(taskDir, taskSlug, planSteps, createdAt),
  ];

  return {
    taskName: taskSlug,
    taskPath: taskDir,
    createdFiles,
  };
};

const writeTaskFile = async (
  taskDir: string,
  requirements: BrainstormingResult,
  createdAt: string,
): Promise<string> => {
  const filePath = join(taskDir, "task.md");
  const frontmatter: TaskDocFrontmatter = {
    title: requirements.title,
    status: TaskStatus.DRAFT,
    created: createdAt,
    changePath: toLegacyTaskChangePath(basename(taskDir)),
    priority: DEFAULT_PRIORITY,
  };

  const body = [
    "",
    "## Description",
    requirements.description,
    "",
    "## Requirements",
    ...formatBulletList(requirements.requirements),
    "",
    "## Acceptance Criteria",
    ...formatCheckboxList(requirements.acceptanceCriteria),
    "",
  ].join("\n");

  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter,
      content: body,
    }),
  );

  return filePath;
};

const writePlanFile = async (
  taskDir: string,
  taskSlug: string,
  planSteps: PlanStep[],
  createdAt: string,
): Promise<string> => {
  const filePath = join(taskDir, "plan.md");
  const body = [
    "",
    "## Plan",
    ...planSteps.map((step, index) => {
      const number = index + 1;
      const deps =
        step.dependencies.length > 0 ? ` (depends on: ${step.dependencies.join(", ")})` : "";
      return `${number}. ${step.title}${deps}\n   ${step.description}`;
    }),
    "",
  ].join("\n");

  await Bun.write(
    filePath,
    serializeFrontmatter({
      frontmatter: {
        status: "INPROGRESS",
        task: taskSlug,
        created: createdAt,
      },
      content: body,
    }),
  );

  return filePath;
};

const formatBulletList = (items: string[]): string[] => {
  if (items.length === 0) return ["- None recorded"];
  return items.map((item) => `- ${item}`);
};

const formatCheckboxList = (items: string[]): string[] => {
  if (items.length === 0) return ["- [ ] Define acceptance criteria"];
  return items.map((item) => `- [ ] ${item}`);
};
