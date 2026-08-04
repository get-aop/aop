import { basename, join } from "node:path";
import { TaskStatus } from "@aop/common";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.ts";
import { listSubtaskDocs } from "./subtask.ts";
import { parseTaskDoc, updateTaskDocStatus } from "./task.ts";
import type { SubtaskDocFrontmatter } from "./types.ts";

/** Restores task docs to a fresh post-create state for another run. */
export const resetTaskDocsForRetry = async (taskDir: string): Promise<void> => {
  const taskFilePath = join(taskDir, "task.md");
  await updateTaskDocStatus(taskFilePath, TaskStatus.DRAFT);

  const taskDoc = await parseTaskDoc(taskFilePath);
  const uncheckedCriteria = taskDoc.acceptanceCriteria.map((criterion) => ({
    ...criterion,
    checked: false,
  }));

  const body = [
    "",
    "## Description",
    taskDoc.description,
    "",
    "## Requirements",
    ...formatRequirementLines(taskDoc.requirements),
    "",
    "## Acceptance Criteria",
    ...uncheckedCriteria.map((item) => `- [ ] ${item.text}`),
    "",
  ].join("\n");

  await Bun.write(
    taskFilePath,
    serializeFrontmatter({
      frontmatter: {
        id: taskDoc.id ?? undefined,
        title: taskDoc.title,
        status: TaskStatus.DRAFT,
        created: taskDoc.createdAt,
        changePath: taskDoc.changePath,
        priority: "medium",
      },
      content: body,
    }),
  );

  const issuesPath = join(taskDir, "issues.md");
  if (await Bun.file(issuesPath).exists()) {
    const issuesDoc = parseMarkdownDoc(await Bun.file(issuesPath).text());
    await Bun.write(
      issuesPath,
      serializeFrontmatter({
        frontmatter: {
          ...issuesDoc.frontmatter,
          status: "INPROGRESS",
          task: basename(taskDir),
          created: taskDoc.createdAt,
        },
        content: resetMarkdownCheckboxes(ensureLeadingNewline(issuesDoc.content)),
      }),
    );
  }

  const planPath = join(taskDir, "plan.md");
  if (await Bun.file(planPath).exists()) {
    const planContent = await Bun.file(planPath).text();
    await Bun.write(planPath, resetMarkdownCheckboxes(planContent));
  }

  const subtasks = await listSubtaskDocs(taskDir);
  for (const subtask of subtasks) {
    const subtaskPath = join(taskDir, subtask.filename);
    const markdown = await Bun.file(subtaskPath).text();
    const titleMatch = markdown.match(/^title:\s*(.+)$/m);
    const title = titleMatch?.[1]?.trim() ?? subtask.filename;
    const description = extractSubtaskDescription(markdown);

    await Bun.write(
      subtaskPath,
      serializeFrontmatter({
        frontmatter: {
          title,
          status: "PENDING",
        } satisfies SubtaskDocFrontmatter,
        content: [
          "",
          "### Description",
          description,
          "",
          "### Context",
          "",
          "### Result",
          "",
          "### Review",
          "",
          "### Blockers",
          "",
        ].join("\n"),
      }),
    );
  }
};

const formatRequirementLines = (requirements: string): string[] => {
  const lines = requirements
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => (line.startsWith("- ") ? line : `- ${line}`));
};

const parseMarkdownDoc = (
  markdown: string,
): { frontmatter: Record<string, unknown>; content: string } => {
  try {
    return parseFrontmatter<Record<string, unknown>>(markdown);
  } catch {
    return {
      frontmatter: {},
      content: markdown,
    };
  }
};

const resetMarkdownCheckboxes = (markdown: string): string =>
  markdown.replace(/^(\s*[-*]\s+)\[[xX]\]/gm, "$1[ ]");

const ensureLeadingNewline = (markdown: string): string =>
  markdown.startsWith("\n") ? markdown : `\n${markdown}`;

const extractSubtaskDescription = (markdown: string): string => {
  const section = markdown.match(/### Description\n([\s\S]*?)(?=\n### |\s*$)/);
  if (!section?.[1]) return "";
  return section[1].trim();
};
