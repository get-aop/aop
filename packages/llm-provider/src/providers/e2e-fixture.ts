import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { LLMProvider, RunOptions, RunResult } from "../types";

// Must match the marker emitted by `apps/.../prompts/templates/_task-context.md.hbs`
// (`- **Task docs folder**: \`{{task.docsDir}}\``). The wording was simplified
// (dropping "(required for workflow progress)") in the .aop-first storage change;
// a stale regex here silently stops the fixture from creating files / checking
// acceptance criteria, which the completion guard then blocks on — turning the
// task BLOCKED and failing the dashboard/backlog e2e.
const TASK_DOCS_DIR_REGEX = /- \*\*Task docs folder\*\*: `([^`]+)`/;
const TASK_PATH_REGEX = /- \*\*Task Path\*\*: ([^\n]+)/;
const SIGNAL_PRIORITY = [
  "ALL_TASKS_DONE",
  "TESTS_PASS",
  "CLEANUP_COMPLETE",
  "ARCHITECTURE_IMPROVED",
  "REVIEW_PASSED",
  "FIX_COMPLETE",
  "CHUNK_DONE",
] as const;
const CHECKBOX_REGEX = /^-\s+\[\s\]\s+/gm;
const FILE_WITH_CONTENT_REGEX =
  /Create\s+`?([^`"\n]+?\.[a-z0-9._-]+)`?\s+in the repository root(?:\s+with content|\s+containing)\s+["`]([^"`\n]+)["`]/i;
const FILE_REFERENCE_REGEX = /`([^`\n]+?\.[a-z0-9._-]+)`/i;
const WRITE_CONTENT_REGEX = /(?:Write|contains?)\s+["`]([^"`\n]+)["`]/i;
const TASK_CONTEXT_FILES = ["task.md", "issues.md", "prd.md", "tasks.md", "proposal.md", "plan.md"];

export class E2EFixtureProvider implements LLMProvider {
  readonly name = "e2e-fixture";

  async run(options: RunOptions): Promise<RunResult> {
    await maybeDelay();

    const signal = pickSignal(options.prompt);
    const taskDir = extractTaskDir(options.prompt);

    if (options.cwd && taskDir) {
      await applyFixtureChanges(taskDir, options.cwd, options.prompt);
    }

    if (options.logFilePath) {
      await writeFixtureLog(options.logFilePath, signal);
    }

    return { exitCode: 0 };
  }
}

const extractTaskDir = (prompt: string): string | null => {
  const docsDirMatch = prompt.match(TASK_DOCS_DIR_REGEX);
  if (docsDirMatch?.[1]) {
    return docsDirMatch[1].trim();
  }

  const match = prompt.match(TASK_PATH_REGEX);
  return match?.[1]?.trim() ?? null;
};

const pickSignal = (prompt: string): string => {
  for (const signal of SIGNAL_PRIORITY) {
    if (prompt.includes(`<aop>${signal}</aop>`)) {
      return signal;
    }
  }

  return "REVIEW_PASSED";
};

const applyFixtureChanges = async (
  taskDir: string,
  worktreePath: string,
  prompt: string,
): Promise<void> => {
  const resolvedTaskDir = resolveTaskDir(taskDir, worktreePath);
  const taskText = await loadTaskText(resolvedTaskDir);
  if (isPlanningPrompt(prompt) && isImportedLinearTask(taskText)) {
    await writePlanningArtifacts(resolvedTaskDir, taskText);
    return;
  }

  const fileInstruction = extractFileInstruction(taskText);
  if (!fileInstruction) {
    await markTaskDocsDone(resolvedTaskDir);
    return;
  }

  const targetPath = join(worktreePath, fileInstruction.path);
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${fileInstruction.content}\n`);
  await markTaskDocsDone(resolvedTaskDir);
};

const isImportedLinearTask = (taskText: string): boolean =>
  taskText.includes("Imported from Linear");

const isPlanningPrompt = (prompt: string): boolean =>
  prompt.includes("Create or refresh `prd.md` and `issues.md`") ||
  prompt.includes("Create or refresh prd.md and issues.md") ||
  prompt.includes("Generate the implementation plan") ||
  prompt.includes("create or refresh numbered subtask files") ||
  prompt.includes("Save the plan to `plan.md`");

const resolveTaskDir = (taskDir: string, worktreePath: string): string =>
  isAbsolute(taskDir) ? taskDir : join(worktreePath, taskDir);

const loadTaskText = async (taskDir: string): Promise<string> => {
  const contents = await Promise.all(
    TASK_CONTEXT_FILES.map(async (file) => {
      const path = join(taskDir, file);
      try {
        return await readFile(path, "utf-8");
      } catch {
        return "";
      }
    }),
  );

  return contents.filter(Boolean).join("\n");
};

