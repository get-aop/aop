import { readdir, readFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import type { StepBlockDefinition } from "../workflow-engine/step-library.ts";
import type { StepType } from "../workflow-engine/types.ts";

export const LOCAL_SKILL_ROOTS_ENV = "AOP_WORKFLOW_SKILL_ROOTS";

interface LocalSkillMetadata {
  name: string;
  description: string;
  skillPath: string;
}

interface LocalSkillFile {
  name: string;
  description: string;
  skillPath: string;
}

export const resolveLocalSkillRoots = (env: NodeJS.ProcessEnv = process.env): string[] => {
  const configuredRoots = env[LOCAL_SKILL_ROOTS_ENV]?.trim();
  if (configuredRoots) {
    return uniquePaths(configuredRoots.split(delimiter).map((entry) => entry.trim()));
  }

  return uniquePaths([
    join(process.cwd(), ".codex", "skills"),
    join(process.cwd(), ".claude", "skills"),
  ]);
};

export const loadLocalSkillBlocks = async (
  roots: string[] = resolveLocalSkillRoots(),
): Promise<StepBlockDefinition[]> => {
  const blocks: StepBlockDefinition[] = [];
  const usedIds = new Set<string>();

  for (const root of roots) {
    for (const skill of await readLocalSkillFiles(root)) {
      const id = createUniqueLocalSkillId(skill.name, usedIds);
      blocks.push({
        id,
        type: inferStepType(skill.name),
        category: "general",
        description: skill.description,
        signals: [
          { name: "SKILL_COMPLETE", description: "local skill completed successfully" },
          {
            name: "REQUIRES_INPUT",
            description:
              "need clarification before this skill can continue. Also output `INPUT_REASON:` and `INPUT_TYPE:` tags explaining what you need",
          },
        ],
        promptTemplate: buildLocalSkillPrompt(skill),
        defaults: { maxAttempts: 3 },
        source: "local",
      });
    }
  }

  return blocks;
};

const readLocalSkillFiles = async (root: string): Promise<LocalSkillFile[]> => {
  const entries = await readSkillRoot(root);
  const skills: LocalSkillFile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }

    const skillPath = join(root, entry.name, "SKILL.md");
    const content = await readOptionalFile(skillPath);
    if (!content) {
      continue;
    }

    const metadata = parseLocalSkillMarkdown(content, entry.name);
    skills.push({
      ...metadata,
      skillPath,
    });
  }

  return skills;
};

const readSkillRoot = async (root: string) => {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
};

const readOptionalFile = async (path: string): Promise<string | null> => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

const parseLocalSkillMarkdown = (content: string, fallbackName: string): LocalSkillMetadata => {
  const { frontmatter, body } = splitFrontmatter(content);
  const fields = parseFrontmatter(frontmatter);
  const name = fields.get("name") ?? fallbackName;
  const description =
    fields.get("description") ?? firstMarkdownSummaryLine(body) ?? `Local skill ${name}`;

  return { name, description, skillPath: "" };
};

const splitFrontmatter = (content: string): { frontmatter: string[]; body: string[] } => {
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { frontmatter: [], body: lines };
  }

  const frontmatter: string[] = [];
  const body: string[] = [];
  let inFrontmatter = true;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (inFrontmatter && line.trim() === "---") {
      inFrontmatter = false;
      continue;
    }

    if (inFrontmatter) {
      frontmatter.push(line);
    } else {
      body.push(line);
    }
  }

  return { frontmatter, body };
};

const parseFrontmatter = (lines: string[]): Map<string, string> => {
  const fields = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = stripWrappingQuotes(line.slice(separatorIndex + 1).trim());
    if (key) {
      fields.set(key, value);
    }
  }

  return fields;
};

const firstMarkdownSummaryLine = (lines: string[]): string | null => {
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    return trimmed;
  }

  return null;
};

const buildLocalSkillPrompt = (
  skill: LocalSkillFile,
): string => `Follow the local \`${skill.name}\` skill for this workflow step.

Skill file: ${skill.skillPath}

Read the skill file and any referenced relative files before acting. Apply that skill to the current AOP task.

Task context:
- Task docs: {{task.docsDir}}
- Worktree path: {{worktree.path}}
- Branch: {{worktree.branch}}

When the step is complete, report the result and emit SKILL_COMPLETE. If you need human input, emit REQUIRES_INPUT with INPUT_REASON and INPUT_TYPE.`;

const inferStepType = (name: string): StepType => {
  const normalizedName = name.toLowerCase();
  if (normalizedName.includes("research")) return "research";
  if (normalizedName.includes("debug")) return "debug";
  if (normalizedName.includes("review")) return "review";
  if (normalizedName.includes("test")) return "test";
  if (normalizedName.includes("plan")) return "iterate";
  if (normalizedName.includes("implement")) return "implement";
  return "iterate";
};

const createUniqueLocalSkillId = (name: string, usedIds: Set<string>): string => {
  const baseId = `local_${sanitizeSkillId(name)}`;
  let candidate = baseId;
  let suffix = 2;

  while (usedIds.has(candidate)) {
    candidate = `${baseId}_${suffix}`;
    suffix += 1;
  }

  usedIds.add(candidate);
  return candidate;
};

const sanitizeSkillId = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || "skill";
};

const stripWrappingQuotes = (value: string): string => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
};

const uniquePaths = (paths: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const path of paths) {
    if (!path || seen.has(path)) {
      continue;
    }

    seen.add(path);
    unique.push(path);
  }

  return unique;
};