const extractFileInstruction = (
  text: string,
): {
  path: string;
  content: string;
} | null => {
  const explicitMatch = text.match(FILE_WITH_CONTENT_REGEX);
  if (explicitMatch?.[1] && explicitMatch[2]) {
    return {
      path: explicitMatch[1].trim(),
      content: explicitMatch[2].trim(),
    };
  }

  const fileMatch = text.match(FILE_REFERENCE_REGEX);
  const contentMatch = text.match(WRITE_CONTENT_REGEX);
  if (fileMatch?.[1] && contentMatch?.[1]) {
    return {
      path: fileMatch[1].trim(),
      content: contentMatch[1].trim(),
    };
  }

  return null;
};

const markTaskDocsDone = async (taskDir: string): Promise<void> => {
  await markTaskDocDone(join(taskDir, "task.md"));
  await markChecklistDone(join(taskDir, "issues.md"));
  await markChecklistDone(join(taskDir, "tasks.md"));
  await markChecklistDone(join(taskDir, "plan.md"));
  await markSubtasksDone(taskDir);
};

const markTaskDocDone = async (taskPath: string): Promise<void> => {
  try {
    const content = await readFile(taskPath, "utf-8");
    const updated = content
      .replace(/^status:\s+\w+$/m, "status: DONE")
      .replace(CHECKBOX_REGEX, "- [x] ");
    if (updated !== content) {
      await writeFile(taskPath, updated);
    }
  } catch {
    // Ignore fixture docs that do not include task.md
  }
};

const markChecklistDone = async (tasksPath: string): Promise<void> => {
  try {
    const content = await readFile(tasksPath, "utf-8");
    const updated = content.replace(CHECKBOX_REGEX, "- [x] ");
    if (updated !== content) {
      await writeFile(tasksPath, updated);
    }
  } catch {
    // Ignore fixture docs that do not include tasks.md
  }
};

const markSubtasksDone = async (taskDir: string): Promise<void> => {
  let files: string[] = [];

  try {
    files = await readdir(taskDir);
  } catch {
    return;
  }

  await Promise.all(
    files
      .filter((file) => /^\d{3}-.*\.md$/.test(file))
      .map(async (file) => {
        const path = join(taskDir, file);
        const fileStat = await stat(path).catch(() => null);
        if (!fileStat?.isFile()) return;

        const content = await readFile(path, "utf-8");
        let updated = content.replace(/^status:\s+\w+$/m, "status: DONE");
        if (!updated.includes("### Result")) {
          updated = `${updated.trimEnd()}\n\n### Result\nCompleted by deterministic e2e fixture provider.\n`;
        }

        if (updated !== content) {
          await writeFile(path, updated);
        }
      }),
  );
};

const writePlanningArtifacts = async (taskDir: string, taskText: string): Promise<void> => {
  const taskSlug = taskDir.split("/").at(-1) ?? "imported-task";
  const taskTitle = toHeadline(taskSlug);
  const fileInstruction = extractFileInstruction(taskText);
  const acceptanceCriteria = fileInstruction
    ? [
        `- [ ] Create \`${fileInstruction.path}\` in the repository root with content \`${fileInstruction.content}\`.`,
      ]
    : ["- [ ] Complete the imported request with relevant tests."];

  await writeFile(
    join(taskDir, "plan.md"),
    [
      `# ${taskTitle}`,
      "",
      "## Summary",
      `Deterministic e2e fixture plan for ${taskTitle}.`,
      "",
      "## Plan",
      "1. Implement the request described by the acceptance criteria.",
      "2. Verify with the relevant checks.",
      "",
      "## Acceptance Criteria",
      ...acceptanceCriteria,
      "",
      "## Out of Scope",
      "- Publishing the local docs to external trackers.",
      "",
    ].join("\n"),
  );
};

const writeFixtureLog = async (logFilePath: string, signal: string): Promise<void> => {
  const assistantText = `Deterministic e2e fixture run complete.\n<aop>${signal}</aop>`;
  const events = [
    { type: "thread.started", thread_id: "e2e-fixture-thread" },
    {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: assistantText,
      },
    },
    {
      type: "turn.completed",
      "last-assistant-message": assistantText,
    },
  ];

  await mkdir(dirname(logFilePath), { recursive: true });
  await writeFile(logFilePath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
};

const maybeDelay = async (): Promise<void> => {
  const rawDelay = process.env.AOP_E2E_FIXTURE_DELAY_MS?.trim();
  if (!rawDelay) {
    return;
  }

  const delayMs = Number.parseInt(rawDelay, 10);
  if (Number.isNaN(delayMs) || delayMs <= 0) {
    return;
  }

  await Bun.sleep(delayMs);
};

const toHeadline = (value: string): string =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
